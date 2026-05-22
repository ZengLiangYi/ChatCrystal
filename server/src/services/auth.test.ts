import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dataDir = mkdtempSync(join(tmpdir(), 'chatcrystal-auth-test-'));
process.env.DATA_DIR = dataDir;
process.env.CHATCRYSTAL_CLOUD_MODE = 'true';
delete process.env.CHATCRYSTAL_API_TOKEN;

const auth = await import('./auth.js');
const { runtimePaths } = await import('../runtime/paths.js');

test('stored token is hashed and verifies with timing-safe comparison', async () => {
  await auth.setStoredToken('first-secret-token');

  const raw = readFileSync(runtimePaths.authPath, 'utf-8');
  assert.equal(raw.includes('first-secret-token'), false);
  assert.equal(await auth.verifyToken('first-secret-token'), true);
  assert.equal(await auth.verifyToken('wrong-token'), false);
});

test('stored token setup trims surrounding whitespace consistently', async () => {
  await auth.setStoredToken('  trimmed-secret-token  ');

  assert.equal(await auth.verifyToken('trimmed-secret-token'), true);
  assert.equal(await auth.verifyToken('  trimmed-secret-token  '), true);
});

test('overlong bearer tokens are rejected before verification work', async () => {
  await auth.setStoredToken('length-guard-secret-token');

  assert.equal(await auth.verifyToken('x'.repeat(auth.TOKEN_MAX_LENGTH + 1)), false);
});

test('repeated invalid bearer tokens are rate limited per client and token fingerprint', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  await auth.setStoredToken('rate-limit-secret-token');

  for (let i = 0; i < 10; i++) {
    assert.equal(await auth.verifyToken('wrong-token', 'client-a'), false);
  }

  assert.equal(await auth.verifyToken('wrong-token', 'client-a'), false);
  assert.equal(await auth.verifyToken('rate-limit-secret-token', 'client-a'), true);
  assert.equal(await auth.verifyToken('rate-limit-secret-token', 'client-b'), true);
});

test('varied invalid bearer tokens are rate limited per client before unlimited scrypt work', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  await auth.setStoredToken('client-budget-secret-token');

  for (let i = 0; i < 20; i++) {
    assert.equal(await auth.verifyToken(`wrong-token-${i}`, 'client-c'), false);
  }

  assert.equal(await auth.verifyToken('client-budget-secret-token', 'client-c'), false);
  assert.equal(await auth.verifyToken('client-budget-secret-token', 'client-d'), true);
});

test('concurrent invalid bearer tokens are capped before unbounded scrypt work', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  await auth.setStoredToken('inflight-budget-secret-token');

  const attempts = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      auth.verifyToken(`parallel-wrong-token-${index}`, 'client-parallel'),
    ),
  );

  assert.equal(attempts.every((ok) => ok === false), true);
  assert.equal(await auth.verifyToken('inflight-budget-secret-token', 'client-other'), true);
});

test('environment token takes precedence over stored token', async () => {
  process.env.CHATCRYSTAL_API_TOKEN = 'env-secret-token';

  assert.equal(await auth.verifyToken('env-secret-token'), true);
  assert.equal(await auth.verifyToken('first-secret-token'), false);

  delete process.env.CHATCRYSTAL_API_TOKEN;
});

test('setup code is high entropy, persisted with metadata, single-use, and completes setup', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const code = auth.getOrCreateSetupCode();

  assert.match(code, /^[a-f0-9]{48}$/);
  assert.equal(existsSync(runtimePaths.setupCodePath), true);
  assert.equal(existsSync(runtimePaths.setupStatePath), true);

  const result = await auth.completeSetup(code, 'new-secret-token');
  assert.equal(result, true);
  assert.equal(await auth.verifyToken('new-secret-token'), true);
  assert.equal(existsSync(runtimePaths.setupCodePath), false);
  assert.equal(existsSync(runtimePaths.setupStatePath), false);
  assert.equal(await auth.completeSetup(code, 'another-secret-token'), false);
});

test('setup verifier rate limits repeated bad codes', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  auth.getOrCreateSetupCode();

  for (let i = 0; i < 5; i++) {
    assert.equal(await auth.completeSetup('bad-code', 'token-after-bad-code'), false);
  }

  await assert.rejects(
    () => auth.completeSetup('bad-code', 'token-after-limit'),
    /Too many setup attempts/,
  );
});

test('setup code expires from persisted state', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const code = auth.getOrCreateSetupCode();
  auth.expireSetupCodeForTest();

  await assert.rejects(
    () => auth.completeSetup(code, 'token-after-expiry'),
    /Setup code expired/,
  );
});

test('setup code is consumed before async token hashing completes', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const code = auth.getOrCreateSetupCode();

  const [first, second] = await Promise.allSettled([
    auth.completeSetup(code, 'concurrent-secret-token'),
    auth.completeSetup(code, 'concurrent-secret-token'),
  ]);

  const successes = [first, second].filter((result) => result.status === 'fulfilled' && result.value === true);
  const failures = [first, second].filter((result) => result.status === 'fulfilled' && result.value === false);

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
});

test('setup completion blocks new setup code while token hashing is pending', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const code = auth.getOrCreateSetupCode();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  auth.setBeforeStoreTokenForTest(() => gate);
  const completion = auth.completeSetup(code, 'pending-secret-token');
  await Promise.resolve();

  try {
    assert.equal(auth.setupRequired(), false);
    assert.throws(
      () => auth.getOrCreateSetupCode(),
      /already in progress/,
    );
    assert.equal(await auth.completeSetup(code, 'another-secret-token'), false);

    release();
    assert.equal(await completion, true);
  } finally {
    release();
    auth.setBeforeStoreTokenForTest(null);
    await completion.catch(() => undefined);
  }
});

test('invalid setup token does not consume setup code', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const code = auth.getOrCreateSetupCode();

  await assert.rejects(
    () => auth.completeSetup(code, 'short'),
    /Token must be at least/,
  );

  assert.equal(await auth.completeSetup(code, 'valid-secret-token'), true);
});

test('overlong setup token is rejected before hashing and does not consume setup code', async () => {
  await auth.resetStoredAuthForLocalAdmin();
  const code = auth.getOrCreateSetupCode();

  await assert.rejects(
    () => auth.completeSetup(code, 'x'.repeat(auth.TOKEN_MAX_LENGTH + 1)),
    /Token must be at most/,
  );

  assert.equal(await auth.completeSetup(code, 'valid-secret-token'), true);
});

test('token rotation is rejected when env token is active', async () => {
  process.env.CHATCRYSTAL_API_TOKEN = 'env-rotate-token';

  await assert.rejects(
    () => auth.rotateStoredToken('env-rotate-token', 'next-rotate-token'),
    /environment token/,
  );

  delete process.env.CHATCRYSTAL_API_TOKEN;
});
