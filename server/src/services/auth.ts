import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { runtimePaths } from '../runtime/paths.js';

const scrypt = promisify(scryptCallback);
export const TOKEN_MIN_LENGTH = 16;
export const TOKEN_MAX_LENGTH = 4096;
const SETUP_CODE_BYTES = 24;
const SETUP_MAX_BAD_ATTEMPTS = 5;
const SETUP_LOCK_MS = 60_000;
const SETUP_CODE_TTL_MS = 15 * 60_000;
const AUTH_MAX_BAD_ATTEMPTS = 10;
const AUTH_CLIENT_MAX_BAD_ATTEMPTS = 20;
const AUTH_CLIENT_MAX_INFLIGHT = 4;
const AUTH_LOCK_MS = 60_000;
const AUTH_FAILURE_TTL_MS = 5 * 60_000;
const AUTH_FAILURE_MAX_ENTRIES = 2048;

type AuthFile = {
  version: 1;
  algorithm: 'scrypt';
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
};

type SetupState = {
  code: string | null;
  badAttempts: number;
  lockedUntil: number;
  createdAt: number;
  expiresAt: number;
};

const setupState: SetupState = {
  code: null,
  badAttempts: 0,
  lockedUntil: 0,
  createdAt: 0,
  expiresAt: 0,
};
let setupCompletionInProgress = false;
let beforeStoreTokenForTest: (() => Promise<void>) | null = null;
const authFailures = new Map<string, { badAttempts: number; lockedUntil: number; updatedAt: number }>();
const authClientFailures = new Map<string, { badAttempts: number; lockedUntil: number; updatedAt: number }>();
const authClientInflight = new Map<string, number>();

function ensureDataDir(): void {
  mkdirSync(dirname(runtimePaths.authPath), { recursive: true });
}

function validateToken(token: string): void {
  const length = token.trim().length;
  if (length < TOKEN_MIN_LENGTH) {
    throw new Error(`Token must be at least ${TOKEN_MIN_LENGTH} characters long`);
  }
  if (length > TOKEN_MAX_LENGTH) {
    throw new Error(`Token must be at most ${TOKEN_MAX_LENGTH} characters long`);
  }
}

async function hashToken(token: string, salt = randomBytes(16).toString('hex')): Promise<AuthFile> {
  const normalizedToken = token.trim();
  validateToken(normalizedToken);
  const derived = (await scrypt(normalizedToken, salt, 64)) as Buffer;
  const now = new Date().toISOString();
  return {
    version: 1,
    algorithm: 'scrypt',
    salt,
    hash: derived.toString('hex'),
    createdAt: now,
    updatedAt: now,
  };
}

function readAuthFile(): AuthFile | null {
  if (!existsSync(runtimePaths.authPath)) return null;
  return JSON.parse(readFileSync(runtimePaths.authPath, 'utf-8')) as AuthFile;
}

function writeAuthFile(authFile: AuthFile): void {
  ensureDataDir();
  writeFileSync(runtimePaths.authPath, JSON.stringify(authFile, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function readSetupState(): SetupState | null {
  if (!existsSync(runtimePaths.setupStatePath)) return setupState.code ? setupState : null;
  const raw = JSON.parse(readFileSync(runtimePaths.setupStatePath, 'utf-8')) as SetupState;
  setupState.code = raw.code;
  setupState.badAttempts = raw.badAttempts;
  setupState.lockedUntil = raw.lockedUntil;
  setupState.createdAt = raw.createdAt;
  setupState.expiresAt = raw.expiresAt;
  return setupState;
}

function writeSetupState(state: SetupState): void {
  ensureDataDir();
  writeFileSync(runtimePaths.setupStatePath, JSON.stringify(state, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

function clearSetupStateFiles(): void {
  setupState.code = null;
  setupState.badAttempts = 0;
  setupState.lockedUntil = 0;
  setupState.createdAt = 0;
  setupState.expiresAt = 0;
  rmSync(runtimePaths.setupCodePath, { force: true });
  rmSync(runtimePaths.setupStatePath, { force: true });
}

function activeSetupState(): SetupState | null {
  const state = readSetupState();
  if (!state?.code) return null;
  if (Date.now() > state.expiresAt) {
    clearSetupStateFiles();
    return null;
  }
  return state;
}

function authRateKey(token: string | undefined, key?: string): string {
  const scope = key?.trim() || 'global';
  const tokenFingerprint = createHash('sha256')
    .update(token?.trim() ?? '')
    .digest('hex')
    .slice(0, 16);
  return `${scope.slice(0, 128)}:${tokenFingerprint}`;
}

function authClientRateKey(key?: string): string {
  return (key?.trim() || 'global').slice(0, 128);
}

function pruneAuthFailures(): void {
  const now = Date.now();
  for (const [key, state] of authFailures) {
    if (state.updatedAt + AUTH_FAILURE_TTL_MS < now || (state.lockedUntil > 0 && state.lockedUntil <= now)) {
      authFailures.delete(key);
    }
  }
  for (const [key, state] of authClientFailures) {
    if (state.updatedAt + AUTH_FAILURE_TTL_MS < now || (state.lockedUntil > 0 && state.lockedUntil <= now)) {
      authClientFailures.delete(key);
    }
  }
  while (authFailures.size > AUTH_FAILURE_MAX_ENTRIES) {
    const oldestKey = authFailures.keys().next().value;
    if (!oldestKey) break;
    authFailures.delete(oldestKey);
  }
  while (authClientFailures.size > AUTH_FAILURE_MAX_ENTRIES) {
    const oldestKey = authClientFailures.keys().next().value;
    if (!oldestKey) break;
    authClientFailures.delete(oldestKey);
  }
}

function isAuthLocked(token: string | undefined, key?: string): boolean {
  pruneAuthFailures();
  const clientRateKey = authClientRateKey(key);
  const clientState = authClientFailures.get(clientRateKey);
  if (clientState?.lockedUntil && clientState.lockedUntil > Date.now()) return true;

  const rateKey = authRateKey(token, key);
  const state = authFailures.get(rateKey);
  if (!state) return false;
  if (state.lockedUntil > Date.now()) return true;
  if (state.lockedUntil > 0) authFailures.delete(rateKey);
  return false;
}

function recordAuthResult(ok: boolean, token: string | undefined, key?: string): void {
  pruneAuthFailures();
  const rateKey = authRateKey(token, key);
  const clientRateKey = authClientRateKey(key);
  if (ok) {
    authFailures.delete(rateKey);
    authClientFailures.delete(clientRateKey);
    return;
  }

  const now = Date.now();
  const state = authFailures.get(rateKey) ?? { badAttempts: 0, lockedUntil: 0, updatedAt: now };
  state.badAttempts++;
  state.updatedAt = now;
  if (state.badAttempts >= AUTH_MAX_BAD_ATTEMPTS) {
    state.lockedUntil = now + AUTH_LOCK_MS;
  }
  authFailures.set(rateKey, state);

  const clientState = authClientFailures.get(clientRateKey) ?? { badAttempts: 0, lockedUntil: 0, updatedAt: now };
  clientState.badAttempts++;
  clientState.updatedAt = now;
  if (clientState.badAttempts >= AUTH_CLIENT_MAX_BAD_ATTEMPTS) {
    clientState.lockedUntil = now + AUTH_LOCK_MS;
  }
  authClientFailures.set(clientRateKey, clientState);
}

function acquireAuthSlot(key?: string): boolean {
  const clientRateKey = authClientRateKey(key);
  const current = authClientInflight.get(clientRateKey) ?? 0;
  if (current >= AUTH_CLIENT_MAX_INFLIGHT) return false;
  authClientInflight.set(clientRateKey, current + 1);
  return true;
}

function releaseAuthSlot(key?: string): void {
  const clientRateKey = authClientRateKey(key);
  const current = authClientInflight.get(clientRateKey) ?? 0;
  if (current <= 1) {
    authClientInflight.delete(clientRateKey);
    return;
  }
  authClientInflight.set(clientRateKey, current - 1);
}

export function hasStoredToken(): boolean {
  return readAuthFile() !== null;
}

export function hasActiveToken(): boolean {
  return Boolean(process.env.CHATCRYSTAL_API_TOKEN?.trim()) || hasStoredToken();
}

export async function setStoredToken(token: string): Promise<void> {
  const existing = readAuthFile();
  const next = await hashToken(token, existing?.salt);
  writeAuthFile({
    ...next,
    createdAt: existing?.createdAt ?? next.createdAt,
    updatedAt: new Date().toISOString(),
  });
}

export async function verifyToken(token: string | undefined, rateLimitKey?: string): Promise<boolean> {
  const normalizedToken = token?.trim();
  if (!normalizedToken) return false;
  if (isAuthLocked(normalizedToken, rateLimitKey)) return false;
  if (normalizedToken.length > TOKEN_MAX_LENGTH) {
    recordAuthResult(false, normalizedToken, rateLimitKey);
    return false;
  }

  const envToken = process.env.CHATCRYSTAL_API_TOKEN?.trim();
  if (envToken) {
    const provided = Buffer.from(normalizedToken);
    const expected = Buffer.from(envToken);
    const ok = provided.length === expected.length && timingSafeEqual(provided, expected);
    recordAuthResult(ok, normalizedToken, rateLimitKey);
    return ok;
  }

  const authFile = readAuthFile();
  if (!authFile) return false;

  if (!acquireAuthSlot(rateLimitKey)) {
    recordAuthResult(false, normalizedToken, rateLimitKey);
    return false;
  }

  try {
    const derived = (await scrypt(normalizedToken, authFile.salt, 64)) as Buffer;
    const expected = Buffer.from(authFile.hash, 'hex');
    const ok = derived.length === expected.length && timingSafeEqual(derived, expected);
    recordAuthResult(ok, normalizedToken, rateLimitKey);
    return ok;
  } finally {
    releaseAuthSlot(rateLimitKey);
  }
}

export function setupRequired(): boolean {
  return !setupCompletionInProgress && !process.env.CHATCRYSTAL_API_TOKEN?.trim() && !hasStoredToken();
}

export function getOrCreateSetupCode(): string {
  if (setupCompletionInProgress) {
    throw new Error('Setup completion is already in progress');
  }

  const active = activeSetupState();
  if (active?.code) return active.code;

  const code = randomBytes(SETUP_CODE_BYTES).toString('hex');
  setupState.code = code;
  setupState.badAttempts = 0;
  setupState.lockedUntil = 0;
  setupState.createdAt = Date.now();
  setupState.expiresAt = setupState.createdAt + SETUP_CODE_TTL_MS;
  ensureDataDir();
  writeFileSync(runtimePaths.setupCodePath, `${code}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  writeSetupState(setupState);
  return code;
}

export async function completeSetup(setupCode: string, token: string): Promise<boolean> {
  if (setupCompletionInProgress || hasActiveToken()) {
    return false;
  }

  const now = Date.now();
  const state = readSetupState();
  if (state?.lockedUntil && state.lockedUntil > now) {
    throw new Error('Too many setup attempts. Try again in 60 seconds.');
  }

  if (!state?.code) {
    return false;
  }
  if (now > state.expiresAt) {
    clearSetupStateFiles();
    throw new Error('Setup code expired. Restart setup to generate a new code.');
  }

  if (setupCode !== state.code) {
    state.badAttempts++;
    if (state.badAttempts >= SETUP_MAX_BAD_ATTEMPTS) {
      state.lockedUntil = now + SETUP_LOCK_MS;
    }
    writeSetupState(state);
    return false;
  }

  validateToken(token);
  setupCompletionInProgress = true;
  clearSetupStateFiles();
  try {
    if (beforeStoreTokenForTest) {
      await beforeStoreTokenForTest();
    }
    await setStoredToken(token);
    clearSetupStateFiles();
    return true;
  } finally {
    setupCompletionInProgress = false;
  }
}

export async function rotateStoredToken(currentToken: string, nextToken: string): Promise<boolean> {
  if (process.env.CHATCRYSTAL_API_TOKEN?.trim()) {
    throw new Error('Cannot rotate a stored token while CHATCRYSTAL_API_TOKEN environment token is active. Change the deployment environment token instead.');
  }
  if (!(await verifyToken(currentToken))) return false;
  await setStoredToken(nextToken);
  return true;
}

export async function resetStoredAuthForLocalAdmin(): Promise<void> {
  rmSync(runtimePaths.authPath, { force: true });
  setupCompletionInProgress = false;
  beforeStoreTokenForTest = null;
  authFailures.clear();
  authClientFailures.clear();
  authClientInflight.clear();
  clearSetupStateFiles();
}

export function expireSetupCodeForTest(): void {
  const state = readSetupState();
  if (!state) return;
  state.expiresAt = Date.now() - 1;
  writeSetupState(state);
}

export function setBeforeStoreTokenForTest(hook: (() => Promise<void>) | null): void {
  beforeStoreTokenForTest = hook;
}
