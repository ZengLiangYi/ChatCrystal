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
import { antigravityAdapter } from "./adapters/antigravity.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { clineAdapter } from "./adapters/cline.js";
import { codexAdapter } from "./adapters/codex.js";
import { continueAdapter } from "./adapters/continue.js";
import { copilotAdapter } from "./adapters/copilot.js";
import { copilotCliAdapter } from "./adapters/copilot-cli.js";
import { cursorAdapter } from "./adapters/cursor.js";
import { droidAdapter } from "./adapters/droid.js";
import { dshAdapter } from "./adapters/dsh.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { gooseAdapter } from "./adapters/goose.js";
import { kiloAdapter } from "./adapters/kilo.js";
import { opencodeAdapter } from "./adapters/opencode.js";
import { qwenAdapter } from "./adapters/qwen.js";
import { rooAdapter } from "./adapters/roo.js";
import { traeAdapter } from "./adapters/trae.js";
import { workbuddyAdapter } from "./adapters/workbuddy.js";
import { registerAdapter } from "./registry.js";

// Original five sources
registerAdapter(claudeCodeAdapter);
registerAdapter(codexAdapter);
registerAdapter(cursorAdapter);
registerAdapter(traeAdapter);
registerAdapter(copilotAdapter);

// 2026 agent-harness expansion
registerAdapter(geminiAdapter);
registerAdapter(qwenAdapter);
registerAdapter(opencodeAdapter);
registerAdapter(clineAdapter);
registerAdapter(rooAdapter);
registerAdapter(kiloAdapter);
registerAdapter(copilotCliAdapter);
registerAdapter(continueAdapter);
registerAdapter(dshAdapter);
registerAdapter(workbuddyAdapter);
registerAdapter(antigravityAdapter);
registerAdapter(droidAdapter);
registerAdapter(gooseAdapter);
