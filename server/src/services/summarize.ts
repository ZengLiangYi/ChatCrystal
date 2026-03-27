import { generateText } from 'ai';
import { getDatabase, saveDatabase } from '../db/index.js';
import { resultToObjects } from '../db/utils.js';
import { getLanguageModel } from './llm.js';
import { generateEmbeddings } from './embedding.js';

// =============================================
// Types
// =============================================

interface SummarizeResult {
  title: string;
  summary: string;
  key_conclusions: string[];
  code_snippets: { language: string; code: string; description: string }[];
  tags: string[];
  raw_response: string;
}

// =============================================
// System Prompt
// =============================================

const SYSTEM_PROMPT = `你是一个技术对话摘要助手。请分析以下 AI 编程助手的对话记录，生成结构化笔记。

请严格按以下 JSON 格式回复（不要包含任何其他文字或 markdown 代码块标记）：
{
  "title": "简洁的中文标题（15字以内）",
  "summary": "2-4 段 markdown 格式的摘要，描述对话的主要内容、解决的问题和采用的方案",
  "key_conclusions": ["结论1", "结论2", "结论3"],
  "code_snippets": [
    {"language": "typescript", "code": "关键代码片段", "description": "这段代码的作用"}
  ],
  "tags": ["tag1", "tag2", "tag3"]
}

注意事项：
- title 应简明概括对话主题
- summary 使用 markdown 格式，重点描述解决了什么问题、采用了什么方案
- key_conclusions 提取 3-5 个关键结论或决策
- code_snippets 只包含最关键的代码片段（0-3个），不要包含过长的代码
- tags 使用小写英文，3-6 个标签，涵盖技术栈、问题类型等`;

// =============================================
// Conversation Preprocessing
// =============================================

const MAX_CHARS = 32000; // ~8000 tokens

function prepareTranscript(conversationId: string): string {
  const db = getDatabase();

  // Get conversation metadata
  const convResult = db.exec(
    'SELECT project_name, slug, git_branch FROM conversations WHERE id = ?',
    [conversationId],
  );
  const conv = resultToObjects(convResult)[0];
  if (!conv) throw new Error('Conversation not found');

  // Get messages, skip tool-use-only
  const msgResult = db.exec(
    `SELECT type, content, has_tool_use FROM messages
     WHERE conversation_id = ? AND NOT (has_tool_use = 1 AND (content = '' OR content IS NULL))
     ORDER BY sort_order ASC`,
    [conversationId],
  );
  const messages = resultToObjects(msgResult);

  if (messages.length === 0) {
    throw new Error('No meaningful messages in conversation');
  }

  // Format messages
  const formatted = messages.map((m) => {
    const role = m.type === 'user' ? 'User' : 'Assistant';
    return `[${role}]:\n${m.content}`;
  });

  // Truncation: keep first message + as many from the end as fit
  const header = `项目: ${conv.project_name}\n分支: ${conv.git_branch || 'unknown'}\n\n--- 对话记录 ---\n\n`;
  const budget = MAX_CHARS - header.length;

  const first = formatted[0];
  if (formatted.length === 1 || first.length >= budget) {
    return header + first.slice(0, budget);
  }

  const parts: string[] = [first];
  let usedChars = first.length;
  const rest: string[] = [];

  // Fill from the end
  for (let i = formatted.length - 1; i >= 1; i--) {
    const entry = formatted[i];
    if (usedChars + entry.length + 60 > budget) break; // 60 chars for truncation marker
    rest.unshift(entry);
    usedChars += entry.length;
  }

  const skipped = formatted.length - 1 - rest.length;
  if (skipped > 0) {
    parts.push(`\n[... 中间省略了 ${skipped} 条消息 ...]\n`);
  }
  parts.push(...rest);

  return header + parts.join('\n\n');
}

// =============================================
// JSON Extraction
// =============================================

function extractJSON(text: string): Record<string, unknown> {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Try stripping markdown fences
  const fenceStripped = text
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?\s*```\s*$/m, '');
  try {
    return JSON.parse(fenceStripped);
  } catch {
    // continue
  }

  // Try extracting first {...} block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // continue
    }
  }

  throw new Error('Failed to parse LLM response as JSON');
}

function validateResult(parsed: Record<string, unknown>): SummarizeResult & { raw_response: string } {
  return {
    title: typeof parsed.title === 'string' ? parsed.title : '无标题',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    key_conclusions: Array.isArray(parsed.key_conclusions)
      ? parsed.key_conclusions.filter((c): c is string => typeof c === 'string')
      : [],
    code_snippets: Array.isArray(parsed.code_snippets)
      ? parsed.code_snippets.filter(
          (s): s is { language: string; code: string; description: string } =>
            typeof s === 'object' && s !== null && 'code' in s,
        )
      : [],
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
      : [],
    raw_response: '',
  };
}

// =============================================
// LLM Call
// =============================================

async function summarizeConversation(conversationId: string): Promise<SummarizeResult> {
  const transcript = prepareTranscript(conversationId);

  const { text } = await generateText({
    model: getLanguageModel(),
    system: SYSTEM_PROMPT,
    prompt: transcript,
  });

  const parsed = extractJSON(text);
  const result = validateResult(parsed);
  result.raw_response = text;

  return result;
}

// =============================================
// DB Persistence
// =============================================

function saveNote(conversationId: string, result: SummarizeResult): number {
  const db = getDatabase();

  db.run(
    `INSERT OR REPLACE INTO notes
      (conversation_id, title, summary, key_conclusions, code_snippets, raw_llm_response, is_edited)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [
      conversationId,
      result.title,
      result.summary,
      JSON.stringify(result.key_conclusions),
      JSON.stringify(result.code_snippets),
      result.raw_response,
    ],
  );

  // Get note ID
  const noteResult = db.exec(
    'SELECT id FROM notes WHERE conversation_id = ?',
    [conversationId],
  );
  const noteId = Number(noteResult[0]?.values[0]?.[0]);

  // Upsert tags
  for (const tagName of result.tags) {
    db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName]);
    const tagResult = db.exec('SELECT id FROM tags WHERE name = ?', [tagName]);
    const tagId = Number(tagResult[0]?.values[0]?.[0]);
    db.run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [noteId, tagId]);
  }

  // Update conversation status
  db.run(
    `UPDATE conversations SET status = 'summarized', updated_at = datetime('now') WHERE id = ?`,
    [conversationId],
  );

  saveDatabase();
  return noteId;
}

// =============================================
// Public API
// =============================================

/**
 * Summarize a single conversation. Idempotent — returns existing note ID if already summarized.
 */
export async function triggerSummarize(conversationId: string): Promise<number> {
  const db = getDatabase();

  // Verify conversation exists
  const convResult = db.exec('SELECT status FROM conversations WHERE id = ?', [conversationId]);
  if (!convResult.length || !convResult[0].values.length) {
    throw new Error('Conversation not found');
  }

  // Check if already summarized
  const existingNote = db.exec('SELECT id FROM notes WHERE conversation_id = ?', [conversationId]);
  if (existingNote.length > 0 && existingNote[0].values.length > 0) {
    return Number(existingNote[0].values[0][0]);
  }

  try {
    // Update status to summarizing
    db.run(
      `UPDATE conversations SET status = 'summarizing', updated_at = datetime('now') WHERE id = ?`,
      [conversationId],
    );

    const result = await summarizeConversation(conversationId);
    const noteId = saveNote(conversationId, result);

    // Auto-generate embeddings after summarization
    try {
      await generateEmbeddings(noteId);
    } catch (err) {
      console.error(`[Embedding] Failed for note ${noteId}:`, err instanceof Error ? err.message : err);
      // Don't fail the summarization if embedding fails
    }

    return noteId;
  } catch (err) {
    // Mark as error
    db.run(
      `UPDATE conversations SET status = 'error', updated_at = datetime('now') WHERE id = ?`,
      [conversationId],
    );
    saveDatabase();
    throw err;
  }
}

/**
 * Queue summarization for all unsummarized conversations.
 */
export function getUnsummarizedIds(): string[] {
  const db = getDatabase();
  const result = db.exec("SELECT id FROM conversations WHERE status = 'imported'");
  if (!result.length) return [];
  return result[0].values.map((row) => String(row[0]));
}
