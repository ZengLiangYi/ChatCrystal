/**
 * Qoder CN adapter.
 *
 * The China build of Qoder's CLI (qoderclicn) keeps its sessions in exactly the
 * same Claude Code style layout as Qoder itself:
 *
 *   <dataDir>/projects/<mangled-cwd>/<id>.jsonl
 *
 * so it shares Qoder's implementation; only the data folder (`~/.qoder-cn`,
 * `$QODERCN_CONFIG_DIR`) and the source id differ. WSL counterparts live under
 * the distro home's `.qoder-cn` folder.
 */

import { appConfig } from "../../config.js";
import type { SourceAdapter } from "../adapter.js";
import { createQoderAdapter } from "./qoder.js";

export const qoderCnAdapter: SourceAdapter = createQoderAdapter({
	name: "qoder-cn",
	displayName: "Qoder CN",
	parserVersion: "qoder-cn@1",
	localRoot: () => appConfig.qoderCnDataDir,
	wslRelativePath: ".qoder-cn",
});
