import { embed } from 'ai';
import { LocalIndex } from 'vectra';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDatabase, saveDatabase } from '../db/index.js';
import { withTransaction } from '../db/transaction.js';
import { resultToObjects } from '../db/utils.js';
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

export function clearEmbeddingIndex(): void {
  _index = null;
  if (existsSync(INDEX_PATH)) {
    rmSync(INDEX_PATH, { recursive: true, force: true });
  }
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

type SemanticSearchHit = {
  item: {
    metadata: NoteChunkMeta;
  };
  score: number;
};

type DirectSearchHit = {
  noteId: number;
  conversationId: string;
  title: string;
  projectName: string;
  score: number;
  chunkText: string;
  viaRelation?: string;
};

type DatabaseLike = ReturnType<typeof getDatabase>;

export async function committedVectraIdsForNote(index: LocalIndex, noteId: number): Promise<string[]> {
  const items = await index.listItemsByMetadata({ noteId });
  return items.map((item) => item.id);
}

export async function currentVectraIdsCommitted(index: LocalIndex, vectraIds: string[]): Promise<boolean> {
  if (vectraIds.length === 0) {
    return false;
  }

  for (const vectraId of vectraIds) {
    if (!(await index.getItem(vectraId))) {
      return false;
    }
  }

  return true;
}

export async function materializeDirectSearchHits(
  db: Pick<DatabaseLike, 'exec'>,
  results: SemanticSearchHit[],
): Promise<DirectSearchHit[]> {
  const materialized: DirectSearchHit[] = [];

  for (const result of results) {
    const chunkResult = db.exec(
      `SELECT e.chunk_text
       FROM embeddings e
       JOIN notes n ON n.id = e.note_id
       WHERE e.note_id = ? AND e.chunk_index = ? AND n.embedding_status = 'done'`,
      [result.item.metadata.noteId, result.item.metadata.chunkIndex],
    );
    if (!chunkResult.length || !chunkResult[0].values.length) {
      continue;
    }

    materialized.push({
      noteId: result.item.metadata.noteId,
      conversationId: result.item.metadata.conversationId,
      title: result.item.metadata.title,
      projectName: result.item.metadata.projectName,
      score: result.score,
      chunkText: String(chunkResult[0].values[0][0]),
      viaRelation: undefined,
    });
  }

  const seen = new Map<number, DirectSearchHit>();
  for (const result of materialized) {
    if (!seen.has(result.noteId) || seen.get(result.noteId)!.score < result.score) {
      seen.set(result.noteId, result);
    }
  }

  return Array.from(seen.values());
}

/**
 * Generate embeddings for a note and store in vectra index + DB.
 */
export async function generateEmbeddings(noteId: number): Promise<number> {
  const db = getDatabase();

  // Get note data
  const noteResult = db.exec(
    `SELECT n.id, n.conversation_id, n.title, n.summary, n.key_conclusions, n.code_snippets, c.project_name
     FROM notes n JOIN conversations c ON c.id = n.conversation_id
     WHERE n.id = ?`,
    [noteId],
  );
  if (!noteResult.length || !noteResult[0].values.length) {
    throw new Error('Note not found');
  }

  const [id, conversationId, title, summary, keyConclusions, codeSnippets, projectName] = noteResult[0].values[0] as [
    number, string, string, string, string, string, string,
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

  // Append tags for keyword matching
  const tagsResult = db.exec(
    `SELECT GROUP_CONCAT(t.name, ' ') FROM note_tags nt
     JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = ?`,
    [noteId],
  );
  const tagsText = tagsResult[0]?.values[0]?.[0] as string | null;
  if (tagsText) {
    fullText += '\n\n' + tagsText;
  }

  // Append code snippet descriptions
  try {
    const snippets = JSON.parse(codeSnippets || '[]') as { description?: string }[];
    const descriptions = snippets.map((s) => s.description).filter(Boolean);
    if (descriptions.length > 0) {
      fullText += '\n\n' + descriptions.join('\n');
    }
  } catch {
    // ignore parse errors
  }

  // Chunk the text
  const chunks = chunkText(fullText);

  const embeddings = chunks.map((chunkText, chunkIndex) => ({
    chunkIndex,
    chunkText,
  }));

  const model = getEmbeddingModel();
  const vectors: { chunkIndex: number; chunkText: string; vector: number[] }[] = [];
  for (const chunk of embeddings) {
    const { embedding } = await embed({ model, value: chunk.chunkText });
    vectors.push({
      chunkIndex: chunk.chunkIndex,
      chunkText: chunk.chunkText,
      vector: embedding,
    });
  }

  const existingResult = db.exec(
    'SELECT vectra_id FROM embeddings WHERE note_id = ?',
    [noteId],
  );
  const currentDbVectraIds = existingResult.length > 0
    ? existingResult[0].values
      .map((row) => row[0] as string | null)
      .filter((vectraId): vectraId is string => Boolean(vectraId))
    : [];
  const noteStatusResult = db.exec(
    'SELECT embedding_status FROM notes WHERE id = ?',
    [noteId],
  );
  const noteStatus = String(noteStatusResult[0]?.values[0]?.[0] ?? 'pending');
  const index = await getIndex();

  if (noteStatus === 'syncing' && await currentVectraIdsCommitted(index, currentDbVectraIds)) {
    db.run("UPDATE notes SET embedding_status = 'done' WHERE id = ?", [noteId]);
    saveDatabase();
    return chunks.length;
  }

  const oldVectraIds = await committedVectraIdsForNote(index, noteId);

  let updateOpen = false;
  let dbSwapped = false;

  try {
    await index.beginUpdate();
    updateOpen = true;

    const newItems: { chunkIndex: number; chunkText: string; vectraId: string }[] = [];
    for (const chunk of vectors) {
      const item = await index.insertItem({
        vector: chunk.vector,
        metadata: {
          noteId: id,
          chunkIndex: chunk.chunkIndex,
          conversationId,
          title,
          projectName,
        } as NoteChunkMeta,
      });

      newItems.push({
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        vectraId: item.id,
      });
    }

    withTransaction(db, () => {
      db.run('DELETE FROM embeddings WHERE note_id = ?', [noteId]);

      for (const item of newItems) {
        db.run(
          `INSERT INTO embeddings (note_id, chunk_index, chunk_text, vectra_id)
           VALUES (?, ?, ?, ?)`,
          [noteId, item.chunkIndex, item.chunkText, item.vectraId],
        );
      }

      db.run("UPDATE notes SET embedding_status = 'syncing' WHERE id = ?", [noteId]);
    });
    dbSwapped = true;
    saveDatabase();

    for (const vectraId of oldVectraIds) {
      await index.deleteItem(vectraId);
    }

    await index.endUpdate();
    updateOpen = false;

    db.run("UPDATE notes SET embedding_status = 'done' WHERE id = ?", [noteId]);
    saveDatabase();
    return chunks.length;
  } catch (error) {
    if (updateOpen) {
      try {
        index.cancelUpdate();
      } catch {
        // Ignore cancel failures and prefer surfacing the original error.
      }
    }

    if (dbSwapped) {
      db.run("UPDATE notes SET embedding_status = 'failed' WHERE id = ?", [noteId]);
      saveDatabase();
    }

    throw error;
  }
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

  const results = await index.queryItems<NoteChunkMeta>(embedding, query, topK);

  // Deduplicate by noteId, keeping highest score
  const db = getDatabase();
  const directResults = await materializeDirectSearchHits(db, results);

  if (!expandRelations || directResults.length === 0) {
    return directResults;
  }

  // Expand along relation edges
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
         WHERE n.id = ? AND n.embedding_status = 'done'`,
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
