import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider';
import { LocalIndex } from 'vectra';
import { resolve } from 'node:path';
import { getDatabase, saveDatabase } from '../db/index.js';
import { appConfig } from '../config.js';

// =============================================
// Embedding Model Factory
// =============================================

function getEmbeddingModel() {
  const { provider, baseURL, apiKey, model } = appConfig.embedding;

  switch (provider) {
    case 'ollama': {
      const ollama = createOllama({ baseURL: `${baseURL}/api` });
      return ollama.embedding(model);
    }
    case 'openai': {
      const openai = createOpenAI({ baseURL, apiKey, compatibility: 'strict' });
      return openai.textEmbeddingModel(model);
    }
    case 'custom': {
      const custom = createOpenAI({ baseURL, apiKey, compatibility: 'compatible', name: 'custom' });
      return custom.textEmbeddingModel(model);
    }
    default:
      throw new Error(`Unsupported embedding provider: ${provider}`);
  }
}

// =============================================
// Vectra Index
// =============================================

const INDEX_PATH = resolve(appConfig.dataDir, 'vectra-index');

let _index: LocalIndex | null = null;

async function getIndex(): Promise<LocalIndex> {
  if (_index) return _index;
  _index = new LocalIndex(INDEX_PATH);
  if (!(await _index.isIndexCreated())) {
    await _index.createIndex();
  }
  return _index;
}

// =============================================
// Text Chunking
// =============================================

const CHUNK_SIZE = 500; // characters per chunk

function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  // Split on paragraph boundaries first
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// =============================================
// Public API
// =============================================

type NoteChunkMeta = Record<string, string | number> & {
  noteId: number;
  chunkIndex: number;
  conversationId: string;
  title: string;
  projectName: string;
};

/**
 * Generate embeddings for a note and store in vectra index + DB.
 */
export async function generateEmbeddings(noteId: number): Promise<number> {
  const db = getDatabase();

  // Get note data
  const noteResult = db.exec(
    `SELECT n.id, n.conversation_id, n.title, n.summary, n.key_conclusions, c.project_name
     FROM notes n JOIN conversations c ON c.id = n.conversation_id
     WHERE n.id = ?`,
    [noteId],
  );
  if (!noteResult.length || !noteResult[0].values.length) {
    throw new Error('Note not found');
  }

  const [id, conversationId, title, summary, keyConclusions, projectName] = noteResult[0].values[0] as [
    number, string, string, string, string, string,
  ];

  // Build text to embed: title + summary + conclusions
  let fullText = `${title}\n\n${summary}`;
  try {
    const conclusions = JSON.parse(keyConclusions || '[]') as string[];
    if (conclusions.length > 0) {
      fullText += '\n\n' + conclusions.join('\n');
    }
  } catch {
    // ignore parse errors
  }

  // Chunk the text
  const chunks = chunkText(fullText);

  // Delete existing embeddings for this note
  const existingResult = db.exec(
    'SELECT vectra_id FROM embeddings WHERE note_id = ?',
    [noteId],
  );
  if (existingResult.length > 0) {
    const index = await getIndex();
    for (const row of existingResult[0].values) {
      const vectraId = row[0] as string;
      if (vectraId) {
        try { await index.deleteItem(vectraId); } catch { /* ignore */ }
      }
    }
    db.run('DELETE FROM embeddings WHERE note_id = ?', [noteId]);
  }

  const index = await getIndex();
  const model = getEmbeddingModel();

  // Generate embeddings and insert
  for (let i = 0; i < chunks.length; i++) {
    const { embedding } = await embed({ model, value: chunks[i] });

    const item = await index.insertItem({
      vector: embedding,
      metadata: {
        noteId: id,
        chunkIndex: i,
        conversationId,
        title,
        projectName,
      } as NoteChunkMeta,
    });

    db.run(
      `INSERT INTO embeddings (note_id, chunk_index, chunk_text, vectra_id)
       VALUES (?, ?, ?, ?)`,
      [noteId, i, chunks[i], item.id],
    );
  }

  saveDatabase();
  return chunks.length;
}

/**
 * Search notes by semantic similarity.
 */
export async function semanticSearch(
  query: string,
  topK = 10,
): Promise<{ noteId: number; conversationId: string; title: string; projectName: string; score: number; chunkText: string }[]> {
  const index = await getIndex();

  // Check if index has any items
  if (!(await index.isIndexCreated())) {
    return [];
  }

  const model = getEmbeddingModel();
  const { embedding } = await embed({ model, value: query });

  const results = await index.queryItems<NoteChunkMeta>(embedding, topK);

  // Deduplicate by noteId, keeping highest score
  const seen = new Map<number, (typeof results)[0]>();
  for (const r of results) {
    const noteId = r.item.metadata.noteId;
    if (!seen.has(noteId) || seen.get(noteId)!.score < r.score) {
      seen.set(noteId, r);
    }
  }

  return Array.from(seen.values()).map((r) => ({
    noteId: r.item.metadata.noteId,
    conversationId: r.item.metadata.conversationId,
    title: r.item.metadata.title,
    projectName: r.item.metadata.projectName,
    score: r.score,
    chunkText: '', // Will be filled from DB if needed
  }));
}
