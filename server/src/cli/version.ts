import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedVersion: string | undefined;

export function readCliPackageVersion(): string {
  if (cachedVersion) return cachedVersion;

  const pkgPath = resolve(import.meta.dirname, '../../../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: unknown };
  if (typeof pkg.version !== 'string') {
    throw new Error(`Package version not found in ${pkgPath}`);
  }

  cachedVersion = pkg.version;
  return cachedVersion;
}
