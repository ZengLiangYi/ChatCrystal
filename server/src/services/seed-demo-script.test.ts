import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

test('demo seed script clears the runtime vector index with the demo database', () => {
  const source = readFileSync(path.join(root, 'scripts/seed-demo.mjs'), 'utf-8');

  assert.match(source, /VECTRA_INDEX_PATH/);
  assert.match(source, /rmSync\(VECTRA_INDEX_PATH, \{ recursive: true, force: true \}\)/);
});
