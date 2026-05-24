import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const distDir = resolve(import.meta.dirname, '../dist');

rmSync(distDir, { recursive: true, force: true });
