import { readdir, stat, readFile } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type {
  SourceInfo,
  ConversationMeta,
  ParsedConversation,
  ParsedMessage,
} from '@chatcrystal/shared';
import type { SourceAdapter } from '../adapter.js';
import { appConfig } from '../../config.js';

// =============================================
// Raw JSONL message types from Claude Code
// =============================================

interface RawMessage {
  uuid?: string;
  parentUuid?: string | null;
  type?: string;
  subtype?: string;
  sessionId?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
  };
  isSidechain?: boolean;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
}

// =============================================
// Noise filter
// =============================================

const SKIP_TYPES = new Set([
  'file-history-snapshot',
  'last-prompt',
  'progress',
  'agent_progress',
  'hook_progress',
  'queue-operation',
  'message', // streaming delta
  'tool_use', // streaming tool delta
  'tool_result', // streaming tool result delta
  'thinking', // streaming thinking delta
  'text', // streaming text delta
  'tool_reference',
]);

function isRelevantMessage(line: RawMessage): boolean {
  // Must have uuid (filters out streaming deltas)
  if (!line.uuid) return false;
  // Skip known noise types
  if (line.type && SKIP_TYPES.has(line.type)) return false;
  // Skip all system messages (metadata: turn_duration, api_error, compact_boundary, local_command)
  if (line.type === 'system') return false;
  // Keep user, assistant
  return ['user', 'assistant'].includes(line.type ?? '');
}

// =============================================
// Content sanitization
// =============================================

function sanitizeContent(text: string): string {
  let result = text;
  // Strip <system-reminder>...</system-reminder> (may span multiple lines)
  result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  // Strip command tags (slash command echoes)
  result = result.replace(/<command-name>[^<]*<\/command-name>/g, '');
  result = result.replace(/<command-message>[^<]*<\/command-message>/g, '');
  result = result.replace(/<command-args>[^<]*<\/command-args>/g, '');
  // Strip local command output/caveat tags
  result = result.replace(/<local-command-stdout>[^<]*<\/local-command-stdout>/g, '');
  result = result.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '');
  return result.trim();
}

// =============================================
// Content extraction
// =============================================

function extractContent(message: RawMessage): {
  text: string;
  thinking: string | null;
  hasToolUse: boolean;
  hasCode: boolean;
} {
  const content = message.message?.content;
  if (!content) return { text: '', thinking: null, hasToolUse: false, hasCode: false };

  // Simple string content
  if (typeof content === 'string') {
    const cleaned = sanitizeContent(content);
    return {
      text: cleaned,
      thinking: null,
      hasToolUse: false,
      hasCode: cleaned.includes('```'),
    };
  }

  // Array of content blocks
  const texts: string[] = [];
  const thinkingParts: string[] = [];
  let hasToolUse = false;
  let hasCode = false;

  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          texts.push(block.text);
          if (block.text.includes('```')) hasCode = true;
        }
        break;
      case 'thinking':
        if (block.thinking) thinkingParts.push(block.thinking);
        break;
      case 'tool_use':
        hasToolUse = true;
        break;
      case 'tool_result':
        // Skip tool results in content extraction (noise)
        break;
    }
  }

  return {
    text: sanitizeContent(texts.join('\n')),
    thinking: thinkingParts.length > 0 ? thinkingParts.join('\n') : null,
    hasToolUse,
    hasCode,
  };
}

// =============================================
// Project name extraction
// =============================================

/**
 * Extract human-readable project name from encoded directory name.
 * e.g. "c--Users-Rayner-Project-Chuangdazi-Admin" → "Chuangdazi-Admin"
 */
function extractProjectName(dirName: string): string {
  // Split by '-' and take the last meaningful segment(s)
  const parts = dirName.split('-').filter(Boolean);

  // Try to find "Project" or similar markers and take everything after
  const projectIdx = parts.findIndex(
    (p) => p.toLowerCase() === 'project' || p.toLowerCase() === 'projects',
  );
  if (projectIdx >= 0 && projectIdx < parts.length - 1) {
    return parts.slice(projectIdx + 1).join('-');
  }

  // Fallback: take last 1-2 segments
  if (parts.length >= 2) {
    return parts.slice(-2).join('-');
  }
  return dirName;
}

// =============================================
// Claude Code Adapter
// =============================================

export const claudeCodeAdapter: SourceAdapter = {
  name: 'claude-code',
  displayName: 'Claude Code',

  async detect(): Promise<SourceInfo | null> {
    const dir = appConfig.claudeProjectsDir;
    if (!existsSync(dir)) return null;

    try {
      const entries = await readdir(dir);
      const projectDirs = entries.filter(
        (e) => !e.startsWith('.') && !e.endsWith('.json'),
      );

      let conversationCount = 0;
      for (const projectDir of projectDirs) {
        const projectPath = resolve(dir, projectDir);
        const s = await stat(projectPath);
        if (!s.isDirectory()) continue;

        const files = await readdir(projectPath);
        conversationCount += files.filter((f) => f.endsWith('.jsonl')).length;
      }

      return {
        name: 'claude-code',
        displayName: 'Claude Code',
        dataDir: dir,
        conversationCount,
      };
    } catch {
      return null;
    }
  },

  async scan(): Promise<ConversationMeta[]> {
    const dir = appConfig.claudeProjectsDir;
    if (!existsSync(dir)) return [];

    const metas: ConversationMeta[] = [];
    const entries = await readdir(dir);

    for (const projectDir of entries) {
      const projectPath = resolve(dir, projectDir);
      const s = await stat(projectPath);
      if (!s.isDirectory()) continue;

      const files = await readdir(projectPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = resolve(projectPath, file);
        const fileStat = await stat(filePath);

        // Skip very small files (< 100 bytes, likely empty/corrupt)
        if (fileStat.size < 100) continue;

        const sessionId = basename(file, '.jsonl');

        metas.push({
          id: sessionId,
          source: 'claude-code',
          filePath,
          fileSize: fileStat.size,
          fileMtime: fileStat.mtime.toISOString(),
          projectDir,
        });
      }
    }

    return metas;
  },

  async parse(meta: ConversationMeta): Promise<ParsedConversation> {
    const messages: ParsedMessage[] = [];
    let slug: string | null = null;
    let cwd: string | null = null;
    let gitBranch: string | null = null;

    // Read JSONL line by line (memory efficient)
    const fileStream = createReadStream(meta.filePath, { encoding: 'utf-8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Number.POSITIVE_INFINITY });

    let sortOrder = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;

      let parsed: RawMessage;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // Skip malformed JSON lines
      }

      if (!isRelevantMessage(parsed)) continue;

      // Extract metadata from first meaningful message
      if (!cwd && parsed.cwd) cwd = parsed.cwd;
      if (!gitBranch && parsed.gitBranch) gitBranch = parsed.gitBranch;
      if (!slug && parsed.slug) slug = parsed.slug;

      const { text, thinking, hasToolUse, hasCode } = extractContent(parsed);

      // Skip empty messages (but keep tool-use-only messages)
      if (!text.trim() && !thinking && !hasToolUse) continue;

      const msgType = parsed.type as 'user' | 'assistant' | 'system';

      messages.push({
        id: parsed.uuid!,
        parentUuid: parsed.parentUuid ?? null,
        type: msgType,
        role: parsed.message?.role ?? msgType,
        content: text,
        hasToolUse,
        hasCode,
        thinking,
        timestamp: parsed.timestamp ?? new Date().toISOString(),
      });

      sortOrder++;
    }

    // Sort by timestamp
    messages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // Reassign sort_order after sorting
    messages.forEach((m, i) => {
      (m as ParsedMessage & { sortOrder: number }).sortOrder = i;
    });

    const projectName = extractProjectName(meta.projectDir);

    return {
      id: meta.id,
      slug,
      source: 'claude-code',
      projectDir: meta.projectDir,
      projectName,
      cwd,
      gitBranch,
      messages,
      firstMessageAt: messages[0]?.timestamp ?? new Date().toISOString(),
      lastMessageAt:
        messages[messages.length - 1]?.timestamp ?? new Date().toISOString(),
    };
  },
};
