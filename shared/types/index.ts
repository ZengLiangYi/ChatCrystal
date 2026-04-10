// ==========================================
// ChatCrystal Shared Types
// ==========================================

// --- Conversation & Messages ---

export interface Conversation {
  id: string;
  slug: string | null;
  source: string; // 'claude-code' | 'codex' | 'cursor' | 'trae' | 'copilot'
  project_dir: string;
  project_name: string;
  cwd: string | null;
  git_branch: string | null;
  message_count: number;
  first_message_at: string;
  last_message_at: string;
  file_path: string;
  file_size: number;
  file_mtime: string;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
}

export type ConversationStatus =
  | 'imported'
  | 'summarizing'
  | 'summarized'
  | 'error';

export interface Message {
  id: string;
  conversation_id: string;
  parent_uuid: string | null;
  type: 'user' | 'assistant' | 'system';
  role: string | null;
  content: string;
  has_tool_use: boolean;
  has_code: boolean;
  thinking: string | null;
  timestamp: string;
  sort_order: number;
}

// --- Notes ---

export interface Note {
  id: number;
  conversation_id: string;
  title: string;
  summary: string;
  key_conclusions: string[];
  code_snippets: CodeSnippet[];
  raw_llm_response: string | null;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  tags?: string[];
}

export interface CodeSnippet {
  language: string;
  code: string;
  description: string;
}

// --- Tags ---

export interface Tag {
  id: number;
  name: string;
  count?: number;
}

// --- Note Relations ---

export type RelationType =
  | 'CAUSED_BY'
  | 'LEADS_TO'
  | 'RESOLVED_BY'
  | 'SIMILAR_TO'
  | 'CONTRADICTS'
  | 'DEPENDS_ON'
  | 'EXTENDS'
  | 'REFERENCES';

export interface NoteRelation {
  id: number;
  source_note_id: number;
  target_note_id: number;
  relation_type: RelationType;
  confidence: number;
  description: string | null;
  created_by: 'llm' | 'manual';
  created_at: string;
  // Hydrated fields (joined from notes table)
  source_title?: string;
  target_title?: string;
}

// --- Search ---

export interface SearchResult {
  note_id: number;
  conversation_id: string;
  title: string;
  summary: string;
  score: number;
  tags: string[];
  project_name: string;
}

// --- API Responses ---

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

// --- Config ---

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'azure' | 'custom';
  baseURL?: string;
  apiKey?: string;
  model: string;
}

export interface EmbeddingConfig {
  provider: 'ollama' | 'openai' | 'google' | 'azure' | 'custom';
  baseURL?: string;
  apiKey?: string;
  model: string;
}

export interface AppConfig {
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  claudeProjectsDir: string;
  theme: string;
}

// --- Parser Adapter Types ---

export interface SourceInfo {
  name: string;
  displayName: string;
  dataDir: string;
  conversationCount: number;
}

export interface ConversationMeta {
  id: string;
  source: string;
  filePath: string;
  fileSize: number;
  fileMtime: string;
  projectDir: string;
}

export interface ParsedConversation {
  id: string;
  slug: string | null;
  source: string;
  projectDir: string;
  projectName: string;
  cwd: string | null;
  gitBranch: string | null;
  messages: ParsedMessage[];
  firstMessageAt: string;
  lastMessageAt: string;
}

export interface ParsedMessage {
  id: string;
  parentUuid: string | null;
  type: 'user' | 'assistant' | 'system';
  role: string | null;
  content: string;
  hasToolUse: boolean;
  hasCode: boolean;
  thinking: string | null;
  timestamp: string;
}

// --- Status ---

export interface SystemStatus {
  server: boolean;
  database: boolean;
  ollama: boolean;
  watcher: boolean;
  sources: SourceInfo[];
  stats: {
    totalConversations: number;
    totalNotes: number;
    totalTags: number;
  };
}
