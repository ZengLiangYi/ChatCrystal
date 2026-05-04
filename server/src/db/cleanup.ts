import type { Database } from 'sql.js';

export function cleanupOrphanTags(db: Database): void {
  db.run(`
    DELETE FROM note_tags
     WHERE NOT EXISTS (
       SELECT 1 FROM notes n WHERE n.id = note_tags.note_id
     )
        OR NOT EXISTS (
       SELECT 1 FROM tags t WHERE t.id = note_tags.tag_id
     )
  `);

  db.run(`
    DELETE FROM tags
     WHERE NOT EXISTS (
       SELECT 1
         FROM note_tags nt
         JOIN notes n ON n.id = nt.note_id
        WHERE nt.tag_id = tags.id
     )
  `);
}
