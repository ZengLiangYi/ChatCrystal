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

### Cloud Auto Login

Electron stores the cloud URL and API token, verifies them, and then injects the token only into the saved cloud origin before loading the cloud UI.

Rules:

- When saving a new cloud connection, verify the cloud URL and token first via public/private cloud API calls. If verification fails, stay in onboarding and show a recoverable error.
- On startup with a saved cloud connection, verify reachability and token validity before loading the cloud UI. If verification fails, show the Electron cloud connection error page.
- Inject the token only for the exact saved origin.
- If verification succeeds but token injection fails, load the cloud Web UI normally and let its existing auth gate handle login.
- Never inject the token into an arbitrary navigation target.

### HTTP Handling

HTTPS is recommended for cloud mode, but Phase 2 does not block HTTP.

Rules:

- `https://...`: normal recommended path.
- `http://localhost` and `http://127.0.0.1`: allowed for local tunnels and local testing.
- Non-local `http://...`: allowed with an inline warning, not a blocking confirmation.
- Warning copy should make the risk explicit: tokens travel over an unencrypted connection and public deployments should use HTTPS.

### Local And Cloud Import

Both local and cloud modes receive a complete import onboarding path.

Local mode flow:

1. Start embedded local Core.
2. Show `正在唤醒本机记忆核心`.
3. Scan the five supported local sources.
4. Show scan results.
5. User confirms import.
6. Import into the local database.
7. Test model connectivity.
8. Offer summarization if model connectivity passes.
9. Enter the local Web UI.

Cloud mode flow:

1. Verify cloud Core and token.
2. Show `正在连接到您的超级大脑`.
3. Scan the five supported local sources.
4. Show scan results.
5. User confirms upload.
6. Parse locally and upload normalized payloads to the cloud ingest API.
7. Test cloud model connectivity.
8. Offer summarization if model connectivity passes.
9. Enter the cloud Web UI.

Supported sources are the same five Phase 1 sources:

- Claude Code
- Codex CLI
- Cursor
- Trae
- GitHub Copilot

The scan step may run automatically after the Core connection succeeds, but upload/import must require user confirmation.

### Summarization Prompt

After import completes, Electron tests the active Core's LLM and embedding connectivity.

Rules:

- Do not rely only on configured provider fields.
- Run an actual connection test.
- If both required model paths are usable, ask whether to generate summaries now.
- If model connectivity is not usable, do not offer immediate summarization.
- Show a message such as: `本机历史已导入。配置可用的模型后，即可将对话结晶成记忆。`
- Provide an entry point to model settings.

### MCP Helper

MCP Helper is the final onboarding step.

Phase 2 MCP Helper scope:

- Show `npm install -g chatcrystal`.
- Explain that AI tools usually start MCP automatically from their MCP config.
- Generate copy-ready MCP snippets for the supported AI tools whose MCP config format is known: Codex, Claude Code, Cursor, Trae, and VS Code/GitHub Copilot where applicable.
- Snippets include:
  - `command: crystal`
  - `args: ["mcp"]`
  - `CHATCRYSTAL_BASE_URL`
  - `CHATCRYSTAL_API_TOKEN`
- Do not require `crystal connect`.
- Do not automatically write AI tool config files.
- Do not automatically start MCP.
- Do not bundle a dedicated `chatcrystal-mcp.exe` in Phase 2.
- Do not automatically install npm CLI in Phase 2.

The default snippets include the token in plain text because the goal is copy-ready configuration. The UI must label this clearly: the snippet contains the user's access token and should only be copied into trusted AI tools.

## Architecture

### Modules

#### Electron Shell

Responsible for:

- Choosing whether to show onboarding, local Web UI, cloud Web UI, or an error page.
- Starting and stopping the embedded local Core.
- Loading the cloud Web UI after successful cloud verification.
- Handling tray/menu entries for continuing onboarding, importing histories, MCP helper, and switching modes.
- Displaying a cloud connection error page with recovery actions.

#### Onboarding Renderer

An Electron-specific renderer page. It does not depend on the local Core already running.

Responsible for:

- Mode choice.
- Cloud connection form.
- Connection progress screens.
- Scan results.
- Import confirmation.
- Import progress.
- Model connectivity result.
- Summarization prompt.
- MCP helper snippets.
- Skip/continue controls.

The Onboarding Renderer should be a real page, not a sequence of native dialogs.

#### Preload / IPC Bridge

Renderer code must not directly read local files, mutate configuration, or call parser services. Preload exposes a narrow API over IPC.

Required API surface:

- Read and write Electron onboarding state.
- Read and write cloud connection config.
- Verify cloud Core URL and token.
- Start local Core.
- Scan local sources.
- Import to local Core.
- Import to cloud Core.
- Test model connectivity for the active Core.
- Trigger batch summarization for the active Core.
- Generate MCP snippets.
- Open local or cloud Web UI.
- Clear or repair cloud connection state.

#### Core Reuse Layer

Phase 2 must reuse Phase 1 server/core services:

- Source adapters.
- Local import logic.
- Remote import item construction.
- Remote upload chunking.
- Cloud ingest validation and dedupe.
- Config connection testing.
- Summarization queue/API.

Do not reimplement parsing in Electron.

### Storage

Electron `app.getPath("userData")` stores shell-only state:

- Window state.
- Onboarding state.
- Default mode.
- Cloud URL and token.
- Step completion/skipped flags.

On Windows with the current app identity, this resolves to `%APPDATA%\ChatCrystal`.

Cloud token storage is plain JSON for Phase 2. The app should write files with restrictive permissions where supported and hide the token in UI except where copy-ready snippets intentionally include it.

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
- `scan-sources`
- `scan-results`
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
- Scanning can be skipped.
- Import can be skipped.
- Summarization can be skipped.
- MCP Helper can be skipped.
- Skipped steps remain available from menu/settings.
- Onboarding state persists enough to resume after closing the app.
- Persist only scan summaries and timestamps; re-scan before a later import because local histories can change.

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
- Re-scan.
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
