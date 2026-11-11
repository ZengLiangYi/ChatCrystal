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
import { almaAdapter } from "./adapters/alma.js";
import { antigravityAdapter } from "./adapters/antigravity.js";
import { claudeDesktopAdapter } from "./adapters/claude-desktop.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { clineAdapter } from "./adapters/cline.js";
import { codebuddyAdapter } from "./adapters/codebuddy.js";
import { codexAdapter } from "./adapters/codex.js";
import { continueAdapter } from "./adapters/continue.js";
import { copilotAdapter } from "./adapters/copilot.js";
import { copilotCliAdapter } from "./adapters/copilot-cli.js";
import { cursorAdapter } from "./adapters/cursor.js";
import { cindyAdapter } from "./adapters/cindy.js";
import { droidAdapter } from "./adapters/droid.js";
import { dshAdapter } from "./adapters/dsh.js";
import { geminiAdapter } from "./adapters/gemini.js";
import { gooseAdapter } from "./adapters/goose.js";
import { grokAdapter } from "./adapters/grok.js";
import { hermesAdapter } from "./adapters/hermes.js";
import { kiloAdapter } from "./adapters/kilo.js";
import { kimiAdapter } from "./adapters/kimi.js";
import { minimaxCodeAdapter } from "./adapters/minimax-code.js";
import { ompAdapter } from "./adapters/omp.js";
import { opencodeAdapter } from "./adapters/opencode.js";
import { piAdapter } from "./adapters/pi.js";
import { qoderAdapter } from "./adapters/qoder.js";
import { qoderCnAdapter } from "./adapters/qoder-cn.js";
import { qwenAdapter } from "./adapters/qwen.js";
import { raftAdapter } from "./adapters/raft.js";
import { rooAdapter } from "./adapters/roo.js";
import { traeAdapter } from "./adapters/trae.js";
import { workbuddyAdapter } from "./adapters/workbuddy.js";
import { zcodeAdapter } from "./adapters/zcode.js";
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

// 2026 expansion, second wave: the rest of magpie's session readers
registerAdapter(piAdapter);
registerAdapter(ompAdapter);
registerAdapter(raftAdapter);
registerAdapter(cindyAdapter);
registerAdapter(qoderAdapter);
registerAdapter(qoderCnAdapter);
registerAdapter(codebuddyAdapter);
registerAdapter(claudeDesktopAdapter);
registerAdapter(zcodeAdapter);
registerAdapter(hermesAdapter);
registerAdapter(almaAdapter);
registerAdapter(grokAdapter);
registerAdapter(kimiAdapter);
registerAdapter(minimaxCodeAdapter);
