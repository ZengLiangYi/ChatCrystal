import { readFileSync } from "node:fs";
import path from "node:path";

export function getOnboardingDataUrl(initialError = ""): string {
	const iconPath = path.join(__dirname, "..", "icon.png");
	let iconUrl = "";
	try {
		iconUrl = `data:image/png;base64,${readFileSync(iconPath).toString("base64")}`;
	} catch {
		// The title still renders if an unpacked/package layout omits the icon.
	}
	const html = `<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>ChatCrystal Onboarding</title>
	<style>
		:root {
			color-scheme: dark;
			font-family: "Aptos", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif;
			background: #101113;
			color: #f2f0ea;
		}
		body { margin: 0; min-width: 320px; background: #101113; }
		.titlebar {
			height: 44px;
			display: flex;
			align-items: center;
			border-bottom: 1px solid #2a2d31;
			background: rgba(16, 17, 19, 0.94);
			-webkit-app-region: drag;
			box-sizing: border-box;
		}
		.titlebar-brand {
			width: 224px;
			height: 100%;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 0 12px;
			border-right: 1px solid #2a2d31;
			box-sizing: border-box;
		}
		.titlebar-brand img { width: 20px; height: 20px; }
		.titlebar-name { font-size: 13px; font-weight: 700; line-height: 1.2; }
		.titlebar-title { flex: 1; min-width: 0; padding: 0 16px; color: #a7a29a; font-size: 12px; }
		.titlebar-controls { height: 100%; display: flex; -webkit-app-region: no-drag; }
		.titlebar-controls button {
			width: 46px;
			height: 100%;
			border: 0;
			border-radius: 0;
			background: transparent;
			color: #a7a29a;
			font-size: 15px;
			font-weight: 400;
			padding: 0;
			cursor: default;
		}
		.titlebar-controls button:hover { background: #202329; color: #f2f0ea; }
		.titlebar-controls button.close:hover { background: #ef4444; color: #ffffff; }
		main { min-height: calc(100vh - 44px); display: grid; place-items: center; padding: 32px; box-sizing: border-box; background: linear-gradient(180deg, rgba(255,255,255,.015), rgba(255,255,255,0) 96px), #101113; }
		section { width: min(840px, 100%); border: 1px solid #2a2d31; background: #15171a; padding: 28px; border-radius: 8px; box-sizing: border-box; box-shadow: 0 24px 80px rgba(0,0,0,.24); }
		h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.2; letter-spacing: 0; }
		p { margin: 8px 0 18px; color: #a7a29a; line-height: 1.7; }
		.row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
		button { border: 0; border-radius: 6px; padding: 11px 14px; background: #e7b65f; color: #17120a; font-weight: 700; cursor: pointer; }
		button.secondary { background: #202329; color: #f2f0ea; }
		button:disabled { cursor: not-allowed; opacity: .6; }
		label { display: block; color: #a7a29a; font-size: 14px; margin-top: 12px; }
		input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 11px; border-radius: 6px; border: 1px solid #2a2d31; background: #0b0c0e; color: #f2f0ea; }
		pre { white-space: pre-wrap; overflow: auto; background: #0b0c0e; padding: 14px; border-radius: 6px; border: 1px solid #2a2d31; max-height: 320px; }
		.hint { color: #80a7ff; }
		.error { color: #fca5a5; }
		.ok { color: #63d297; }
	</style>
</head>
<body>
	<div class="titlebar">
		<div class="titlebar-brand">
			${iconUrl ? `<img src="${iconUrl}" alt="" />` : ""}
			<div>
				<div class="titlebar-name">ChatCrystal</div>
			</div>
		</div>
		<div class="titlebar-title"></div>
		<div class="titlebar-controls">
			<button id="window-minimize" title="最小化" aria-label="最小化">-</button>
			<button id="window-maximize" title="最大化" aria-label="最大化">□</button>
			<button id="window-close" class="close" title="关闭" aria-label="关闭">×</button>
		</div>
	</div>
	<main><section id="app"><h1>正在唤醒您的超级大脑</h1></section></main>
	<script>
		const api = window.chatcrystalOnboarding;
		const controls = window.electronAPI && window.electronAPI.windowControls;
		const app = document.getElementById("app");
		const initialError = ${JSON.stringify(initialError)};
		if (controls) {
			document.getElementById("window-minimize").onclick = () => controls.minimize();
			document.getElementById("window-maximize").onclick = () => controls.toggleMaximize();
			document.getElementById("window-close").onclick = () => controls.close();
		}
		const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
		const initialErrorHtml = () => initialError ? "<p class='error'>" + escapeHtml(initialError) + "</p>" : "";
		const showError = (err, fallback = "操作失败") => {
			const message = err && err.message ? err.message : String(err || fallback);
			const target = document.getElementById("status");
			if (target) {
				target.className = "error";
				target.textContent = message;
			}
		};
		function renderModeChoice() {
			app.innerHTML = "<h1>选择您的记忆核心</h1>" + initialErrorHtml() + "<p>本地记忆库适合开箱即用；云端超级大脑适合多台设备共享同一套记忆。</p><div class='row'><button id='local'>本地记忆库</button><button id='cloud' class='secondary'>连接超级大脑</button></div><p id='status' class='hint'></p>";
			document.getElementById("local").onclick = async () => {
				document.getElementById("status").textContent = "正在启动本地记忆核心";
				try {
					await api.startLocal();
					renderImport("local");
				} catch (err) {
					showError(err, "本地核心启动失败");
				}
			};
			document.getElementById("cloud").onclick = () => renderCloudForm();
		}
		function renderCloudForm() {
			app.innerHTML = "<h1>连接超级大脑</h1><p>输入云端地址和 token。推荐使用 HTTPS，会更安全。</p><label>云端 URL<input id='url' placeholder='https://chatcrystal.example.com' /></label><label>访问 token<input id='token' type='password' placeholder='CHATCRYSTAL_API_TOKEN' /></label><div class='row'><button id='connect'>连接</button><button id='back' class='secondary'>返回</button></div><p id='status' class='hint'></p>";
			document.getElementById("back").onclick = renderModeChoice;
			document.getElementById("connect").onclick = async () => {
				const button = document.getElementById("connect");
				button.disabled = true;
				document.getElementById("status").className = "hint";
				document.getElementById("status").textContent = "正在连接到您的超级大脑";
				try {
					const result = await api.saveCloudConnection({
						baseUrl: document.getElementById("url").value,
						token: document.getElementById("token").value,
					});
					if (result && result.httpsRecommended) {
						renderHttpsRecommendation();
						return;
					}
					renderImport("cloud");
				} catch (err) {
					showError(err, "云端连接失败");
				} finally {
					button.disabled = false;
				}
			};
		}
		function renderHttpsRecommendation() {
			app.innerHTML = "<h1>已连接超级大脑</h1><p class='hint'>当前云端地址正在使用 HTTP。可以继续使用；后续推荐升级到 HTTPS，会更安全。</p><div class='row'><button id='continue'>继续</button></div>";
			document.getElementById("continue").onclick = () => renderImport("cloud");
		}
		function renderImport(mode) {
			const action = mode === "cloud" ? "上传到超级大脑" : "导入到本地记忆库";
			app.innerHTML = "<h1>导入本机 AI 对话历史</h1><p>支持 Claude Code、Codex CLI、Cursor、Trae、GitHub Copilot。开始后会扫描并导入本机历史。</p><div class='row'><button id='run'>" + action + "</button><button id='skip' class='secondary'>稍后再说</button></div><pre id='log'></pre>";
			document.getElementById("run").onclick = async () => {
				const log = document.getElementById("log");
				log.textContent = mode === "cloud" ? "正在上传本机记忆..." : "正在导入本机记忆...";
				try {
					const result = mode === "cloud" ? await api.uploadLocalHistory() : await api.importLocalHistory();
					log.textContent = JSON.stringify(result, null, 2);
					await maybeSummarize(mode, result);
				} catch (err) {
					log.textContent = err && err.message ? err.message : String(err);
				}
			};
			document.getElementById("skip").onclick = () => renderMcp(mode);
		}
		async function maybeSummarize(mode, result) {
			const ids = Array.isArray(result && result.summarizationCandidateIds) ? result.summarizationCandidateIds : [];
			if (ids.length === 0) {
				renderMcp(mode);
				return;
			}
			try {
				const model = await api.testModel(mode);
				if (model && model.llm && model.embedding && model.llm.connected && model.embedding.connected) {
					app.innerHTML = "<h1>将对话结晶成记忆？</h1><p>模型已连接，可以现在总结本次新导入的内容。</p><div class='row'><button id='yes'>开始总结</button><button id='no' class='secondary'>稍后</button></div><p id='status' class='hint'></p>";
					document.getElementById("yes").onclick = async () => {
						document.getElementById("status").textContent = "正在将新对话结晶成记忆";
						await api.summarizeBatch({ mode, conversationIds: ids });
						renderMcp(mode);
					};
					document.getElementById("no").onclick = () => renderMcp(mode);
					return;
				}
			} catch {}
			renderMcp(mode);
		}
		async function renderMcp(mode) {
			const snippet = await api.getMcpSnippet(mode);
			app.innerHTML = "<h1>连接您的 AI 工具</h1><p>把下面配置复制到 AI 工具的 MCP 配置里。AI 工具会按需启动 ChatCrystal MCP。</p><pre>" + escapeHtml(JSON.stringify(snippet, null, 2)) + "</pre><div class='row'><button id='open'>进入 ChatCrystal</button></div>";
			document.getElementById("open").onclick = () => api.openApp(mode);
		}
		renderModeChoice();
	</script>
</body>
</html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
