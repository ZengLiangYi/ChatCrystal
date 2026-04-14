import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sourcePath = resolve(import.meta.dirname, '../src/data/seed-notes.json');
const targetPath = resolve(import.meta.dirname, '../dist/server/src/data/seed-notes.json');

if (!existsSync(sourcePath)) {
  process.exit(0);
}

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);
