# Phase 2 Electron Onboarding Design

## Summary

Phase 2 adds a Windows-first Electron onboarding module for ChatCrystal. The goal is to make the desktop app a complete first-run experience for both local mode and cloud mode, while keeping Phase 2 scoped enough to ship with the npm remote-mode release as `0.5.0`.

The Electron app remains a single installer with two modes:

- **Local memory library**: start the embedded local Core and use the shared local data directory.
- **Cloud super brain**: connect to an existing cloud Core, then load the cloud Web UI directly.

Onboarding is not a one-time dialog. It is a reusable module for first launch, switching modes, connecting to a new cloud Core, retrying failed connections, importing local histories, and showing MCP configuration snippets.

## Product Decisions

### Installer And Platform Scope

- Ship one ChatCrystal Electron installer.
- Do not split the app into local and cloud editions.
- Phase 2 targets Windows x64 first, matching the existing `electron-builder.yml` target.
- macOS and Linux desktop packages are out of scope for Phase 2.

### First Screen

The first onboarding screen must ask the user to choose the memory core:

- **Local memory library**
  - Starts the embedded local Core.
  - Uses the existing shared data directory: `~/.chatcrystal/data`.
  - Keeps CLI, MCP, and Electron local mode on the same local source of truth.

- **Connect super brain**
  - Asks for cloud URL and API token.
  - Connects to the cloud Core.
  - Later loads the cloud Web UI directly.

The UI style is a focused wizard. It should be emotionally resonant but still utilitarian. Suitable connection copy includes:

- `正在连接到您的超级大脑`
- `正在唤醒云端记忆核心`
- `正在验证记忆网络`
- `已连接到超级大脑`

### Cloud Web UI Loading

Cloud mode loads the cloud Web UI directly in the Electron window. Electron does not load a local copy of the SPA and point its API base URL at the cloud.

Reasons:

- The cloud Core already serves the complete Web UI.
- Cloud UI updates do not require updating the Electron package.
- It avoids duplicating API-base routing and CORS logic in the desktop shell.

Trust boundary rules:

- The cloud Web UI must not receive the high-privilege onboarding preload.
- The cloud Web UI must not be able to call local source scanning, local parsing, local import, cloud upload, shell config writes, or token-read IPC.
- Use a separate onboarding `webContents`/window/session, or recreate the main window when switching between onboarding/local app and cloud Web UI. Do not reuse a privileged preload for arbitrary remote content.
- Cloud navigation is locked to the exact saved cloud origin. Block or externalize unexpected navigation and `window.open` targets.

### Cloud Auto Login

Electron stores the cloud URL and API token, verifies them, and then writes the token into the saved cloud Web UI origin before loading the cloud UI.

Rules:

- When saving a new cloud connection, verify the cloud URL and token first via public/private cloud API calls. If verification fails, stay in onboarding and show a recoverable error.
- On startup with a saved cloud connection, verify reachability and token validity before loading the cloud UI. If verification fails, show the Electron cloud connection error page.
- Write the token to the cloud Web UI's `localStorage` only for the exact saved origin, for both HTTP and HTTPS cloud URLs.
- Do not use Electron header injection as the normal login path. The cloud Web UI should behave like a regular logged-in session inside Electron.
- If the existing Web HTTP guard needs an Electron-specific allowance, scope it to the Electron cloud session and exact saved origin. Normal browser behavior should not change.
- If verification succeeds but token injection fails, load the cloud Web UI normally and let its existing auth gate handle login.
- Never inject the token into an arbitrary navigation target.

### HTTP Handling

HTTPS is recommended for cloud mode, but Phase 2 does not block HTTP.

Rules:

- `https://...`: normal recommended path.
- `http://localhost` and `http://127.0.0.1`: allowed for local tunnels and local testing.
- Non-local `http://...`: allowed with an inline recommendation to use HTTPS, not a blocking confirmation.
- Keep the copy light: recommend HTTPS as safer for public deployments, but do not pressure the user with a second confirmation.
- Electron cloud mode uses the same token-localStorage behavior for HTTP and HTTPS so the user gets one consistent login experience.
- MCP snippets for non-local HTTP targets may include `CHATCRYSTAL_ALLOW_INSECURE_REMOTE_HTTP=true` automatically so `crystal mcp` works with the chosen URL. Do not add a second scary confirmation in the MCP step.

### Local And Cloud Import

Both local and cloud modes receive a complete import onboarding path.

Local mode flow:

1. Start embedded local Core.
2. Show `正在唤醒本机记忆核心`.
3. Show an import action for local AI conversation history.
4. If the user starts import, scan, parse, and import into the local database as one complete operation.
5. Test model connectivity.
6. Offer summarization if model connectivity passes.
7. Enter the local Web UI.

Cloud mode flow:

1. Verify cloud Core and token.
2. Show `正在连接到您的超级大脑`.
3. Show an upload action for local AI conversation history.
4. If the user starts upload, scan, parse locally, and upload normalized payloads to the cloud ingest API as one complete operation.
5. Test cloud model connectivity.
6. Offer summarization if model connectivity passes.
7. Enter the cloud Web UI.

Supported sources are the same five Phase 1 sources:

- Claude Code
- Codex CLI
- Cursor
- Trae
- GitHub Copilot

Phase 2 does not include a preview/count layer. Avoid half-complete source discovery UI such as `count: unknown`; if a polished preview cannot be implemented, do not show one.

Import/upload service contract:

- Import or upload starts only after a deliberate user action.
- Once started, the operation may scan, parse, and write/upload because the user has already chosen to import local history.
- Local import should reuse core import logic and return structured result fields: `importedIds`, `replacedIds`, `skippedIds`, `errorIds`, and `summarizationCandidateIds`.
- `summarizationCandidateIds` includes only conversations newly imported or content-replaced by the current confirmed operation. Skipped existing conversations are excluded by default.
- Cloud import should reuse Phase 1 remote item construction, chunking, ingest validation, and dedupe. Electron must not reimplement source parsing.
- Cloud ingest/upload should return the same structured ID categories when possible. If a server response cannot return IDs for a category yet, Phase 2 must add that contract before wiring onboarding summarization.

### Summarization Prompt

After import completes, Electron tests the active Core's LLM and embedding connectivity.

Rules:

- Do not rely only on configured provider fields.
- Run an actual connection test.
- If both required model paths are usable, ask whether to generate summaries now.
- If model connectivity is not usable, do not offer immediate summarization.
- Show a message such as: `本机历史已导入。配置可用的模型后，即可将对话结晶成记忆。`
- Provide an entry point to model settings.
- The onboarding prompt summarizes only the current confirmed import batch by default.
- If implementation reuses the existing all-unsummarized batch endpoint, it must add an explicit "all unsummarized conversations" choice. Do not silently queue old backlog during onboarding.
- Preferred implementation is a batch-by-ids API using `summarizationCandidateIds` returned from the confirmed import/upload result.
- Skipped existing conversations are not summarized by default, even if they are unsummarized. A separate explicit option may offer to summarize skipped-but-unsummarized conversations, with copy that distinguishes them from newly imported memory.
- Persist the current onboarding summarization batch IDs and a local request ID in Electron state before queueing work.
- Add or extend APIs so Electron can query summarization status for specific conversation IDs after restart. Do not rely only on the process-memory queue tracker.
- If the embedded Core restarts with conversations left in `status = 'summarizing'`, onboarding must present resume/retry/skip for the persisted current batch. It must not automatically call the all-unsummarized endpoint.

### MCP Helper

MCP Helper is the final onboarding step.

Phase 2 MCP Helper scope:

- Show `npm install -g chatcrystal`.
- Explain that AI tools usually start MCP automatically from their MCP config.
- Generate copy-ready MCP snippets for the supported AI tools whose MCP config format is known: Codex, Claude Code, Cursor, Trae, and VS Code/GitHub Copilot where applicable.
- Cloud snippets include:
  - `command: crystal`
  - `args: ["mcp"]`
  - `CHATCRYSTAL_BASE_URL`
  - `CHATCRYSTAL_API_TOKEN`
- Local snippets include:
  - `command: crystal`
  - `args: ["mcp"]`
  - `CHATCRYSTAL_BASE_URL` only when the active local Core is not the CLI default or when clarity helps the user.
- Do not require `crystal connect`.
- Do not automatically write AI tool config files.
- Do not automatically start MCP.
- Do not bundle a dedicated `chatcrystal-mcp.exe` in Phase 2.
- Do not automatically install npm CLI in Phase 2.

Cloud snippets include the token in plain text because the goal is copy-ready configuration. The UI must label this clearly: the snippet contains the user's access token and should only be copied into trusted AI tools. Local snippets do not include a token unless local auth is introduced in a future phase.

Snippet source-of-truth:

- Cloud mode snippets always include `CHATCRYSTAL_BASE_URL` and `CHATCRYSTAL_API_TOKEN` from the saved Electron cloud connection.
- Local mode snippets use the active local Core URL. If the embedded local Core is not on `3721`, the snippet must use the actual port and clearly state that MCP depends on this Electron instance staying open.
- Electron does not assume `crystal mcp` can read Electron `userData`. CLI/MCP saved connection in `~/.chatcrystal/client.json` is a separate Phase 1 mechanism and is not silently synchronized in Phase 2.
- A future "sync Electron cloud connection to CLI" action can be added later, but Phase 2 keeps snippets copy-ready instead of mutating CLI config.

## Architecture

### Startup Matrix

Electron startup must choose the active core before starting services:

| Saved state | Embedded local Core | Window target | Notes |
| --- | --- | --- | --- |
| No onboarding/default mode | Not started | Onboarding Renderer | First screen is local/cloud choice. |
| Local mode | Started | Local Web UI | Uses `~/.chatcrystal/data`. |
| Cloud mode | Not started | Cloud Web UI | Verify cloud URL/token first. |
| Cloud failure recovery | Not started | Electron error page | Retry/edit/open cloud login/temporary local actions. |
| Temporary local recovery | Started | Local Web UI with clear temporary label | Does not change saved default mode. |

Tray and menu actions must route through the active mode. In cloud mode, search/open actions target the cloud Web UI; local-only actions are hidden or relabeled. They must not silently jump the user back to a local memory library.

### Watcher During Onboarding

The existing local server watcher auto-imports changed files. During Electron onboarding this would bypass the user's explicit import action, so it is disabled by default.

Rules:

- Add a server option or environment switch such as `createServer({ startWatcher: false })` for Electron onboarding.
- Local onboarding may start the embedded Core for API access, but it must not start the auto-import watcher until onboarding reaches `done` or the user explicitly enables automatic import.
- While onboarding is active, file changes must not call `importAll()`.
- Cloud mode does not start the embedded local Core and therefore does not start the local watcher.
- Tests should cover that the explicit onboarding import/upload action remains the only import path while onboarding is incomplete.

### Modules

#### Electron Shell

Responsible for:

- Choosing whether to show onboarding, local Web UI, cloud Web UI, or an error page.
- Starting and stopping the embedded local Core only when local mode or temporary local recovery requires it.
- Loading the cloud Web UI after successful cloud verification.
- Handling tray/menu entries for continuing onboarding, importing histories, MCP helper, and switching modes.
- Displaying a cloud connection error page with recovery actions.

#### Onboarding Renderer

An Electron-specific renderer page. It does not depend on the local Core already running.

Responsible for:

- Mode choice.
- Cloud connection form.
- Connection progress screens.
- Import/upload action.
- Import progress.
- Model connectivity result.
- Summarization prompt.
- MCP helper snippets.
- Skip/continue controls.

The Onboarding Renderer should be a real page, not a sequence of native dialogs.

#### Preload / IPC Bridge

Renderer code must not directly read local files, mutate configuration, or call parser services. Preload exposes a narrow API over IPC.

High-privilege preload is available only to the Electron-owned onboarding/local renderer. Remote cloud Web UI content gets no local filesystem/import/config IPC.

Required API surface:

- Read and write Electron onboarding state.
- Read and write cloud connection config.
- Verify cloud Core URL and token.
- Start local Core.
- Run explicit local history import to local Core.
- Run explicit local history upload to cloud Core.
- Test model connectivity for the active Core.
- Trigger batch summarization for the active Core.
- Generate MCP snippets.
- Open local or cloud Web UI.
- Clear or repair cloud connection state.

IPC guard rules:

- Every high-privilege `ipcMain` handler checks `event.senderFrame.origin`, the current onboarding state, and the active mode before doing work.
- Import/upload IPC is callable only from the onboarding renderer while the state machine is in a matching import state.
- Cloud Web UI cannot call import/upload IPC even when it is loaded inside Electron.
- Navigation and external-open handlers enforce the exact saved cloud origin for cloud mode.

#### Core Reuse Layer

Phase 2 must reuse Phase 1 server/core services:

- Source adapters.
- Local import logic.
- Remote import item construction.
- Remote upload chunking.
- Cloud ingest validation and dedupe.
- Config connection testing.
- Summarization queue/API.
- New or extended summarize-by-ids API for onboarding's current import batch.

Do not reimplement parsing in Electron.

Cloud upload may reuse parser/import payload code from the server package inside Electron main, but it must not start the local Fastify Core or write to the local database just to upload to cloud.

### Storage

Electron `app.getPath("userData")` stores shell-only state:

- Window state.
- Onboarding state.
- Default mode.
- Cloud URL and token.
- Step completion/skipped flags.

On Windows with the current app identity, this resolves to `%APPDATA%\ChatCrystal`.

Cloud token storage is plain JSON for Phase 2. This is an intentional product decision: users can inspect, change, and copy the token easily, and MCP snippets can be generated without credential-manager coupling.

Plaintext-token constraints:

- Store the token only in Electron `userData`, not in ChatCrystal's conversation database.
- Write files with restrictive permissions where supported.
- Redact tokens from logs, status views, diagnostics, screenshots, and error reports.
- Hide the token in normal UI, but allow deliberate reveal/copy in cloud settings and MCP snippet flows.
- Label the risk clearly: anyone who can read the user's local Electron config can use the cloud token.

ChatCrystal data remains separate:

- Local mode source of truth: `~/.chatcrystal/data`.
- Cloud mode source of truth: cloud Core `/data` volume.

Electron `userData` must not become a second database source of truth.

## Onboarding State Machine

The implementation should use an explicit state machine or an equivalent reducer-driven model with named states.

Core states:

- `mode-choice`
- `cloud-connect`
- `connecting-cloud`
- `starting-local`
- `connection-error`
- `import-choice`
- `importing`
- `import-complete`
- `model-test`
- `summarize-prompt`
- `summarizing`
- `mcp-helper`
- `done`

Rules:

- Mode choice cannot be skipped.
- Cloud users cannot enter cloud Web UI until cloud connection succeeds. If saved-token verification fails, they see the Electron recovery page first; opening the cloud Web UI login page is an explicit recovery action.
- Local users cannot enter local Web UI until local Core starts successfully.
- Import/upload can be skipped.
- Summarization can be skipped.
- MCP Helper can be skipped.
- Skipped steps remain available from menu/settings.
- Onboarding state persists enough to resume after closing the app.
- If the app closes during `importing`, restart resumes to a safe retry state, not a stuck progress screen. The user can retry the confirmed import/upload action.
- If the app closes during `summarizing`, restart loads the persisted onboarding batch IDs/request ID, queries per-conversation status from the active Core, and shows resume/retry/skip. It must not blindly enqueue the same batch again or call the all-unsummarized endpoint.

## Error Handling

### Token Invalid

Trigger: cloud API returns unauthorized for saved token.

Copy:

- `访问 token 已失效`
- `云端核心拒绝了当前 token`

Actions:

- Re-enter token.
- Clear cloud connection.
- Open cloud login page.

### Cloud Unreachable

Trigger: DNS, TLS, refused connection, timeout, or server unavailable.

Copy:

- `暂时无法抵达您的超级大脑`

Actions:

- Retry.
- Edit URL.
- Temporarily use local mode.

Temporary local mode must not silently change the default mode. It should be clear that the user is currently using local mode, not the cloud super brain.

### Target Is Not Cloud Mode

Trigger: server status does not report cloud mode when saving a cloud connection.

Copy:

- `这个地址不是云端 Core`

Actions:

- Edit URL.
- Review Docker cloud deployment docs.

### HTTP Warning

Trigger: non-local HTTP URL.

Behavior:

- Show inline warning only.
- Do not block.
- Recommend HTTPS for public deployments.

### No Local Sources Found

Copy:

- `还没有发现可导入的本机记忆源`

Actions:

- Skip.
- Retry import/upload.
- View supported sources.

### Partial Source Read Failure

Copy:

- `部分记忆源暂时无法读取`

Actions:

- Continue with readable sources.
- View details.
- Retry.

### Model Connectivity Unavailable

Copy:

- `模型连接尚不可用`

Actions:

- Go to settings.
- Skip summarization.
- Enter ChatCrystal.

## Out Of Scope For Phase 2

- Multi-user accounts.
- Enterprise credential management.
- Electron-bundled MCP executable.
- Automatic npm CLI installation.
- Automatic MCP config file writes.
- macOS/Linux Electron packages.
- Cloud server auto-provisioning.
- Multiple cloud profile management.
- Offline sync or conflict resolution.
- A new model-provider setup wizard.

## Release Plan

Do not publish a standalone npm release for Phase 1 remote mode. Phase 2 completion should ship as `0.5.0`, covering:

- Docker/GHCR cloud deployment.
- Electron onboarding.
- Electron local and cloud modes.
- CLI/npm remote mode.
- MCP remote configuration snippets.
- Local parsing with local or cloud import targets.

## Open Implementation Notes

- Keep the Onboarding Renderer visually focused. The first screen must still show the local/cloud choice.
- Keep copy emotional at moments of transition, not throughout the whole UI.
- Prefer direct, actionable error recovery over generic failure messages.
- Reuse Phase 1 tests where possible and add Electron-focused tests around state transitions, config persistence, and IPC boundaries.
