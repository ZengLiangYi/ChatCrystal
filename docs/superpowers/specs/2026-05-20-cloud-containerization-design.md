# ChatCrystal Cloud Containerization Design

Date: 2026-05-20

## Goal

Turn ChatCrystal into a personal cloud memory node that one user can connect to from multiple devices.

The work is intentionally split into two phases:

1. **Phase 1: Docker cloud core** - make the existing ChatCrystal core deployable as a single cloud instance with safe token-based access, remote CLI/MCP support, and local-to-cloud import.
2. **Phase 2: Electron cloud companion** - let non-technical users install the desktop app, connect it to the cloud instance, import local history, and configure local MCP clients without using a terminal.

This remains a personal single-instance product. All devices share one access token, one data directory, and one memory database. Multi-user accounts, tenant isolation, OAuth, and permissions are out of scope.

## Decisions

| Topic | Decision |
|---|---|
| Deployment unit | Docker Compose runs only the `chatcrystal` service by default. |
| Ollama | Not bundled in default Compose. Users connect to an external API or an existing Ollama endpoint. |
| Data path | Container uses `DATA_DIR=/data`; Compose maps a named volume such as `chatcrystal-data:/data`. |
| Cloud activation | Docker sets `CHATCRYSTAL_CLOUD_MODE=true`; local dev, CLI auto-start, and Electron local mode default to non-cloud behavior. |
| Security model | Single personal access token for Web, API, CLI, MCP, and Electron cloud mode. |
| First run | If no env token and no stored token exists, enter setup mode instead of exposing the full API. |
| Remote import | Local device parses all five sources and uploads normalized conversations to the cloud. |
| Import output | Remote import stores conversations/messages only; it does not auto-summarize or auto-embed. |
| Electron | Existing local mode remains; cloud mode is added in Phase 2. |
| Internal/VPN deployment | Supported as a documentation pattern, but still uses the same token model. |

## Phase 1: Docker Cloud Core

Phase 1 delivers the cloud instance itself. The Docker image builds the server and client, then runs the production Fastify server. The server continues to serve `client/dist` statically, so the cloud Web UI is available at the same origin as the API.

The default Compose file should be safe to commit to GitHub. It must not contain a real token. It should support both advanced non-interactive deployment and beginner-friendly first-run setup.

Example shape:

```yaml
services:
  chatcrystal:
    image: chatcrystal:latest
    ports:
      - "${PORT:-3721}:3721"
    environment:
      NODE_ENV: production
      PORT: 3721
      DATA_DIR: /data
      CHATCRYSTAL_CLOUD_MODE: "true"
      CHATCRYSTAL_API_TOKEN: ${CHATCRYSTAL_API_TOKEN:-}
    volumes:
      - chatcrystal-data:/data

volumes:
  chatcrystal-data:
```

`/data` is a container-internal path. It does not mean the host root `/data`. The default named volume avoids host path confusion. Advanced users can replace it with a bind mount such as `./chatcrystal-data:/data`.

Cloud behaviors are active only when `CHATCRYSTAL_CLOUD_MODE=true` or when an explicit auth token is configured for test/advanced use. This prevents Docker auth/setup requirements from breaking local development, CLI local auto-start, and existing Electron local mode.

In cloud mode, server-side source scanning is local-only and should be disabled by default:

- the file watcher should not start unless an explicit local-source flag is added later
- `/api/import/scan` and `/api/import/scan/stream` should return a clear local-only error in cloud mode
- the Web UI import action should not imply that the browser can scan the user's local machine
- cloud Web UI should point users to CLI remote import in Phase 1 and Electron import bridge in Phase 2

This avoids the misleading Docker behavior where Web import scans container paths rather than the user's device.

## Cloud Provider Configuration

The default Docker image does not include Ollama. Existing defaults such as `http://localhost:11434` point at the container itself and usually will not work in cloud deployment.

Phase 1 documentation and setup UI should make provider configuration explicit:

- external hosted providers use their normal HTTPS base URLs and API keys
- existing Ollama on Docker Desktop can use `host.docker.internal`
- existing Ollama on Linux may require `extra_hosts: ["host.docker.internal:host-gateway"]`
- remote Ollama should be exposed only on a trusted network or behind its own auth boundary
- setup/status should warn when LLM or Embedding still points at an unreachable container-local default
- semantic search requires a real embedding model, not an LLM chat model

## First-Run Setup

If `CHATCRYSTAL_API_TOKEN` is set, it takes precedence and the server enters normal authenticated mode.

If cloud mode is enabled, the env token is empty, and no token hash exists under the active data directory, the server enters setup mode:

- static frontend can load
- only setup endpoints are available
- all data/config/import/search/memory APIs are blocked
- server generates a one-time setup code
- setup code is printed to container logs and written to `/data/setup-code`
- user opens the Web UI, enters the setup code, and sets an access token
- server stores only a token hash, not the plaintext token
- setup code is deleted after completion

This makes the default Compose usable for non-technical users while avoiding a fully open unauthenticated cloud API.

CI and advanced deployments can bypass setup by providing `CHATCRYSTAL_API_TOKEN`. CI should use a dummy token for smoke tests.

Setup hardening requirements:

- setup code must be high entropy, single-use, and short-lived
- setup verification must be rate limited
- `/data/setup-code` should be created with restrictive file permissions where the platform allows it
- setup completion invalidates the code immediately
- lost-token recovery is explicit: run `crystal token reset` inside the container or delete the auth file from a stopped container volume, then complete setup again
- public internet deployment should use HTTPS through a reverse proxy; token auth does not protect credentials from plaintext HTTP interception

## Authentication

The token applies to Web, REST API, SSE endpoints, CLI, MCP, and Electron cloud mode.

Recommended request contract:

```text
Authorization: Bearer <token>
```

Public endpoints are limited to:

- setup status and completion endpoints
- token verification endpoint
- health endpoint with no private data
- static frontend assets

`/api/status` currently returns stats and recent note metadata. In cloud mode it should either require auth or a new minimal public health endpoint should be introduced for container health checks.

The Web UI stores the token in browser local storage after successful verification. If an API returns 401, the UI returns to the token entry flow.

Token storage and lifecycle:

- stored token hashes live in an auth file under the active data directory, separate from provider config
- use a salted password hash such as `scrypt` and compare with a timing-safe check
- plaintext token is never persisted by the server
- if `CHATCRYSTAL_API_TOKEN` is present, it is the active token and stored hashes are ignored for verification
- `crystal token rotate` replaces the stored hash after authenticating with the current token or a valid setup/reset code
- browser logout removes the localStorage token only; it does not rotate the server token
- CLI/MCP token should come from explicit flag, environment, or a local client connection file with restrictive permissions

## CLI And TUI Connection Model

CLI gets a persistent cloud connection concept:

```bash
crystal connect https://chatcrystal.example.com --token <token>
crystal disconnect
crystal remote status
```

Connection priority:

1. explicit command-line flags
2. environment variables
3. saved `crystal connect` configuration
4. default local URL

Environment variables:

```bash
CHATCRYSTAL_BASE_URL=https://chatcrystal.example.com
CHATCRYSTAL_API_TOKEN=<token>
```

Saved client connection config should live outside the server runtime config, for example under `~/.chatcrystal/client.json`, and should be written with restrictive file permissions where possible. `crystal mcp` follows the same connection priority so MCP clients can either rely on saved config or pass env vars explicitly in their MCP configuration.

Remote URLs must not auto-start a local server. Auto-start remains only for local hosts such as `localhost` and `127.0.0.1`.

TUI and command output must show the active mode:

```text
ChatCrystal · Cloud https://chatcrystal.example.com
ChatCrystal · Local http://localhost:3721
```

Remote import should show a confirmation before scanning local histories and uploading parsed conversations. A `--yes` flag should bypass the prompt for scripts.

## Remote Import Protocol

Current import mixes scanning/parsing and database insertion on the server. Phase 1 separates that into:

1. **Local parse layer** - runs in CLI or later Electron.
2. **Cloud ingest layer** - runs in the cloud server.

For a remote base URL, `crystal import` scans the local machine and reuses all existing source adapters:

- `claude-code`
- `codex`
- `cursor`
- `trae`
- `copilot`

The local process parses each source into a normalized `ParsedConversation` plus the original `ConversationMeta`. The cloud receives normalized payloads, not raw JSONL or `state.vscdb` files. This matters because Cursor and Trae are SQLite-backed, not JSONL-backed.

Cloud ingest endpoint:

- `POST /api/import/ingest`
- authenticated like other cloud APIs
- versioned payload, starting with `schemaVersion: 1`
- Zod-validated request shape
- bounded batches, with CLI chunking by count and byte size
- explicit server body limit large enough for real parsed conversations
- gzip request support where the runtime stack supports it
- per-conversation transaction and per-item result status

Payload item shape:

```typescript
{
  schemaVersion: 1;
  clientRequestId: string;
  items: Array<{
    source: "claude-code" | "codex" | "cursor" | "trae" | "copilot";
    sourceConversationId: string;
    conversationId: string;
    contentHash: string;
    parserVersion: string;
    meta: ConversationMeta;
    parsed: ParsedConversation;
  }>;
}
```

Remote import must not rely on `file_path`, `file_size`, or `file_mtime` as the primary change signal because those fields are device-local. The local parser computes a canonical `contentHash` from normalized parsed conversation content and a `parserVersion` from the adapter implementation. Cloud storage adds migration-backed metadata columns such as `source_conversation_id`, `content_hash`, and `parser_version` to `conversations`.

The current schema uses `conversations.id` and `messages.id` as primary keys. Remote ingest therefore uses stable namespaced ids instead of changing to composite primary keys:

```text
conversation.id = "<source>:<sourceConversationId>"
message.id = "<conversation.id>:<sourceMessageId>"
```

Cloud ingest validates the payload, applies namespacing, then uses these semantics:

- same namespaced conversation id with identical `contentHash` is skipped, even if path or mtime differs
- new namespaced conversation is inserted with all messages
- changed `contentHash` replaces conversation messages and records the new hash/parser version
- replacement never runs because only `file_path`, `file_size`, or `file_mtime` changed
- replacement invalidates only generated imported notes that are tied to the old content and not user-edited
- manual notes and agent-writeback memories are never deleted by remote import replacement
- invalidated vectors are queued for cleanup
- the per-item response reports inserted, skipped, replaced, invalidated note ids, and errors

Remote import returns scanned, uploaded, imported, replaced, skipped, and errors counts. One bad conversation should not fail the entire batch.

Remote import does not automatically summarize conversations. Users can run batch summarization later from Web UI or CLI.

## Phase 2: Electron Cloud Companion

Phase 2 improves onboarding for users who only install the desktop app.

The existing Electron behavior remains as local mode:

- starts embedded local Fastify core
- uses local `~/.chatcrystal/data`
- loads local Web UI

Cloud mode is explicit:

- first launch offers "Use local memory" or "Connect cloud memory"
- user enters cloud URL and token
- Electron verifies the token
- Electron does not start the local core
- window loads the cloud Web UI
- saved cloud connection is reused on next launch

Electron cloud mode also needs a local import bridge. The bridge runs in the Electron main process or a bundled helper, scans local AI tool histories with the same five adapters, and uploads normalized conversations to the cloud ingest API. This is the desktop equivalent of Phase 1 remote CLI import.

The local import bridge is a privileged boundary. The remote Web UI must not be able to trigger arbitrary local file scanning directly. Import should be exposed through native Electron UI with explicit user confirmation, strict origin checks, minimal IPC, and progress-only renderer events. A compromised or XSS-injected cloud page must not be able to request local paths or invoke arbitrary adapter scans.

## MCP One-Click Setup

Phase 2 should include a best-effort MCP setup wizard because the desktop app should be useful without terminal work.

The app should bundle a local MCP bridge so users do not need a global `crystal` command. MCP clients launch the bridge over stdio; the bridge calls the cloud ChatCrystal API with the saved URL and token.

Wizard behavior:

- detect supported MCP clients where possible
- show the exact configuration that will be written
- write user-level configuration, not project-level configuration
- back up existing config first
- merge the `chatcrystal` server without overwriting existing MCP servers
- test the bridge after writing
- provide copyable manual config when automatic writing is not supported

Required support target:

- Claude Code
- Codex
- Cursor
- VS Code / GitHub Copilot

Trae is best-effort because its MCP configuration surface may differ by version.

## Error Handling

Cloud deployment and remote clients should fail loudly when they might otherwise operate on the wrong instance.

- token failure returns 401 with a clear message
- setup mode blocks all non-setup data APIs
- remote URL connection failure never starts a local server
- remote import shows the target endpoint in prompts and errors
- remote import records per-conversation failures and continues
- CLI/MCP explain whether they are using explicit flags, env config, saved cloud config, or local defaults
- changing embedding provider/model keeps the existing confirmation behavior

## Testing

Phase 1 should be delivered in smaller gates:

1. **1A Docker/auth/setup/health** - image, Compose, cloud mode, setup mode, token auth, health endpoint, provider warnings.
2. **1B CLI/MCP cloud connection** - saved connection config, token header injection, remote no-autostart, TUI local/cloud display.
3. **1C Remote ingest/import** - namespaced ids, content hashes, versioned ingest API, five-source local parse and upload.

Phase 1 tests:

- Docker build succeeds
- Compose config validates
- container smoke test starts with a dummy token
- cloud mode does not affect local dev, CLI local auto-start, or Electron local mode
- server-side scan endpoints are disabled or local-only in cloud mode
- provider setup warns when Docker is still pointing at container-local Ollama defaults
- setup mode starts without env token and blocks private APIs
- setup completion stores only a hash and disables setup code
- setup code is high entropy, single-use, rate limited, and resettable
- token auth succeeds and fails correctly
- SSE endpoints require token
- CLI injects token headers
- `crystal mcp` uses the same saved/env connection flow as other CLI commands
- remote URL does not auto-start local server
- ingest namespaces conversation and message ids
- ingest skips identical `contentHash` even when path/mtime differs
- ingest replacement does not delete manual notes or agent-writeback memories
- remote import parses and uploads all five sources through focused fixtures
- ingest API handles skip, insert, replace, and per-item errors
- Web token gate stores token and retries authenticated API calls
- TUI/CLI display local/cloud mode

Phase 2 tests:

- local Electron mode still starts embedded core
- cloud Electron mode skips embedded core and loads remote UI
- cloud connection is persisted and can be cleared
- Electron import bridge uploads parsed conversations
- MCP bridge can be launched over stdio and call cloud tools
- MCP config writer backs up and merges config safely for supported clients

## Acceptance Criteria

Phase 1 is complete when:

- `docker compose up -d` can start a cloud ChatCrystal instance
- first-run setup can create the access token from Web UI
- browser access works after token entry
- cloud mode does not require auth/setup for existing local dev or Electron local mode
- cloud Web UI does not run server-side scan/import against container paths
- `crystal connect` can save cloud URL and token
- `crystal status`, `crystal search`, `crystal notes`, and `crystal mcp` can operate against the cloud instance
- `crystal import` against a cloud base URL scans local five-source history and uploads conversations to cloud
- remote ingest uses namespaced ids and content hashes so device-local mtime/path changes do not replace content
- imported conversations are visible in the cloud Web UI
- imported conversations are not summarized until the user explicitly runs summarization

Phase 2 is complete when:

- a user can install Electron, choose cloud mode, and connect with URL plus token
- Electron cloud mode can import local history from all five sources
- Electron can configure supported local MCP clients or provide manual config
- local Electron mode remains unchanged for existing users

## Workload Estimate

Phase 1 is medium-to-large: approximately 3-6 engineering days.

Main risks:

- extracting reusable ingest logic from current import service
- adding cloud-only activation without regressing local-first behavior
- auth coverage across REST, SSE, CLI, MCP, and Web
- first-run setup hardening and token lifecycle
- remote ingest payload sizing, namespacing, and hash-based deduplication
- remote/local mode clarity in CLI and TUI
- disabling or replacing Web server-side import in cloud mode

Phase 2 is larger: approximately 5-10 engineering days.

Main risks:

- bundling a reliable MCP bridge
- safely writing different MCP client configuration formats
- Electron token storage and cloud/local mode switching
- local import progress and error reporting inside the desktop app

## Out Of Scope

- multi-user login
- OAuth
- role-based permissions
- tenant isolation
- automatic VPN/Tailscale provisioning
- bundled Ollama service in default Compose
- continuous bidirectional sync
- conflict-resolution UI
- automatic summarization during remote import
