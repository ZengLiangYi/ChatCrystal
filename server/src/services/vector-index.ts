import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalIndex } from 'vectra';
import { appConfig } from '../config.js';

const INDEX_PATH = resolve(appConfig.dataDir, 'vectra-index');

let _index: LocalIndex | null = null;

export async function getIndex(): Promise<LocalIndex> {
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

export async function committedVectraIdsForNote(index: LocalIndex, noteId: number): Promise<string[]> {
  const items = await index.listItemsByMetadata({ noteId });
  return items.map((item) => item.id);
}

export async function deleteVectraItemsForNote(index: LocalIndex, noteId: number): Promise<number> {
  const vectraIds = await committedVectraIdsForNote(index, noteId);
  if (vectraIds.length === 0) {
    return 0;
  }

  let updateOpen = false;
  try {
    await index.beginUpdate();
    updateOpen = true;

    for (const vectraId of vectraIds) {
      await index.deleteItem(vectraId);
    }

    await index.endUpdate();
    updateOpen = false;
    return vectraIds.length;
  } catch (error) {
    if (updateOpen) {
      try {
        index.cancelUpdate();
      } catch {
        // Ignore cancel failures and prefer surfacing the original error.
      }
    }

    throw error;
  }
}

export async function deleteNoteVectraItems(noteId: number): Promise<number> {
  const index = await getIndex();
  return deleteVectraItemsForNote(index, noteId);
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
