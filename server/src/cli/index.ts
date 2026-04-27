#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SERVER_BASE_URL } from './client.js';

// Read version from package.json
const pkgPath = resolve(import.meta.dirname, '../../../../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const program = new Command();

program
  .name('crystal')
  .description('ChatCrystal — AI conversation knowledge crystallization tool')
  .version(pkg.version)
  .option('-b, --base-url <url>', 'Server base URL', DEFAULT_SERVER_BASE_URL)
  .option('--json', 'Force JSON output (override TTY detection)')
  .option('--no-interactive', 'Disable interactive mode (always use plain output)');

// Import and register subcommands
import { registerStatusCommand } from './commands/status.js';
import { registerConversationsCommand } from './commands/conversations.js';
import { registerImportCommand } from './commands/import.js';
import { registerSearchCommand } from './commands/search.js';
import { registerNotesCommand } from './commands/notes.js';
import { registerTagsCommand } from './commands/tags.js';
import { registerSummarizeCommand } from './commands/summarize.js';
import { registerConfigCommand } from './commands/config.js';
import { registerServeCommand } from './commands/serve.js';
import { registerMcpCommand } from './commands/mcp.js';

registerStatusCommand(program);
registerConversationsCommand(program);
registerImportCommand(program);
registerSearchCommand(program);
registerNotesCommand(program);
registerTagsCommand(program);
registerSummarizeCommand(program);
registerConfigCommand(program);
registerServeCommand(program);
registerMcpCommand(program);

program.parse();
