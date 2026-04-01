/**
 * SQLite schema definitions for ChatCrystal.
 * Uses sql.js (WASM-based SQLite, no native compilation).
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  slug TEXT,
  source TEXT NOT NULL DEFAULT 'claude-code',
  project_dir TEXT NOT NULL,
  project_name TEXT NOT NULL,
  cwd TEXT,
  git_branch TEXT,
  message_count INTEGER DEFAULT 0,
  first_message_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_mtime TEXT,
  status TEXT DEFAULT 'imported',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_uuid TEXT,
  type TEXT NOT NULL,
  role TEXT,
  content TEXT NOT NULL,
  has_tool_use INTEGER DEFAULT 0,
  has_code INTEGER DEFAULT 0,
  thinking TEXT,
  timestamp TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_conclusions TEXT,
  code_snippets TEXT,
  raw_llm_response TEXT,
  is_edited INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  vectra_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(note_id, chunk_index),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_dir);
CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_note ON embeddings(note_id);

CREATE TABLE IF NOT EXISTS note_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_note_id INTEGER NOT NULL,
  target_note_id INTEGER NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  description TEXT,
  created_by TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_note_id, target_note_id, relation_type),
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_relations_source ON note_relations(source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_relations_target ON note_relations(target_note_id);
`;
