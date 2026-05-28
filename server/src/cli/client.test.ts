import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CrystalClient,
  DEFAULT_SERVER_BASE_URL,
  ServerNotAvailableError,
  assertSafeAuthTransport,
  assertExpectedInstanceForConnection,
  isInsecureRemoteHttp,
  normalizeBaseUrl,
} from './client.js';

test('normalizeBaseUrl defaults missing values to the ChatCrystal API port', () => {
  assert.equal(normalizeBaseUrl(), DEFAULT_SERVER_BASE_URL);
  assert.equal(normalizeBaseUrl(''), DEFAULT_SERVER_BASE_URL);
  assert.equal(normalizeBaseUrl('   '), DEFAULT_SERVER_BASE_URL);
});

test('normalizeBaseUrl adds the ChatCrystal port for local HTTP URLs without explicit ports', () => {
  assert.equal(normalizeBaseUrl('http://localhost'), 'http://localhost:3721');
  assert.equal(normalizeBaseUrl('http://127.0.0.1'), 'http://127.0.0.1:3721');
  assert.equal(normalizeBaseUrl('http://[::1]'), 'http://[::1]:3721');
  assert.equal(normalizeBaseUrl('localhost'), 'http://localhost:3721');
});

test('normalizeBaseUrl preserves explicit ports and non-loopback defaults', () => {
  assert.equal(normalizeBaseUrl('http://localhost:80'), 'http://localhost');
  assert.equal(normalizeBaseUrl('http://localhost:4000'), 'http://localhost:4000');
  assert.equal(normalizeBaseUrl('127.0.0.1:4000'), 'http://127.0.0.1:4000');
  assert.equal(normalizeBaseUrl('http://0.0.0.0'), 'http://0.0.0.0');
  assert.equal(normalizeBaseUrl('chatcrystal.example.com'), 'https://chatcrystal.example.com');
  assert.equal(normalizeBaseUrl('https://chatcrystal.local'), 'https://chatcrystal.local');
});

test('CrystalClient allows tokens over non-local HTTP', async () => {
  assert.equal(isInsecureRemoteHttp('http://chatcrystal.example.com'), true);
  assert.equal(isInsecureRemoteHttp('http://localhost:3721'), false);
  assert.equal(isInsecureRemoteHttp('http://0.0.0.0:3721'), true);
  assert.doesNotThrow(() => assertSafeAuthTransport('http://chatcrystal.example.com', 'secret-token'));
  assert.doesNotThrow(() => new CrystalClient({
    baseUrl: 'http://chatcrystal.example.com',
    token: 'secret-token',
    connectionSource: 'explicit',
  }));
  assert.doesNotThrow(() => assertSafeAuthTransport('http://localhost:3721', 'secret-token'));

  const calls: Array<{ url: string; headers: Headers }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });

    if (url.endsWith('/api/health')) {
      return Response.json({ success: true, data: { ok: true, cloudMode: true } });
    }
    if (url.endsWith('/api/status')) {
      return Response.json({
        success: true,
        data: {
          server: true,
          database: true,
          cloudMode: true,
          providerWarnings: [],
          stats: { totalConversations: 0, totalNotes: 0, totalTags: 0 },
          recentNotes: [],
        },
      });
    }

    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  try {
    const client = new CrystalClient({
      baseUrl: 'http://chatcrystal.example.com',
      token: 'secret-token',
      connectionSource: 'explicit',
    });

    await client.status();

    assert.deepEqual(calls.map((call) => call.url), [
      'http://chatcrystal.example.com/api/health',
      'http://chatcrystal.example.com/api/status',
    ]);
    assert.equal(calls[0].headers.get('authorization'), null);
    assert.equal(calls[1].headers.get('authorization'), 'Bearer secret-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizeBaseUrl rejects unsupported base URL schemes', () => {
  assert.throws(
    () => normalizeBaseUrl('file:///tmp/chatcrystal.sock'),
    /Only http and https URLs are supported/,
  );
});

test('CrystalClient uses public health for readiness and sends bearer tokens to private API requests', async () => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });

    if (url.endsWith('/api/health')) {
      return Response.json({ success: true, data: { ok: true, cloudMode: true } });
    }
    if (url.endsWith('/api/status')) {
      return Response.json({
        success: true,
        data: {
          server: true,
          database: true,
          cloudMode: true,
          providerWarnings: [],
          stats: { totalConversations: 0, totalNotes: 0, totalTags: 0 },
          recentNotes: [],
        },
      });
    }

    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  try {
    const client = new CrystalClient({
      baseUrl: 'https://chatcrystal.example.com',
      token: 'secret-token',
      connectionSource: 'explicit',
    });

    const status = await client.status();

    assert.equal(status.cloudMode, true);
    assert.deepEqual(calls.map((call) => call.url), [
      'https://chatcrystal.example.com/api/health',
      'https://chatcrystal.example.com/api/status',
    ]);
    assert.equal(calls[0].headers.get('authorization'), null);
    assert.equal(calls[1].headers.get('authorization'), 'Bearer secret-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CrystalClient does not auto-start when a remote server is unavailable', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    throw new Error('offline');
  }) as typeof fetch;

  try {
    const client = new CrystalClient({
      baseUrl: 'https://chatcrystal.example.com',
      connectionSource: 'explicit',
    });

    await assert.rejects(
      () => client.status(),
      ServerNotAvailableError,
    );
    assert.deepEqual(calls, ['https://chatcrystal.example.com/api/health']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CrystalClient rejects saved or explicit loopback targets that are not cloud mode', async () => {
  assert.throws(
    () => assertExpectedInstanceForConnection(
      'http://localhost:3721',
      'saved',
      { cloudMode: false },
    ),
    /Refusing to use a configured loopback connection/,
  );

  assert.doesNotThrow(() => assertExpectedInstanceForConnection(
    'http://localhost:3721',
    'local-default',
    { cloudMode: false },
  ));
  assert.doesNotThrow(() => assertExpectedInstanceForConnection(
    'http://localhost:3721',
    'saved',
    { cloudMode: true },
  ));
});

test('CrystalClient checks expected instance before rotating tokens on configured loopback targets', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/health')) {
      return Response.json({ success: true, data: { ok: true, cloudMode: false } });
    }
    if (url.endsWith('/api/status')) {
      return Response.json({
        success: true,
        data: {
          server: true,
          database: true,
          cloudMode: false,
          providerWarnings: [],
          stats: { totalConversations: 0, totalNotes: 0, totalTags: 0 },
          recentNotes: [],
        },
      });
    }
    if (url.endsWith('/api/auth/rotate')) {
      return Response.json({ success: true, data: { rotated: true } });
    }
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  try {
    const client = new CrystalClient({
      baseUrl: 'http://localhost:3721',
      token: 'old-token',
      connectionSource: 'saved',
    });

    await assert.rejects(
      () => client.rotateToken('old-token', 'new-token'),
      /Refusing to use a configured loopback connection/,
    );
    assert.deepEqual(calls, [
      'http://localhost:3721/api/health',
      'http://localhost:3721/api/status',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CrystalClient sends an explicit JSON body for token verification', async () => {
  const calls: Array<{
    url: string;
    method?: string;
    headers: Headers;
    body?: BodyInit | null;
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body,
    });

    if (url.endsWith('/api/health')) {
      return Response.json({ success: true, data: { ok: true, cloudMode: true } });
    }
    if (url.endsWith('/api/auth/verify')) {
      return Response.json({ success: true, data: { authenticated: true } });
    }

    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;

  try {
    const client = new CrystalClient({
      baseUrl: 'https://chatcrystal.example.com',
      token: 'secret-token',
      connectionSource: 'explicit',
    });

    const result = await client.verifyToken();

    assert.deepEqual(result, { authenticated: true });
    assert.deepEqual(calls.map((call) => call.url), [
      'https://chatcrystal.example.com/api/health',
      'https://chatcrystal.example.com/api/auth/verify',
    ]);
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].headers.get('authorization'), 'Bearer secret-token');
    assert.equal(calls[1].headers.get('content-type'), 'application/json');
    assert.equal(calls[1].body, '{}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
