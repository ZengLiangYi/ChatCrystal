import { getDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';
import { appConfig } from '../config.js';

// =============================================
// Types
// =============================================

interface RawMessage {
  type: string;
  content: string;
  has_tool_use: number;
}

interface Turn {
  index: number;
  userMessages: RawMessage[];
  assistantMessages: RawMessage[];
}

// =============================================
// Turn Splitting
// =============================================

/**
 * Split a flat message list into turns.
 * A new turn starts when a user message follows an assistant message.
 * Consecutive user messages belong to the same turn.
 * Consecutive assistant messages belong to the same turn.
 */
function splitIntoTurns(messages: RawMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const msg of messages) {
    const isUser = msg.type === 'user';

    if (isUser) {
      if (current && current.assistantMessages.length > 0) {
        turns.push(current);
        current = { index: turns.length, userMessages: [msg], assistantMessages: [] };
      } else if (!current) {
        current = { index: 0, userMessages: [msg], assistantMessages: [] };
      } else {
        current.userMessages.push(msg);
      }
    } else {
      if (!current) {
        current = { index: 0, userMessages: [], assistantMessages: [msg] };
      } else {
        current.assistantMessages.push(msg);
      }
    }
  }

  if (current) {
    turns.push(current);
  }

  return turns;
}

// =============================================
// Turn Filtering
// =============================================

function findFirstSubstantial(messages: RawMessage[]): RawMessage | null {
  return messages.find((m) => m.content && m.content.length > 50) ?? null;
}

function findLastSubstantial(messages: RawMessage[]): RawMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].content && messages[i].content.length > 50) {
      return messages[i];
    }
  }
  return null;
}

function renderTurn(turn: Turn): string {
  const parts: string[] = [];

  for (const msg of turn.userMessages) {
    parts.push(`[User]:\n${msg.content}`);
  }

  const first = findFirstSubstantial(turn.assistantMessages);
  const last = findLastSubstantial(turn.assistantMessages);

  if (first) {
    parts.push(`[Assistant]:\n${first.content}`);
  }
  if (last && last !== first) {
    parts.push(`[Assistant]:\n${last.content}`);
  }

  if (!first && !last) {
    const any = turn.assistantMessages.find((m) => m.content && m.content.length > 0);
    if (any) {
      parts.push(`[Assistant]:\n${any.content}`);
    }
  }

  return parts.join('\n\n');
}

function isConfirmationTurn(turn: Turn): boolean {
  const totalUserChars = turn.userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  return totalUserChars < 20;
}

function summarizeTurn(turn: Turn): string {
  const userText = turn.userMessages
    .map((m) => m.content || '')
    .join(' ')
    .replace(/\n+/g, ' ')
    .trim();
  const preview = userText.length > 80 ? userText.slice(0, 80) + '...' : userText;
  return `[跳过] 用户: ${preview}`;
}

// =============================================
// Turn Scoring
// =============================================

function scoreTurn(turn: Turn): number {
  const userChars = turn.userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const assistantCount = turn.assistantMessages.length;
  return userChars * (1 + assistantCount);
}

// =============================================
// Public API
// =============================================

export function prepareTranscript(conversationId: string): string {
  const db = getDatabase();

  const convResult = db.exec(
    'SELECT project_name, slug, git_branch FROM conversations WHERE id = ?',
    [conversationId],
  );
  const conv = resultToObjects(convResult)[0];
  if (!conv) throw new Error('Conversation not found');

  const msgResult = db.exec(
    `SELECT type, content, has_tool_use FROM messages
     WHERE conversation_id = ? AND NOT (has_tool_use = 1 AND (content = '' OR content IS NULL))
     ORDER BY sort_order ASC`,
    [conversationId],
  );
  const messages = resultToObjects(msgResult) as unknown as RawMessage[];

  if (messages.length === 0) {
    throw new Error('No meaningful messages in conversation');
  }

  const turns = splitIntoTurns(messages);

  if (turns.length === 0) {
    throw new Error('No turns found in conversation');
  }

  const header = `项目: ${conv.project_name}\n分支: ${conv.git_branch || 'unknown'}\n\n--- 对话记录 ---\n\n`;
  const budget = appConfig.llm.maxInputChars - header.length;

  if (turns.length <= 3) {
    const allRendered = turns.map(renderTurn).join('\n\n');
    return header + allRendered.slice(0, budget);
  }

  const fixedFirst = turns[0];
  const fixedLast2 = turns.slice(-2);
  const fixedTurns = [fixedFirst, ...fixedLast2];
  const fixedRendered = fixedTurns.map(renderTurn);
  const fixedChars = fixedRendered.reduce((sum, r) => sum + r.length + 2, 0);

  const middleTurns = turns.slice(1, -2);

  // Budget for middle section: total minus fixed turns
  const middleBudget = Math.max(0, budget - fixedChars);

  const scored = middleTurns.map((turn) => ({
    turn,
    score: isConfirmationTurn(turn) ? 0 : scoreTurn(turn),
    rendered: isConfirmationTurn(turn) ? `[确认] 用户: ${turn.userMessages.map(m => m.content || '').join(' ').trim()}` : renderTurn(turn),
  }));

  // Start with all turns as summaries (~100 chars each)
  const sortedByScore = [...scored].sort((a, b) => b.score - a.score);
  const selectedIndices = new Set<number>();
  let middleChars = middleTurns.length * 100; // baseline: all summaries

  for (const item of sortedByScore) {
    // Replacing a ~100 char summary with the full rendered turn
    const addedCost = item.rendered.length + 2 - 100;
    if (middleChars + addedCost > middleBudget) continue;
    selectedIndices.add(item.turn.index);
    middleChars += addedCost;
  }

  const output: string[] = [fixedRendered[0]];

  for (const item of scored) {
    if (selectedIndices.has(item.turn.index)) {
      output.push(item.rendered);
    } else {
      output.push(summarizeTurn(item.turn));
    }
  }

  output.push(fixedRendered[1]);
  output.push(fixedRendered[2]);

  return header + output.join('\n\n');
}
