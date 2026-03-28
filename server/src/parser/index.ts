/**
 * Parser module entry point.
 * Registers all built-in adapters on import.
 */

export type { SourceAdapter } from "./adapter.js";
export {
	detectAllSources,
	getAdapter,
	getAllAdapters,
	registerAdapter,
} from "./registry.js";

// Register built-in adapters
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { codexAdapter } from "./adapters/codex.js";
import { cursorAdapter } from "./adapters/cursor.js";
import { registerAdapter } from "./registry.js";

registerAdapter(claudeCodeAdapter);
registerAdapter(codexAdapter);
registerAdapter(cursorAdapter);
