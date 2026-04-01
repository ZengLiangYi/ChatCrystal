import { embed } from 'ai';
import { LocalIndex } from 'vectra';
import { resolve } from 'node:path';
import { getDatabase, saveDatabase } from '../db/index.js';
import { appConfig } from '../config.js';
import { getProvider } from './providers.js';

// =============================================
// Embedding Model Factory
// =============================================

function getEmbeddingModel() {
  const { provider, ...config } = appConfig.embedding;
  const entry = getProvider(provider);
  if (!entry.createEmbeddingModel) {
    throw new Error(`Provider "${provider}" does not support embeddings. Use ollama, openai, google, azure, or custom.`);
  }
  return entry.createEmbeddingModel(config);
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
  expandRelations = false,
): Promise<{ noteId: number; conversationId: string; title: string; projectName: string; score: number; chunkText: string; viaRelation?: string }[]> {
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

  const directResults = Array.from(seen.values()).map((r) => ({
    noteId: r.item.metadata.noteId,
    conversationId: r.item.metadata.conversationId,
    title: r.item.metadata.title,
    projectName: r.item.metadata.projectName,
    score: r.score,
    chunkText: '' as string,
    viaRelation: undefined as string | undefined,
  }));

  if (!expandRelations || directResults.length === 0) {
    return directResults;
  }

  // Expand along relation edges
  const { getDatabase } = await import('../db/index.js');
  const { resultToObjects } = await import('../db/utils.js');
  const db = getDatabase();
  const resultMap = new Map(directResults.map((r) => [r.noteId, r]));

  for (const dr of directResults) {
    const relResult = db.exec(
      `SELECT r.relation_type, r.confidence,
        CASE WHEN r.source_note_id = ? THEN r.target_note_id ELSE r.source_note_id END as linked_note_id
       FROM note_relations r
       WHERE (r.source_note_id = ? OR r.target_note_id = ?)
         AND r.confidence >= 0.5`,
      [dr.noteId, dr.noteId, dr.noteId],
    );
    if (!relResult.length) continue;

    for (const row of resultToObjects(relResult)) {
      const linkedId = Number(row.linked_note_id);
      if (resultMap.has(linkedId)) continue;

      // Fetch linked note info
      const noteInfo = db.exec(
        `SELECT n.id, n.conversation_id, n.title, c.project_name
         FROM notes n JOIN conversations c ON c.id = n.conversation_id
         WHERE n.id = ?`,
        [linkedId],
      );
      if (!noteInfo.length || !noteInfo[0].values.length) continue;

      const [id, convId, title, projName] = noteInfo[0].values[0] as [number, string, string, string];
      const discountedScore = dr.score * 0.7 * (Number(row.confidence) || 0.5);

      const entry = {
        noteId: id,
        conversationId: convId,
        title,
        projectName: projName,
        score: Math.round(discountedScore * 1000) / 1000,
        chunkText: '',
        viaRelation: row.relation_type as string,
      };
      resultMap.set(linkedId, entry);
    }
  }

  return Array.from(resultMap.values()).sort((a, b) => b.score - a.score);
}
