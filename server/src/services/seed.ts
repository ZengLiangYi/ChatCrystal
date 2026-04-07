import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabase, saveDatabase } from '../db/index.js';

interface SeedConversation {
  id: string;
  slug: string;
  source: string;
  project_dir: string;
  project_name: string;
  cwd: string;
  git_branch: string;
  message_count: number;
  first_message_at: string;
  last_message_at: string;
  file_path: string;
  file_size: number;
  file_mtime: string;
  status: string;
}

interface SeedNote {
  conversation_id: string;
  title: string;
  summary: string;
  key_conclusions: string;
  code_snippets: string;
  tags: string[];
}

interface SeedData {
  conversations: SeedConversation[];
  notes: SeedNote[];
  tags: string[];
}

export function seedDemoData(): void {
  const db = getDatabase();

  // Only seed if the database has zero conversations
  const count =
    db.exec('SELECT COUNT(*) as c FROM conversations')[0]?.values[0]?.[0] ?? 0;
  if (Number(count) > 0) {
    return;
  }

  console.log('[Seed] Empty database detected — inserting demo data...');

  try {
    const seedPath = join(import.meta.dirname, '../data/seed-notes.json');
    const seedData: SeedData = JSON.parse(readFileSync(seedPath, 'utf-8'));
    db.run('BEGIN');

    // Insert conversations
    const convStmt = db.prepare(
      `INSERT OR IGNORE INTO conversations (
        id, slug, source, project_dir, project_name, cwd, git_branch,
        message_count, first_message_at, last_message_at,
        file_path, file_size, file_mtime, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const conv of seedData.conversations) {
      convStmt.run([
        conv.id,
        conv.slug,
        conv.source,
        conv.project_dir,
        conv.project_name,
        conv.cwd,
        conv.git_branch,
        conv.message_count,
        conv.first_message_at,
        conv.last_message_at,
        conv.file_path,
        conv.file_size,
        conv.file_mtime,
        conv.status,
      ]);
    }
    convStmt.free();

    // Insert tags (all unique tags used across notes)
    const tagStmt = db.prepare(
      `INSERT OR IGNORE INTO tags (name) VALUES (?)`,
    );
    for (const tag of seedData.tags) {
      tagStmt.run([tag]);
    }
    tagStmt.free();

    // Insert notes and note_tags
    const noteStmt = db.prepare(
      `INSERT INTO notes (
        conversation_id, title, summary, key_conclusions, code_snippets
      ) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const note of seedData.notes) {
      noteStmt.run([
        note.conversation_id,
        note.title,
        note.summary,
        note.key_conclusions,
        note.code_snippets,
      ]);

      // Retrieve the AUTOINCREMENT-assigned ID
      const noteIdResult = db.exec(
        `SELECT id FROM notes WHERE conversation_id = ?`,
        [note.conversation_id],
      );
      const noteId = noteIdResult[0]?.values[0]?.[0];

      // Link tags to this note
      if (noteId != null) {
        for (const tagName of note.tags) {
          const tagResult = db.exec(
            `SELECT id FROM tags WHERE name = ?`,
            [tagName],
          );
          const tagId = tagResult[0]?.values[0]?.[0];
          if (tagId != null) {
            db.run(
              `INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)`,
              [noteId, tagId],
            );
          }
        }
      }
    }
    noteStmt.free();

    db.run('COMMIT');
    saveDatabase();
    console.log('[Seed] Demo data inserted successfully.');
  } catch (err) {
    try { db.run('ROLLBACK'); } catch { /* ignore if no transaction active */ }
    console.error('[Seed] Failed to load demo data:', err);
  }
}
