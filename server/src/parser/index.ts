/**
 * Parser module entry point.
 * Registers all built-in adapters on import.
 */
export { registerAdapter, getAdapter, getAllAdapters, detectAllSources } from './registry.js';
export type { SourceAdapter } from './adapter.js';

// Register built-in adapters
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { registerAdapter } from './registry.js';

registerAdapter(claudeCodeAdapter);
