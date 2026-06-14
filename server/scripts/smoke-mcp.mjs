#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const repoRoot = resolve(import.meta.dirname, '../..');
const serverRoot = resolve(repoRoot, 'server');
const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-mcp-smoke-'));
const port = process.env.CHATCRYSTAL_SMOKE_PORT || String(42000 + Math.floor(Math.random() * 1000));
const baseUrl = `http://127.0.0.1:${port}`;
const token = 'chatcrystal-smoke-token-1234567890';
const serverEntry = resolve(serverRoot, 'dist/server/src/index.js');
const cliEntry = resolve(serverRoot, 'dist/server/src/cli/index.js');
const packageJson = JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf-8'));

const expectedTools = [
  'search_knowledge',
  'get_note',
  'list_notes',
  'get_relations',
  'recall_for_task',
  'validate_task_memory',
  'write_task_memory',
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Retry until the temporary server is ready.
    }
    await wait(250);
  }
  throw new Error(`Server did not become healthy at ${baseUrl}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;

  const closed = new Promise((resolve) => {
    child.once('close', resolve);
  });
  child.kill('SIGTERM');
  await Promise.race([closed, wait(2000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

let server;

try {
  server = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: port,
      DATA_DIR: dataDir,
      NODE_ENV: 'production',
      CHATCRYSTAL_CLOUD_MODE: 'true',
      CHATCRYSTAL_API_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForHealth();

  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, 'mcp'],
    cwd: repoRoot,
    env: {
      ...process.env,
      CHATCRYSTAL_BASE_URL: baseUrl,
      CHATCRYSTAL_API_TOKEN: token,
      DATA_DIR: dataDir,
    },
    stderr: 'pipe',
  });
  let mcpStderr = '';
  transport.stderr?.on('data', (chunk) => { mcpStderr += chunk.toString(); });

  const client = new Client({ name: 'chatcrystal-smoke', version: '0.0.0' });
  await client.connect(transport);
  const serverVersion = client.getServerVersion();
  const { tools } = await client.listTools();
  const toolNames = tools.map((tool) => tool.name).sort();
  const expectedToolNames = [...expectedTools].sort();

  await client.close();

  const missing = expectedToolNames.filter((name) => !toolNames.includes(name));
  const extra = toolNames.filter((name) => !expectedToolNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`Unexpected MCP tools. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }

  if (serverVersion?.version !== packageJson.version) {
    throw new Error(`MCP server version ${serverVersion?.version ?? 'unknown'} does not match package version ${packageJson.version}`);
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    serverVersion,
    toolCount: toolNames.length,
    tools: toolNames,
    mcpStderr: mcpStderr.trim(),
  }, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
} finally {
  await stopProcess(server);
  rmSync(dataDir, { recursive: true, force: true });
}
