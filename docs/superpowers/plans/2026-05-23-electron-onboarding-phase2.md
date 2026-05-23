# Electron Onboarding Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Windows-first Electron onboarding with local/cloud mode choice, cloud connection, explicit local-history import/upload, cloud Web UI auto-login, model testing, and MCP copy-ready snippets.

**Architecture:** Keep the Fastify Core as the source of API truth and reuse existing import/parser/remote-ingest services. Electron becomes a mode-aware shell with separate trust boundaries: onboarding/local renderer gets restricted IPC, cloud Web UI gets no high-privilege import/config IPC, and cloud mode does not start the embedded local Core. Phase 2 deliberately skips preview/count UI; local histories are scanned and parsed only after the user starts import/upload.

**Tech Stack:** TypeScript, Electron, Fastify v5, React/Vite Web UI, sql.js, Commander/MCP stdio, node:test, Electron `contextBridge`, Electron `session`, `BrowserWindow`.

---

## Scope Check

This plan implements `docs/superpowers/specs/2026-05-23-electron-onboarding-phase2-design.md`.

Included:

- Electron first-run onboarding with local/cloud mode choice.
- Cloud URL/token verification and plaintext JSON storage in Electron `userData`.
- Electron cloud Web UI loading with exact-origin navigation lock and `chatcrystal.apiToken` localStorage injection.
- Electron-specific public HTTP allowance for cloud Web UI only; normal browser behavior remains unchanged.
- Explicit import/upload action after mode connection; no preview/count layer.
- Server/Core contracts for watcher disablement, structured import/upload result IDs, and summarize-by-ids.
- MCP Helper snippets for local/cloud, including local active Core URL and non-local HTTP allow env.

Excluded:

- Multi-user accounts, sync/conflict resolution, and multiple cloud profiles.
- Auto-writing MCP config files.
- Auto-installing the npm CLI.
- Electron-bundled MCP executable.
- macOS/Linux installers.
- A source preview/count layer.

## Delivery Gates

- **Gate 2A: Core contracts** adds watcher control, structured import/upload result IDs, and summarize-by-ids APIs.
- **Gate 2B: Web/Electron trust boundary** adds Electron-safe Web HTTP auth allowance, Electron state, preloads, mode-aware shell, and exact-origin cloud loading.
- **Gate 2C: Onboarding UI and MCP helper** adds the first-run flow, explicit import/upload action, model test and summarize prompts, error recovery, and MCP snippets.

Each gate should compile, pass focused tests, and commit before moving to the next gate.

## File Structure

| File | Responsibility |
|------|----------------|
| `shared/types/index.ts` | Shared import/upload result, summarize-by-ids, Electron onboarding state, and MCP snippet types. |
| `server/src/runtime/watcherPolicy.ts` | Pure helper deciding whether a server instance starts the watcher. |
| `server/src/runtime/watcherPolicy.test.ts` | Tests that Electron onboarding disables watcher and standalone local mode keeps it. |
| `server/src/index.ts` | Adds `createServer({ startWatcher })` and uses watcher policy. |
| `server/src/services/import.ts` | Returns structured `importedIds`, `replacedIds`, `skippedIds`, `errorIds`, `summarizationCandidateIds`. |
| `server/src/services/import.test.ts` | Verifies structured IDs and skipped IDs are excluded from summary candidates. |
| `server/src/services/ingest.ts` | Adds structured ID arrays to remote ingest response. |
| `server/src/services/ingest.test.ts` | Verifies remote ingest candidate IDs for imported/replaced and excludes skipped. |
| `server/src/routes/import.ts` | Surfaces structured import/upload result data through existing import routes. |
| `server/src/routes/notes.ts` | Adds summarize-by-ids and summarize-status-by-ids endpoints. |
| `server/src/routes/notes-summarize-batch.test.ts` | Tests summarize-by-ids rejects unknown IDs and does not queue skipped/backlog IDs. |
| `client/src/lib/api.ts` | Adds Electron cloud HTTP auth allowance while preserving normal browser guard. |
| `client/src/components/AuthGate.tsx` | Uses the updated guard and keeps normal browser public HTTP blocked. |
| `electron/state.ts` | Reads/writes versioned Electron onboarding state under `app.getPath("userData")`. |
| `electron/state.test.ts` | Tests plaintext token persistence, token redaction helper, and corrupted state fallback. |
| `electron/preload.ts` | Keeps existing minimal local preload. |
| `electron/onboarding-preload.ts` | Exposes only onboarding IPC methods to the Electron-owned onboarding renderer. |
| `electron/cloud-preload.ts` | Exposes only a low-privilege Electron cloud marker for Web HTTP guard allowance. |
| `electron/ipc.ts` | Registers guarded onboarding IPC handlers and validates sender origin/state. |
| `electron/mcp-snippets.ts` | Builds copy-ready local/cloud MCP snippets. |
| `electron/mcp-snippets.test.ts` | Verifies local URL, cloud token, and non-local HTTP allow env. |
| `electron/onboarding-page.ts` | Self-contained onboarding HTML/CSS/JS string loaded by Electron shell. |
| `electron/main.ts` | Mode-aware startup, local Core lifecycle, cloud Web UI loading, exact-origin lock, token injection. |
| `electron/tray.ts` | Mode-aware tray menu targets. |
| `electron/tsconfig.json` | Includes new Electron TS files. |
| `client/src/types/electron.d.ts` | Browser-side global types for the low-privilege Electron cloud marker. |

---

## Gate 2A: Core Contracts

### Task 1: Add Watcher Startup Policy

**Files:**
- Create: `server/src/runtime/watcherPolicy.ts`
- Create: `server/src/runtime/watcherPolicy.test.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/runtime/watcherPolicy.test.ts`

- [ ] **Step 1: Write the failing watcher policy tests**

Create `server/src/runtime/watcherPolicy.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStartWatcher } from './watcherPolicy.js';

test('standalone local server starts watcher by default', () => {
  assert.equal(shouldStartWatcher({ cloudMode: false }), true);
});

test('cloud server never starts watcher by default', () => {
  assert.equal(shouldStartWatcher({ cloudMode: true }), false);
});

test('electron onboarding can explicitly disable watcher in local mode', () => {
  assert.equal(shouldStartWatcher({ cloudMode: false, startWatcher: false }), false);
});

test('explicit true still cannot start watcher in cloud mode', () => {
  assert.equal(shouldStartWatcher({ cloudMode: true, startWatcher: true }), false);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test -w server -- src/runtime/watcherPolicy.test.ts
```

Expected: FAIL because `server/src/runtime/watcherPolicy.ts` does not exist.

- [ ] **Step 3: Add the watcher policy helper**

Create `server/src/runtime/watcherPolicy.ts`:

```ts
export type WatcherPolicyInput = {
  cloudMode: boolean;
  startWatcher?: boolean;
};

export function shouldStartWatcher(input: WatcherPolicyInput): boolean {
  if (input.cloudMode) return false;
  return input.startWatcher ?? true;
}
```

- [ ] **Step 4: Wire `createServer({ startWatcher })`**

In `server/src/index.ts`, import the helper:

```ts
import { shouldStartWatcher } from './runtime/watcherPolicy.js';
```

Change the `createServer` options type:

```ts
export async function createServer(options?: {
  port?: number;
  host?: string;
  startWatcher?: boolean;
}): Promise<ServerInstance> {
```

Replace watcher startup with:

```ts
  const cloudMode = isCloudMode();
  const watcher = shouldStartWatcher({
    cloudMode,
    startWatcher: options?.startWatcher,
  })
    ? startWatcher()
    : null;
```

- [ ] **Step 5: Run watcher policy tests**

Run:

```bash
npm run test -w server -- src/runtime/watcherPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/runtime/watcherPolicy.ts server/src/runtime/watcherPolicy.test.ts server/src/index.ts
git commit -m "feat: add server watcher startup policy"
```

### Task 2: Return Structured Local Import IDs

**Files:**
- Modify: `shared/types/index.ts`
- Modify: `server/src/services/import.ts`
- Modify: `server/src/services/import.test.ts`
- Modify: `server/src/routes/import.ts`

- [ ] **Step 1: Add shared import batch types**

Append to `shared/types/index.ts` near the remote import types:

```ts
export interface ImportBatchResult {
  total: number;
  imported: number;
  replaced: number;
  skipped: number;
  errors: number;
  importedIds: string[];
  replacedIds: string[];
  skippedIds: string[];
  errorIds: string[];
  summarizationCandidateIds: string[];
}
```

- [ ] **Step 2: Write failing import result tests**

Add to `server/src/services/import.test.ts`:

```ts
test('importAll returns structured ids and excludes skipped from summary candidates', async () => {
  const { db, importAll, registerAdapter, appConfig } = await loadRuntime();
  resetDatabase(db);

  appConfig.enabledSources = ['codex'];
  const skippedParsed = parsedConversation('codex-same', 'codex', ['hello', 'world']);
  const skippedHash = computeConversationContentHash(skippedParsed);
  db.run(
    `INSERT INTO conversations (
      id, slug, source, source_conversation_id, content_hash, parser_version,
      project_dir, project_name, cwd, git_branch,
      message_count, first_message_at, last_message_at,
      file_path, file_size, file_mtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported')`,
    [
      'codex-same',
      'codex-same-slug',
      'codex',
      'codex-same',
      skippedHash,
      'codex@test',
      'C:/repo',
      'repo',
      'C:/repo',
      'main',
      2,
      skippedParsed.firstMessageAt,
      skippedParsed.lastMessageAt,
      'C:/fixtures/codex-same.jsonl',
      100,
      '2026-05-23T00:00:00.000Z',
    ],
  );

  registerAdapter(testAdapter(
    'codex',
    [
      conversationMeta('codex-new', 'codex', 100, '2026-05-23T00:00:00.000Z'),
      conversationMeta('codex-same', 'codex', 100, '2026-05-23T00:00:00.000Z'),
    ],
    new Map([
      ['codex-new', parsedConversation('codex-new', 'codex', ['new user', 'new assistant'])],
      ['codex-same', skippedParsed],
    ]),
  ));

  const result = await importAll();

  assert.deepEqual(result.importedIds, ['codex-new']);
  assert.deepEqual(result.replacedIds, []);
  assert.deepEqual(result.skippedIds, ['codex-same']);
  assert.deepEqual(result.summarizationCandidateIds, ['codex-new']);
});
```

- [ ] **Step 3: Run the failing import test**

Run:

```bash
npm run test -w server -- src/services/import.test.ts
```

Expected: FAIL because `importAll()` does not return structured ID arrays.

- [ ] **Step 4: Update `ImportProgress` and `importAll()`**

In `server/src/services/import.ts`, change the import:

```ts
import type { ConversationMeta, ImportBatchResult, ParsedConversation } from "@chatcrystal/shared";
```

Change `ImportProgress`:

```ts
export interface ImportProgress extends ImportBatchResult {
  current: number;
  currentFile: string;
}
```

Initialize progress with ID arrays:

```ts
  const progress: ImportProgress = {
    total: allMetas.length,
    current: 0,
    currentFile: "",
    imported: 0,
    replaced: 0,
    skipped: 0,
    errors: 0,
    importedIds: [],
    replacedIds: [],
    skippedIds: [],
    errorIds: [],
    summarizationCandidateIds: [],
  };
```

When size/mtime skip fires, add:

```ts
progress.skippedIds.push(meta.id);
```

When `existingRow && existingContentHash === contentHash`, add:

```ts
progress.skippedIds.push(parsed.id);
```

When parsed messages are fewer than 2, add:

```ts
progress.skippedIds.push(parsed.id);
```

After a successful transaction, replace `progress.imported++` with:

```ts
if (existingRow) {
  progress.replaced++;
  progress.replacedIds.push(parsed.id);
  progress.summarizationCandidateIds.push(parsed.id);
} else {
  progress.imported++;
  progress.importedIds.push(parsed.id);
  progress.summarizationCandidateIds.push(parsed.id);
}
```

In the catch block, add:

```ts
progress.errorIds.push(meta.id);
```

- [ ] **Step 5: Run import tests**

Run:

```bash
npm run test -w server -- src/services/import.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/types/index.ts server/src/services/import.ts server/src/services/import.test.ts server/src/routes/import.ts
git commit -m "feat: return structured local import ids"
```

### Task 3: Return Structured Remote Ingest IDs

**Files:**
- Modify: `shared/types/index.ts`
- Modify: `server/src/services/ingest.ts`
- Modify: `server/src/services/ingest.test.ts`
- Modify: `server/src/services/remoteImport.ts`

- [ ] **Step 1: Extend remote import response type**

In `shared/types/index.ts`, extend `RemoteImportResponse` so it includes:

```ts
  importedIds: string[];
  replacedIds: string[];
  skippedIds: string[];
  errorIds: string[];
  summarizationCandidateIds: string[];
```

- [ ] **Step 2: Write failing remote ingest tests**

Add to `server/src/services/ingest.test.ts`:

```ts
test('ingestRemoteImport returns summary candidate ids only for imported and replaced items', () => {
  resetDatabase(db);

  const first = remoteItem('first');
  const initial = ingest.ingestRemoteImport({ version: 1, items: [first] });
  assert.deepEqual(initial.importedIds, [first.conversationId]);
  assert.deepEqual(initial.summarizationCandidateIds, [first.conversationId]);

  const skipped = ingest.ingestRemoteImport({ version: 1, items: [first] });
  assert.deepEqual(skipped.skippedIds, [first.conversationId]);
  assert.deepEqual(skipped.summarizationCandidateIds, []);

  const changed = remoteItem('first', 'changed assistant response');
  const replaced = ingest.ingestRemoteImport({ version: 1, items: [changed] });
  assert.deepEqual(replaced.replacedIds, [first.conversationId]);
  assert.deepEqual(replaced.summarizationCandidateIds, [first.conversationId]);
});
```

- [ ] **Step 3: Run the failing ingest test**

Run:

```bash
npm run test -w server -- src/services/ingest.test.ts
```

Expected: FAIL because `RemoteImportResponse` lacks structured ID arrays.

- [ ] **Step 4: Add ID arrays to `ingestRemoteImport()`**

In `server/src/services/ingest.ts`, after `items` is built and before return:

```ts
  const importedIds = items
    .filter((item) => item.status === 'imported')
    .map((item) => item.conversationId);
  const replacedIds = items
    .filter((item) => item.status === 'replaced')
    .map((item) => item.conversationId);
  const skippedIds = items
    .filter((item) => item.status === 'skipped')
    .map((item) => item.conversationId);
  const errorIds = items
    .filter((item) => item.status === 'error')
    .map((item) => item.conversationId)
    .filter(Boolean);
  const summarizationCandidateIds = [...importedIds, ...replacedIds];
```

Add these fields to the return object:

```ts
    importedIds,
    replacedIds,
    skippedIds,
    errorIds,
    summarizationCandidateIds,
```

- [ ] **Step 5: Accumulate remote upload candidates**

In `server/src/services/remoteImport.ts`, extend `RemoteImportResult`:

```ts
export type RemoteImportResult = RemoteImportProgress & {
  localErrors: number;
  importedIds: string[];
  replacedIds: string[];
  skippedIds: string[];
  errorIds: string[];
  summarizationCandidateIds: string[];
};
```

Initialize arrays in `runRemoteImport()`:

```ts
    importedIds: [],
    replacedIds: [],
    skippedIds: [],
    errorIds: [],
    summarizationCandidateIds: [],
```

After each `client.ingestConversations(...)` call:

```ts
    progress.importedIds.push(...result.importedIds);
    progress.replacedIds.push(...result.replacedIds);
    progress.skippedIds.push(...result.skippedIds);
    progress.errorIds.push(...result.errorIds);
    progress.summarizationCandidateIds.push(...result.summarizationCandidateIds);
```

- [ ] **Step 6: Run remote import and ingest tests**

Run:

```bash
npm run test -w server -- src/services/ingest.test.ts src/services/remoteImport.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/types/index.ts server/src/services/ingest.ts server/src/services/ingest.test.ts server/src/services/remoteImport.ts server/src/services/remoteImport.test.ts
git commit -m "feat: return structured remote import ids"
```

### Task 4: Add Summarize-By-Ids APIs

**Files:**
- Modify: `shared/types/index.ts`
- Modify: `server/src/routes/notes.ts`
- Create: `server/src/routes/notes-summarize-batch.test.ts`

- [ ] **Step 1: Add shared summarize request/response types**

Append to `shared/types/index.ts`:

```ts
export interface SummarizeByIdsRequest {
  conversationIds: string[];
}

export interface SummarizeByIdsResponse {
  queued: number;
  skipped: string[];
  unknown: string[];
}

export interface ConversationSummaryStatus {
  id: string;
  status: ConversationStatus | 'unknown';
}
```

- [ ] **Step 2: Write failing route tests**

Create `server/src/routes/notes-summarize-batch.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-summarize-route-test-'));
process.env.DATA_DIR = dataDir;

const dbService = await import('../db/index.js');
const { noteRoutes } = await import('./notes.js');

test('summarize by ids queues only requested imported conversations', async () => {
  const db = await dbService.initDatabase();
  db.exec(`
    PRAGMA foreign_keys = ON;
    DELETE FROM experience_reviews;
    DELETE FROM note_tags;
    DELETE FROM embeddings;
    DELETE FROM note_relations;
    DELETE FROM notes;
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM import_log;
    DELETE FROM vector_cleanup_tasks;
  `);
  db.run("INSERT INTO conversations (id, source, project_name, project_dir, message_count, first_message_at, last_message_at, file_path, file_size, file_mtime, status) VALUES (?, 'codex', 'p', 'p', 2, '2026-05-23', '2026-05-23', 'a', 1, 'm', 'imported')", ['new-id']);
  db.run("INSERT INTO conversations (id, source, project_name, project_dir, message_count, first_message_at, last_message_at, file_path, file_size, file_mtime, status) VALUES (?, 'codex', 'p', 'p', 2, '2026-05-23', '2026-05-23', 'b', 1, 'm', 'summarized')", ['old-id']);

  const app = Fastify();
  await app.register(noteRoutes);

  const res = await app.inject({
    method: 'POST',
    url: '/api/summarize/batch-ids',
    payload: { conversationIds: ['new-id', 'old-id', 'missing-id'] },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.queued, 1);
  assert.deepEqual(body.data.skipped, ['old-id']);
  assert.deepEqual(body.data.unknown, ['missing-id']);

  await app.close();
  dbService.closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run the failing route test**

Run:

```bash
npm run test -w server -- src/routes/notes-summarize-batch.test.ts
```

Expected: FAIL because `/api/summarize/batch-ids` does not exist.

- [ ] **Step 4: Add `/api/summarize/batch-ids`**

In `server/src/routes/notes.ts`, add a route after `/api/summarize/batch`:

```ts
  app.post('/api/summarize/batch-ids', async (req) => {
    const { conversationIds } = req.body as { conversationIds?: string[] };
    const requested = [...new Set((conversationIds ?? []).filter((id) => typeof id === 'string' && id.trim()))];
    const db = getDatabase();
    const skipped: string[] = [];
    const unknown: string[] = [];
    let queued = 0;

    for (const id of requested) {
      const r = db.exec('SELECT project_name, slug, status FROM conversations WHERE id = ?', [id]);
      const row = r[0]?.values[0];
      if (!row) {
        unknown.push(id);
        continue;
      }

      const [pn, sl, status] = row as [string, string | null, string];
      if (status === 'summarized' || taskTracker.isTaskActive(id)) {
        skipped.push(id);
        continue;
      }

      const title = `${pn} / ${sl || id.slice(0, 8)}`;
      enqueueWithRetry(id, title, () => triggerSummarize(id)).catch((err) => {
        console.error(`[Summarize] Error for ${id}:`, err instanceof Error ? err.message : err);
      });
      queued++;
    }

    return {
      success: true,
      data: { queued, skipped, unknown, queue: getQueueStatus() },
    };
  });
```

- [ ] **Step 5: Add status-by-ids endpoint**

In `server/src/routes/notes.ts`, add:

```ts
  app.post('/api/summarize/status-ids', async (req) => {
    const { conversationIds } = req.body as { conversationIds?: string[] };
    const requested = [...new Set((conversationIds ?? []).filter((id) => typeof id === 'string' && id.trim()))];
    const db = getDatabase();
    const items = requested.map((id) => {
      const row = db.exec('SELECT status FROM conversations WHERE id = ?', [id])[0]?.values[0];
      return { id, status: row ? String(row[0]) : 'unknown' };
    });
    return { success: true, data: { items, queue: getQueueStatus() } };
  });
```

- [ ] **Step 6: Run route tests**

Run:

```bash
npm run test -w server -- src/routes/notes-summarize-batch.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/types/index.ts server/src/routes/notes.ts server/src/routes/notes-summarize-batch.test.ts
git commit -m "feat: add summarize by ids endpoints"
```

---

## Gate 2B: Web And Electron Trust Boundary

### Task 5: Add Electron Cloud HTTP Auth Allowance

**Files:**
- Create: `client/src/types/electron.d.ts`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/components/AuthGate.tsx`

- [ ] **Step 1: Add browser global type**

Create `client/src/types/electron.d.ts`:

```ts
export {};

declare global {
  interface Window {
    chatcrystalElectronCloud?: {
      allowInsecureHttpAuth: boolean;
      origin: string;
    };
  }
}
```

- [ ] **Step 2: Update API guard**

In `client/src/lib/api.ts`, add:

```ts
export function isElectronCloudHttpAuthAllowed(location = window.location): boolean {
  const marker = window.chatcrystalElectronCloud;
  if (!marker?.allowInsecureHttpAuth) return false;
  return marker.origin === location.origin;
}
```

Replace `assertSafeWebAuthTransport()` with:

```ts
export function assertSafeWebAuthTransport(): void {
  if (!isInsecureRemoteHttpLocation()) return;
  if (isElectronCloudHttpAuthAllowed()) return;
  throw new Error(
    "Refusing to send ChatCrystal access tokens over public HTTP. Use HTTPS or a local tunnel.",
  );
}
```

- [ ] **Step 3: Update AuthGate refresh and submit checks**

In `client/src/components/AuthGate.tsx`, import:

```ts
  isElectronCloudHttpAuthAllowed,
```

Change both public HTTP checks to:

```ts
if (getStoredToken() && isInsecureRemoteHttpLocation() && !isElectronCloudHttpAuthAllowed()) {
```

and:

```ts
if (isInsecureRemoteHttpLocation() && !isElectronCloudHttpAuthAllowed()) {
```

- [ ] **Step 4: Build the client**

Run:

```bash
npm run build -w client
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/types/electron.d.ts client/src/lib/api.ts client/src/components/AuthGate.tsx
git commit -m "feat: allow electron cloud http auth session"
```

### Task 6: Add Electron State And MCP Snippet Builders

**Files:**
- Create: `electron/state.ts`
- Create: `electron/mcp-snippets.ts`
- Modify: `electron/tsconfig.json`

- [ ] **Step 1: Add Electron state helpers**

Create `electron/state.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

export type ElectronMode = "unset" | "local" | "cloud";

export type ElectronOnboardingState = {
  version: 1;
  mode: ElectronMode;
  defaultMode: Exclude<ElectronMode, "unset"> | null;
  cloudBaseUrl: string | null;
  cloudToken: string | null;
  importSkipped: boolean;
  mcpSkipped: boolean;
  summarizationBatchIds: string[];
  summarizationRequestId: string | null;
  updatedAt: string;
};

export const DEFAULT_ELECTRON_STATE: ElectronOnboardingState = {
  version: 1,
  mode: "unset",
  defaultMode: null,
  cloudBaseUrl: null,
  cloudToken: null,
  importSkipped: false,
  mcpSkipped: false,
  summarizationBatchIds: [],
  summarizationRequestId: null,
  updatedAt: new Date(0).toISOString(),
};

export function getElectronStatePath(): string {
  return path.join(app.getPath("userData"), "onboarding-state.json");
}

export function redactToken(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function readElectronState(): ElectronOnboardingState {
  try {
    const parsed = JSON.parse(readFileSync(getElectronStatePath(), "utf-8")) as Partial<ElectronOnboardingState>;
    if (parsed.version !== 1) return DEFAULT_ELECTRON_STATE;
    return {
      ...DEFAULT_ELECTRON_STATE,
      ...parsed,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return DEFAULT_ELECTRON_STATE;
  }
}

export function writeElectronState(next: ElectronOnboardingState): void {
  const filePath = getElectronStatePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}
```

- [ ] **Step 2: Add MCP snippet builder**

Create `electron/mcp-snippets.ts`:

```ts
export type McpSnippetInput =
  | { mode: "local"; baseUrl: string }
  | { mode: "cloud"; baseUrl: string; token: string };

export function isNonLocalHttpUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return url.protocol === "http:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}

export function buildMcpSnippet(input: McpSnippetInput): Record<string, unknown> {
  const env: Record<string, string> = {
    CHATCRYSTAL_BASE_URL: input.baseUrl,
  };
  if (input.mode === "cloud") {
    env.CHATCRYSTAL_API_TOKEN = input.token;
    if (isNonLocalHttpUrl(input.baseUrl)) {
      env.CHATCRYSTAL_ALLOW_INSECURE_REMOTE_HTTP = "true";
    }
  }
  return {
    command: "crystal",
    args: ["mcp"],
    env,
  };
}
```

- [ ] **Step 3: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/state.ts electron/mcp-snippets.ts electron/tsconfig.json
git commit -m "feat: add electron state and mcp snippets"
```

### Task 7: Split Electron Preloads

**Files:**
- Create: `electron/onboarding-preload.ts`
- Create: `electron/cloud-preload.ts`
- Modify: `electron/preload.ts`

- [ ] **Step 1: Keep local preload minimal**

Leave `electron/preload.ts` as the local renderer preload:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
});
```

- [ ] **Step 2: Add cloud preload**

Create `electron/cloud-preload.ts`:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("chatcrystalElectronCloud", {
  allowInsecureHttpAuth: true,
  origin: window.location.origin,
});
```

This preload exposes no filesystem, import, config, token-read, or IPC method.

- [ ] **Step 3: Add onboarding preload**

Create `electron/onboarding-preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chatcrystalOnboarding", {
  getState: () => ipcRenderer.invoke("onboarding:get-state"),
  saveCloudConnection: (input: { baseUrl: string; token: string }) =>
    ipcRenderer.invoke("onboarding:save-cloud-connection", input),
  startLocal: () => ipcRenderer.invoke("onboarding:start-local"),
  importLocalHistory: () => ipcRenderer.invoke("onboarding:import-local-history"),
  uploadLocalHistory: () => ipcRenderer.invoke("onboarding:upload-local-history"),
  testModel: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:test-model", mode),
  summarizeBatch: (conversationIds: string[]) => ipcRenderer.invoke("onboarding:summarize-batch", conversationIds),
  getMcpSnippet: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:get-mcp-snippet", mode),
  openApp: (mode: "local" | "cloud") => ipcRenderer.invoke("onboarding:open-app", mode),
  useTemporaryLocal: () => ipcRenderer.invoke("onboarding:use-temporary-local"),
});
```

- [ ] **Step 4: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts electron/onboarding-preload.ts electron/cloud-preload.ts
git commit -m "feat: split electron preload boundaries"
```

### Task 8: Make Electron Main Mode-Aware

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/tray.ts`

- [ ] **Step 1: Add mode-aware window creation helpers**

In `electron/main.ts`, replace `createWindow()` with a helper that accepts preload and minimum size:

```ts
type WindowKind = "local" | "cloud" | "onboarding";

function createWindow(kind: WindowKind): BrowserWindow {
  const state = loadWindowState();
  const iconPath = path.join(__dirname, "..", "icon.png");
  const preload =
    kind === "cloud"
      ? path.join(__dirname, "cloud-preload.js")
      : kind === "onboarding"
        ? path.join(__dirname, "onboarding-preload.js")
        : path.join(__dirname, "preload.js");

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "ChatCrystal",
    icon: iconPath,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  attachWindowStateHandlers(win);
  return win;
}
```

Move the existing resize/move/close handlers into `attachWindowStateHandlers(win)`.

- [ ] **Step 2: Start local Core with watcher disabled**

Change `startServer()` to pass the new option:

```ts
type ServerModule = {
  createServer: (opts?: { port?: number; host?: string; startWatcher?: boolean }) => Promise<{
    app: unknown;
    port: number;
    shutdown: () => Promise<void>;
  }>;
};
```

Return:

```ts
return serverModule.createServer({ port, host: "127.0.0.1", startWatcher: false });
```

- [ ] **Step 3: Add exact-origin navigation lock**

Add to `electron/main.ts`:

```ts
function lockNavigationToOrigin(win: BrowserWindow, allowedOrigin: string): void {
  const allow = (target: string) => {
    try {
      return new URL(target).origin === allowedOrigin;
    } catch {
      return false;
    }
  };

  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!allow(targetUrl)) event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    return allow(url) ? { action: "allow" } : { action: "deny" };
  });
}
```

- [ ] **Step 4: Inject cloud token into localStorage**

Add:

```ts
async function injectCloudToken(win: BrowserWindow, baseUrl: string, token: string): Promise<void> {
  const expectedOrigin = new URL(baseUrl).origin;
  const currentOrigin = new URL(win.webContents.getURL()).origin;
  if (currentOrigin !== expectedOrigin) {
    throw new Error("Refusing to inject token into a different origin");
  }

  await win.webContents.executeJavaScript(
    `window.localStorage.setItem("chatcrystal.apiToken", ${JSON.stringify(token)});
     window.dispatchEvent(new Event("chatcrystal-auth-changed"));`,
  );
}
```

- [ ] **Step 5: Route startup by saved state**

In `app.whenReady()`, read `readElectronState()` and branch:

```ts
const state = readElectronState();
if (state.defaultMode === "cloud" && state.cloudBaseUrl && state.cloudToken) {
  mainWindow = createWindow("cloud");
  const origin = new URL(state.cloudBaseUrl).origin;
  lockNavigationToOrigin(mainWindow, origin);
  await mainWindow.loadURL(state.cloudBaseUrl);
  await injectCloudToken(mainWindow, state.cloudBaseUrl, state.cloudToken);
  createTray({ win: mainWindow, mode: "cloud", cloudBaseUrl: state.cloudBaseUrl });
  return;
}

if (state.defaultMode === "local") {
  await ensureLocalCoreStarted();
  mainWindow = createWindow("local");
  await mainWindow.loadURL(`http://localhost:${serverPort}`);
  createTray({ win: mainWindow, mode: "local", localBaseUrl: `http://localhost:${serverPort}` });
  return;
}

mainWindow = createWindow("onboarding");
await mainWindow.loadURL(getOnboardingDataUrl());
createTray({ win: mainWindow, mode: "onboarding" });
```

Define `ensureLocalCoreStarted()` using existing port selection and `startServer(serverPort)`.

- [ ] **Step 6: Make tray mode-aware**

Change `electron/tray.ts` export signature:

```ts
export type TrayOptions =
  | { win: BrowserWindow; mode: "onboarding" }
  | { win: BrowserWindow; mode: "local"; localBaseUrl: string }
  | { win: BrowserWindow; mode: "cloud"; cloudBaseUrl: string };

export function createTray(options: TrayOptions): Tray {
```

Build menu entries:

```ts
const openTarget =
  options.mode === "cloud"
    ? options.cloudBaseUrl
    : options.mode === "local"
      ? options.localBaseUrl
      : null;
```

Only show "Search Knowledge" when `openTarget` exists, using `${openTarget}/search`.

- [ ] **Step 7: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add electron/main.ts electron/tray.ts
git commit -m "feat: make electron shell mode aware"
```

---

## Gate 2C: Onboarding UI, Import/Upload, MCP Helper

### Task 9: Add Onboarding Page And IPC Handlers

**Files:**
- Create: `electron/onboarding-page.ts`
- Create: `electron/ipc.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Add self-contained onboarding page**

Create `electron/onboarding-page.ts`:

```ts
export function getOnboardingDataUrl(): string {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ChatCrystal Onboarding</title>
  <style>
    body { margin: 0; font-family: "Microsoft YaHei", system-ui, sans-serif; background: #111827; color: #f8fafc; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
    section { width: min(860px, 100%); border: 1px solid #334155; background: #182235; padding: 28px; border-radius: 8px; }
    h1 { margin: 0 0 10px; font-size: 30px; }
    p { color: #cbd5e1; line-height: 1.7; }
    button { border: 0; border-radius: 6px; padding: 11px 14px; margin-right: 10px; background: #38bdf8; color: #082f49; font-weight: 700; cursor: pointer; }
    button.secondary { background: #334155; color: #e2e8f0; }
    input { width: 100%; box-sizing: border-box; margin: 8px 0 12px; padding: 10px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; }
    pre { white-space: pre-wrap; background: #0f172a; padding: 14px; border-radius: 6px; border: 1px solid #334155; }
  </style>
</head>
<body>
  <main><section id="app"><h1>正在唤醒您的超级大脑</h1></section></main>
  <script>
    const api = window.chatcrystalOnboarding;
    const app = document.getElementById("app");
    function renderModeChoice() {
      app.innerHTML = "<h1>选择您的记忆核心</h1><p>本地记忆库适合开箱即用；云端超级大脑适合多台设备共享同一套记忆。</p><button id='local'>本地记忆库</button><button id='cloud' class='secondary'>连接超级大脑</button>";
      document.getElementById("local").onclick = async () => { await api.startLocal(); renderImport("local"); };
      document.getElementById("cloud").onclick = () => renderCloudForm();
    }
    function renderCloudForm() {
      app.innerHTML = "<h1>连接超级大脑</h1><p>请输入云端地址和 token。推荐使用 HTTPS，会更安全。</p><input id='url' placeholder='https://chatcrystal.example.com' /><input id='token' type='password' placeholder='CHATCRYSTAL_API_TOKEN' /><button id='connect'>连接</button><button id='back' class='secondary'>返回</button><p id='error'></p>";
      document.getElementById("back").onclick = renderModeChoice;
      document.getElementById("connect").onclick = async () => {
        document.getElementById("error").textContent = "正在连接到您的超级大脑";
        try {
          await api.saveCloudConnection({ baseUrl: document.getElementById("url").value, token: document.getElementById("token").value });
          renderImport("cloud");
        } catch (err) {
          document.getElementById("error").textContent = err.message || String(err);
        }
      };
    }
    function renderImport(mode) {
      app.innerHTML = "<h1>导入本机 AI 对话历史</h1><p>支持 Claude Code、Codex CLI、Cursor、Trae、GitHub Copilot。开始后会扫描并导入本机历史。</p><button id='run'>开始</button><button id='skip' class='secondary'>跳过</button><pre id='log'></pre>";
      document.getElementById("run").onclick = async () => {
        document.getElementById("log").textContent = mode === "cloud" ? "正在上传本机记忆..." : "正在导入本机记忆...";
        const result = mode === "cloud" ? await api.uploadLocalHistory() : await api.importLocalHistory();
        document.getElementById("log").textContent = JSON.stringify(result, null, 2);
        renderMcp(mode);
      };
      document.getElementById("skip").onclick = () => renderMcp(mode);
    }
    async function renderMcp(mode) {
      const snippet = await api.getMcpSnippet(mode);
      app.innerHTML = "<h1>MCP 连接</h1><p>安装 npm CLI 后，把下面配置复制到 AI 工具。AI 工具会自动启动 MCP。</p><pre>" + JSON.stringify(snippet, null, 2) + "</pre><button id='open'>进入 ChatCrystal</button>";
      document.getElementById("open").onclick = () => api.openApp(mode);
    }
    renderModeChoice();
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
```

- [ ] **Step 2: Add guarded IPC handlers**

Create `electron/ipc.ts`:

```ts
import { ipcMain, type IpcMainInvokeEvent } from "electron";

export type IpcDeps = {
  getOnboardingOrigin: () => string;
  saveCloudConnection(input: { baseUrl: string; token: string }): Promise<unknown>;
  startLocal(): Promise<unknown>;
  importLocalHistory(): Promise<unknown>;
  uploadLocalHistory(): Promise<unknown>;
  testModel(mode: "local" | "cloud"): Promise<unknown>;
  summarizeBatch(ids: string[]): Promise<unknown>;
  getMcpSnippet(mode: "local" | "cloud"): Promise<unknown>;
  openApp(mode: "local" | "cloud"): Promise<unknown>;
  useTemporaryLocal(): Promise<unknown>;
};

function assertOnboardingSender(event: IpcMainInvokeEvent, expectedOrigin: string): void {
  if (event.senderFrame.origin !== expectedOrigin) {
    throw new Error("Rejected onboarding IPC from unexpected origin");
  }
}

export function registerOnboardingIpc(deps: IpcDeps): void {
  const guard = (event: IpcMainInvokeEvent) => assertOnboardingSender(event, deps.getOnboardingOrigin());
  ipcMain.handle("onboarding:save-cloud-connection", (event, input) => { guard(event); return deps.saveCloudConnection(input); });
  ipcMain.handle("onboarding:start-local", (event) => { guard(event); return deps.startLocal(); });
  ipcMain.handle("onboarding:import-local-history", (event) => { guard(event); return deps.importLocalHistory(); });
  ipcMain.handle("onboarding:upload-local-history", (event) => { guard(event); return deps.uploadLocalHistory(); });
  ipcMain.handle("onboarding:test-model", (event, mode) => { guard(event); return deps.testModel(mode); });
  ipcMain.handle("onboarding:summarize-batch", (event, ids) => { guard(event); return deps.summarizeBatch(ids); });
  ipcMain.handle("onboarding:get-mcp-snippet", (event, mode) => { guard(event); return deps.getMcpSnippet(mode); });
  ipcMain.handle("onboarding:open-app", (event, mode) => { guard(event); return deps.openApp(mode); });
  ipcMain.handle("onboarding:use-temporary-local", (event) => { guard(event); return deps.useTemporaryLocal(); });
}
```

- [ ] **Step 3: Wire page and IPC into main**

In `electron/main.ts`, import:

```ts
import { getOnboardingDataUrl } from "./onboarding-page";
import { registerOnboardingIpc } from "./ipc";
import { buildMcpSnippet } from "./mcp-snippets";
import { readElectronState, writeElectronState } from "./state";
```

Register IPC after `app.whenReady()` starts and before loading onboarding. For this first implementation, `saveCloudConnection` should verify with `/api/setup/status` and `/api/auth/verify` using `fetch`, then write Electron state.

- [ ] **Step 4: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/onboarding-page.ts electron/ipc.ts electron/main.ts
git commit -m "feat: add electron onboarding shell"
```

### Task 10: Implement Explicit Import And Upload IPC

**Files:**
- Modify: `electron/main.ts`
- Modify: `server/src/services/remoteImport.ts`
- Modify: `server/src/cli/client.ts` if a reusable remote client helper is needed.

- [ ] **Step 1: Implement local import IPC**

In `electron/main.ts`, implement `importLocalHistory` by ensuring local Core is running and calling:

```ts
const response = await fetch(`http://localhost:${serverPort}/api/import/scan`, {
  method: "POST",
});
const body = await response.json();
if (!body.success) throw new Error(body.error || "Local import failed");
return body.data;
```

- [ ] **Step 2: Implement cloud upload IPC**

In `electron/main.ts`, implement `uploadLocalHistory` by importing server remote import modules from the packaged server entry and passing a small client:

```ts
const connection = readElectronState();
if (!connection.cloudBaseUrl || !connection.cloudToken) {
  throw new Error("Cloud connection is not configured");
}
const remoteImport = await importServerModule<typeof import("../server/src/services/remoteImport.js")>("services/remoteImport.js");
return remoteImport.runRemoteImport({
  ingestConversations: async (request) => {
    const response = await fetch(`${connection.cloudBaseUrl}/api/import/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.cloudToken}`,
      },
      body: JSON.stringify(request),
    });
    const body = await response.json();
    if (!body.success) throw new Error(body.error || "Cloud upload failed");
    return body.data;
  },
});
```

Use the actual packaged module path helper from `startServer()` style dynamic import.

- [ ] **Step 3: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts server/src/services/remoteImport.ts
git commit -m "feat: wire electron import and upload actions"
```

### Task 11: Add Model Test, Summarize, And Error Recovery Wiring

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/onboarding-page.ts`
- Modify: `client/src/lib/api.ts` if response typing is needed.

- [ ] **Step 1: Implement active Core API helper**

Add in `electron/main.ts`:

```ts
function getActiveCoreBaseUrl(mode: "local" | "cloud"): string {
  if (mode === "local") return `http://localhost:${serverPort}`;
  const state = readElectronState();
  if (!state.cloudBaseUrl) throw new Error("Cloud URL is not configured");
  return state.cloudBaseUrl;
}

function getActiveCoreHeaders(mode: "local" | "cloud"): Record<string, string> {
  if (mode === "local") return {};
  const state = readElectronState();
  if (!state.cloudToken) throw new Error("Cloud token is not configured");
  return { Authorization: `Bearer ${state.cloudToken}` };
}
```

- [ ] **Step 2: Implement model test IPC**

Use:

```ts
const response = await fetch(`${getActiveCoreBaseUrl(mode)}/api/config/test`, {
  method: "POST",
  headers: getActiveCoreHeaders(mode),
});
```

Return the parsed `data` object.

- [ ] **Step 3: Implement summarize-by-ids IPC**

Use:

```ts
const response = await fetch(`${getActiveCoreBaseUrl(mode)}/api/summarize/batch-ids`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...getActiveCoreHeaders(mode),
  },
  body: JSON.stringify({ conversationIds }),
});
```

Persist `summarizationBatchIds` and a timestamp request ID before the request.

- [ ] **Step 4: Update onboarding page sequence**

After import/upload result, use:

```js
const ids = result.summarizationCandidateIds || [];
const model = await api.testModel(mode);
if (ids.length > 0 && model.llm.connected && model.embedding.connected) {
  app.innerHTML = "<h1>将对话结晶成记忆？</h1><p>模型已连接，可以现在总结本次新导入的内容。</p><button id='yes'>开始总结</button><button id='no' class='secondary'>稍后</button>";
  document.getElementById("yes").onclick = async () => { await api.summarizeBatch(ids); renderMcp(mode); };
  document.getElementById("no").onclick = () => renderMcp(mode);
} else {
  renderMcp(mode);
}
```

- [ ] **Step 5: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/onboarding-page.ts
git commit -m "feat: add onboarding model and summarize flow"
```

### Task 12: Verification And Packaging

**Files:**
- Modify only files needed by failing checks.

- [ ] **Step 1: Run server tests**

Run:

```bash
npm run test -w server
```

Expected: PASS.

- [ ] **Step 2: Run client build**

Run:

```bash
npm run build -w client
```

Expected: PASS.

- [ ] **Step 3: Compile Electron**

Run:

```bash
tsc -p electron/tsconfig.json
```

Expected: PASS.

- [ ] **Step 4: Run full build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Pack Electron**

Run:

```bash
npm run pack:electron
```

Expected: PASS and `release/win-unpacked/ChatCrystal.exe` exists.

- [ ] **Step 6: Commit verification fixes**

If any verification fixes were required:

```bash
git add <changed-files>
git commit -m "fix: complete phase 2 onboarding verification"
```

If no fixes were required, do not create an empty commit.

---

## Review Checkpoints

Request independent `gpt-5.5` + `xhigh` review after each gate:

- After Gate 2A: focus on Core contracts, watcher disablement, structured IDs, summarize-by-ids.
- After Gate 2B: focus on Electron/Web trust boundaries, cloud preload safety, exact-origin token injection, public HTTP behavior.
- After Gate 2C: focus on onboarding UX completeness, MCP snippets, cloud/local routing, packaging.

High-risk findings must be fixed before moving to the next gate.

## Self-Review

Spec coverage:

- Local/cloud mode choice: Gate 2B and Gate 2C.
- Cloud Web UI loading and token localStorage key: Gate 2B.
- No preview/count layer: Gate 2C import/upload action.
- Watcher disabled by default in Electron Phase 2: Gate 2A and Gate 2B.
- Structured import/upload IDs and current-batch summarization: Gate 2A and Gate 2C.
- MCP snippets: Gate 2B and Gate 2C.
- Plain JSON token constraints: Gate 2B.

Plan hygiene scan:

- No unresolved work markers.
- No undefined deferred implementation slots.
- Each task has concrete files, commands, and expected outcomes.

Type consistency:

- `summarizationCandidateIds` is used consistently in shared types, import results, remote ingest results, and Electron summarize flow.
- `CHATCRYSTAL_ALLOW_INSECURE_REMOTE_HTTP` is used only for non-local HTTP MCP snippets.
- `chatcrystal.apiToken` and `chatcrystal-auth-changed` match the existing Web client constants.
