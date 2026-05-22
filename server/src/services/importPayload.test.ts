import assert from 'node:assert/strict';
import test from 'node:test';
import type { ParsedConversation } from '@chatcrystal/shared';
import {
  buildRemoteImportItem,
  computeConversationContentHash,
  namespaceConversationId,
  normalizeParsedConversationForRemote,
} from './importPayload.js';

function parsedConversation(): ParsedConversation {
  return {
    id: 'session-1',
    slug: 'session-1',
    source: 'codex',
    projectDir: 'C:/repo',
    projectName: 'repo',
    cwd: 'C:/repo',
    gitBranch: 'main',
    firstMessageAt: '2026-05-20T00:00:00Z',
    lastMessageAt: '2026-05-20T00:01:00Z',
    messages: [
      {
        id: 'm1',
        parentUuid: null,
        type: 'user',
        role: 'user',
        content: 'hello',
        hasToolUse: false,
        hasCode: false,
        thinking: null,
        timestamp: '2026-05-20T00:00:00Z',
      },
      {
        id: 'm2',
        parentUuid: 'm1',
        type: 'assistant',
        role: 'assistant',
        content: 'world',
        hasToolUse: false,
        hasCode: false,
        thinking: null,
        timestamp: '2026-05-20T00:01:00Z',
      },
    ],
  };
}

test('namespaceConversationId prefixes source ids once', () => {
  assert.equal(namespaceConversationId('codex', 'session-1'), 'codex:session-1');
  assert.equal(namespaceConversationId('codex', 'codex:session-1'), 'codex:session-1');
});

test('normalizeParsedConversationForRemote namespaces conversation and message ids', () => {
  const normalized = normalizeParsedConversationForRemote('codex', 'session-1', parsedConversation());

  assert.equal(normalized.id, 'codex:session-1');
  assert.equal(normalized.source, 'codex');
  assert.deepEqual(
    normalized.messages.map((message) => [message.id, message.parentUuid]),
    [
      ['codex:session-1:m1', null],
      ['codex:session-1:m2', 'codex:session-1:m1'],
    ],
  );
});

test('computeConversationContentHash is stable and content based', () => {
  const first = normalizeParsedConversationForRemote('codex', 'session-1', parsedConversation());
  const second = normalizeParsedConversationForRemote('codex', 'session-1', {
    ...parsedConversation(),
    projectDir: 'D:/different-path',
    firstMessageAt: '2026-05-21T00:00:00Z',
    lastMessageAt: '2026-05-21T00:01:00Z',
    messages: parsedConversation().messages.map((message) => ({
      ...message,
      timestamp: '2026-05-21T00:00:00Z',
    })),
  });
  const changed = normalizeParsedConversationForRemote('codex', 'session-1', {
    ...parsedConversation(),
    messages: [
      ...parsedConversation().messages.slice(0, 1),
      { ...parsedConversation().messages[1], content: 'changed' },
    ],
  });

  assert.match(computeConversationContentHash(first), /^[a-f0-9]{64}$/);
  assert.equal(computeConversationContentHash(first), computeConversationContentHash(second));
  assert.notEqual(computeConversationContentHash(first), computeConversationContentHash(changed));
});

test('computeConversationContentHash ignores unstable parser-generated message ids', () => {
  const first = normalizeParsedConversationForRemote('codex', 'session-1', parsedConversation());
  const second = normalizeParsedConversationForRemote('codex', 'session-1', {
    ...parsedConversation(),
    messages: parsedConversation().messages.map((message, index) => ({
      ...message,
      id: `random-${index}`,
      parentUuid: index === 0 ? null : 'random-0',
    })),
  });

  assert.equal(computeConversationContentHash(first), computeConversationContentHash(second));
});

test('buildRemoteImportItem includes normalized parsed data and canonical hash', () => {
  const item = buildRemoteImportItem(
    'codex',
    {
      id: 'session-1',
      source: 'codex',
      filePath: 'C:/fixtures/session-1.jsonl',
      fileSize: 10,
      fileMtime: '2026-05-20T00:00:00Z',
      projectDir: 'C:/repo',
    },
    parsedConversation(),
    'codex@test',
  );

  assert.equal(item.source, 'codex');
  assert.equal(item.sourceConversationId, 'session-1');
  assert.equal(item.conversationId, 'codex:session-1');
  assert.equal(item.parserVersion, 'codex@test');
  assert.equal(item.contentHash, computeConversationContentHash(item.parsed));
});
