import { generateObject } from 'ai';
import { z } from 'zod';
import { getDatabase, saveDatabase } from '../db/index.js';
import { withTransaction } from '../db/transaction.js';
import { getLanguageModel } from './llm.js';
import { prepareTranscript } from './transcript.js';
import { generateEmbeddings } from './embedding.js';
import { discoverRelations } from './relations.js';

// =============================================
// Schema
// =============================================

const SummarizeSchema = z.object({
  title: z.string().describe('简洁的标题，概括对话主题，20字以内'),
  summary: z.string().describe('2-4 段 markdown 摘要，涵盖决策上下文和可复用知识'),
  key_conclusions: z.array(z.string()).describe('3-5 个关键结论或决策'),
  code_snippets: z
    .array(
      z.object({
        language: z.string(),
        code: z.string(),
        description: z.string(),
      }),
    )
    .describe('0-3 个最关键的代码片段'),
  tags: z.array(z.string()).describe('3-6 个小写英文标签'),
});

type SummarizeResult = z.infer<typeof SummarizeSchema> & { raw_response: string };

// =============================================
// System Prompt
// =============================================

const SYSTEM_PROMPT = `你是一个技术对话分析专家，擅长从 AI 编程助手的对话中提炼结构化知识。

## 分析要求

### 标题
用一句话概括对话的核心主题。使用与对话相同的语言。

### 摘要
写 2-4 段 markdown 格式的摘要，需要涵盖：
- **决策上下文**：遇到了什么问题，考虑了哪些方案，最终选择了什么，为什么
- **实施要点**：具体做了什么改动，涉及哪些文件/模块/技术
- **可复用知识**：从这次对话中可以提炼出什么通用的经验、模式或注意事项

### 关键结论
提取 3-5 个最重要的结论或决策，每条应当独立可理解。

### 代码片段
只保留最关键的 0-3 个代码片段。选择标准：能独立说明核心方案的代码，而非冗长的完整实现。

### 标签
3-6 个小写英文标签，涵盖：技术栈（语言、框架）、问题类型（bug-fix, refactor, feature）、领域（auth, database, ui）。

## 注意事项
- 使用与对话相同的语言撰写总结（中文对话用中文，英文对话用英文）
- 如果对话记录标注了"中间省略了 N 条消息"，基于可见内容总结，不要猜测省略的内容
- 技术术语、函数名、包名保留原文，不翻译`;

// =============================================
// LLM Call
// =============================================

async function summarizeConversation(conversationId: string): Promise<SummarizeResult> {
  const transcript = prepareTranscript(conversationId);

  const { object } = await generateObject({
    model: getLanguageModel(),
    schema: SummarizeSchema,
    system: SYSTEM_PROMPT,
    prompt: transcript,
    maxOutputTokens: 4096,
    maxRetries: 3,
  });

  // Normalize tags to lowercase
  const result: SummarizeResult = {
    ...object,
    tags: object.tags.map((t) => t.toLowerCase()),
    raw_response: JSON.stringify(object),
  };

  return result;
}

// =============================================
// DB Persistence
// =============================================

function saveNote(conversationId: string, result: SummarizeResult): number {
  const db = getDatabase();

  const noteId = withTransaction(db, () => {
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

    const noteResult = db.exec(
      'SELECT id FROM notes WHERE conversation_id = ?',
      [conversationId],
    );
    const nextNoteId = Number(noteResult[0]?.values[0]?.[0]);

    for (const tagName of result.tags) {
      db.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', [tagName]);
      const tagResult = db.exec('SELECT id FROM tags WHERE name = ?', [tagName]);
      const tagId = Number(tagResult[0]?.values[0]?.[0]);
      db.run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', [nextNoteId, tagId]);
    }

    db.run(
      `UPDATE conversations SET status = 'summarized', updated_at = datetime('now') WHERE id = ?`,
      [conversationId],
    );

    return nextNoteId;
  });

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
      // Mark as failed so batch rebuild can pick it up
      db.run(
        "UPDATE notes SET embedding_status = 'failed' WHERE id = ?",
        [noteId],
      );
      saveDatabase();
      // Don't fail the summarization if embedding fails
    }

    // Auto-discover relations after embedding
    try {
      await discoverRelations(noteId);
    } catch (err) {
      console.error(`[Relations] Failed for note ${noteId}:`, err instanceof Error ? err.message : err);
      // Don't fail the summarization if relation discovery fails
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
  const result = db.exec("SELECT id FROM conversations WHERE status IN ('imported', 'error', 'summarizing')");
  if (!result.length) return [];
  return result[0].values.map((row) => String(row[0]));
}
