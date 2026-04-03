import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printKeyValue, printSuccess, printError,
} from '../formatter.js';

export function registerConfigCommand(program: Command) {
  const config = program
    .command('config')
    .description('View and modify configuration');

  config
    .command('get')
    .description('Show current configuration')
    .action(async () => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const data = await client.getConfig();

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        printHeader('Configuration');
        console.log('  LLM:');
        printKeyValue('    Provider', data.llm.provider);
        printKeyValue('    Model', data.llm.model);
        printKeyValue('    Base URL', data.llm.baseURL);
        printKeyValue('    API Key', data.llm.hasApiKey ? '(set)' : '(not set)');

        console.log('\n  Embedding:');
        printKeyValue('    Provider', data.embedding.provider);
        printKeyValue('    Model', data.embedding.model);
        printKeyValue('    Base URL', data.embedding.baseURL);
        printKeyValue('    API Key', data.embedding.hasApiKey ? '(set)' : '(not set)');

        console.log('\n  Sources:');
        printKeyValue('    Enabled', data.enabledSources.join(', '));
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to get config');
        process.exit(1);
      }
    });

  config
    .command('set <key> <value>')
    .description('Update a config value (e.g., llm.provider openai)')
    .option('--confirm', 'Confirm potentially destructive changes')
    .action(async (key, value, opts) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const [section, field] = key.split('.');
        if (!section || !field || !['llm', 'embedding'].includes(section)) {
          printError(`Invalid key "${key}". Use format: llm.provider, llm.model, embedding.provider, embedding.model, etc.`);
          process.exit(1);
        }

        const body: Record<string, unknown> = {
          [section]: { [field]: value },
        };
        if (opts.confirm) {
          body.confirm = true;
        }

        const data = await client.updateConfig(body as Parameters<typeof client.updateConfig>[0]);

        if (data && typeof data === 'object' && 'requiresConfirm' in data) {
          const d = data as { requiresConfirm: boolean; warnings: string[] };
          if (d.requiresConfirm) {
            printError('This change requires confirmation:');
            for (const w of d.warnings) {
              console.error(`  - ${w}`);
            }
            console.error('\nRe-run with --confirm to proceed.');
            process.exit(1);
          }
        }

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        printSuccess(`Updated ${key} = ${value}`);
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to update config');
        process.exit(1);
      }
    });

  config
    .command('test')
    .description('Test LLM connection')
    .action(async () => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const data = await client.testConfig();

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        if (data.connected) {
          printSuccess(`LLM connection OK (response: "${data.response}")`);
        } else {
          printError(`LLM connection failed: ${data.error}`);
        }
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to test config');
        process.exit(1);
      }
    });
}
