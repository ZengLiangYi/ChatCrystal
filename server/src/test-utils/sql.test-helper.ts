import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function locateSqlJsFile(file: string): string {
  return require.resolve(`sql.js/dist/${file}`);
}
