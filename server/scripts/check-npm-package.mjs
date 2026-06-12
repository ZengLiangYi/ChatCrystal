import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const serverRoot = resolve(root, 'server');
const packageJson = JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf-8'));
const serverJson = JSON.parse(readFileSync(resolve(serverRoot, 'server.json'), 'utf-8'));

const output = execSync('npm pack -w server --dry-run --json', {
  cwd: root,
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const [pack] = JSON.parse(output);
const files = pack.files.map((file) => file.path).sort();

const requiredFiles = [
  'README.md',
  'package.json',
  'server.json',
  'dist/server/src/index.js',
  'dist/server/src/cli/index.js',
  'dist/server/src/data/seed-notes.json',
  'dist/shared/types/index.d.ts',
];

const forbiddenPatterns = [
  { name: 'compiled tests', pattern: /(?:^|\/)[^/]+\.test\.(?:js|d\.ts)$/ },
  { name: 'test source maps', pattern: /(?:^|\/)[^/]+\.test\.(?:js|d\.ts)\.map$/ },
  { name: 'source maps', pattern: /\.map$/ },
  { name: 'TypeScript source files', pattern: /(?<!\.d)\.tsx?$/ },
];

const failures = [];

for (const required of requiredFiles) {
  if (!files.includes(required)) {
    failures.push(`Missing required file: ${required}`);
  }
}

for (const { name, pattern } of forbiddenPatterns) {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length > 0) {
    failures.push(
      `Found ${matches.length} forbidden ${name} file(s):\n${matches
        .slice(0, 20)
        .map((file) => `  - ${file}`)
        .join('\n')}${matches.length > 20 ? '\n  ...' : ''}`,
    );
  }
}

if (serverJson.name !== packageJson.mcpName) {
  failures.push(`server.json name (${serverJson.name}) must match package.json mcpName (${packageJson.mcpName}).`);
}

if (serverJson.version !== packageJson.version) {
  failures.push(`server.json version (${serverJson.version}) must match package.json version (${packageJson.version}).`);
}

const npmPackage = Array.isArray(serverJson.packages)
  ? serverJson.packages.find((pkg) => pkg.registryType === 'npm' && pkg.identifier === packageJson.name)
  : undefined;

if (!npmPackage) {
  failures.push(`server.json must include an npm package entry for ${packageJson.name}.`);
} else {
  if (npmPackage.version !== packageJson.version) {
    failures.push(`server.json npm package version (${npmPackage.version}) must match package.json version (${packageJson.version}).`);
  }

  if (npmPackage.transport?.type !== 'stdio') {
    failures.push('server.json npm package transport must be stdio.');
  }
}

if (files.length > 300) {
  failures.push(`Package contains ${files.length} files; expected at most 300 runtime files.`);
}

if (failures.length > 0) {
  console.error(`Invalid npm package contents for ${pack.name}@${pack.version}:`);
  for (const failure of failures) {
    console.error(`\n${failure}`);
  }
  process.exit(1);
}

console.log(`Package contents OK: ${pack.name}@${pack.version}, ${files.length} files, ${pack.size} bytes`);
