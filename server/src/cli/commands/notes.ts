import type { Command } from 'commander';
import { CrystalClient } from '../client.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printTable, printKeyValue, printError, truncate,
} from '../formatter.js';

export function registerNotesCommand(program: Command) {
  const notes = program
    .command('notes')
    .description('List, view, and explore notes');

  notes
    .command('list')
    .description('List notes')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('-s, --search <text>', 'Filter by keyword')
    .option('-p, --page <n>', 'Page number (starting from 1)', '1')
    .option('-l, --limit <n>', 'Items per page', '20')
    .action(async (opts) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const page = Math.max(1, Number(opts.page));
        const limit = Number(opts.limit);
        const offset = (page - 1) * limit;

        const data = await client.listNotes({
          tag: opts.tag,
          search: opts.search,
          offset,
          limit,
        });

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(data);
          return;
        }

        const totalPages = Math.ceil(data.total / limit);
        printHeader(`Notes (page ${page}/${totalPages}, total ${data.total})`);

        if (data.items.length === 0) {
          console.log('  No notes found.\n');
          return;
        }

        printTable(
          ['ID', 'Title', 'Tags', 'Created'],
          data.items.map((n) => [
            n.id,
            truncate(n.title, 40),
            (n.tags || []).slice(0, 3).join(', '),
            n.created_at.slice(0, 10),
          ]),
        );
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to list notes');
        process.exit(1);
      }
    });

  notes
    .command('get <id>')
    .description('View a note in detail')
    .action(async (id) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const note = await client.getNote(Number(id));

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(note);
          return;
        }

        printHeader(note.title);
        printKeyValue('ID', note.id);
        printKeyValue('Project', note.project_name);
        printKeyValue('Tags', (note.tags || []).join(', ') || '(none)');
        printKeyValue('Created', note.created_at);

        console.log(`\n  Summary:\n`);
        for (const line of note.summary.split('\n')) {
          console.log(`    ${line}`);
        }

        if (note.key_conclusions.length > 0) {
          console.log(`\n  Key Conclusions:\n`);
          for (const c of note.key_conclusions) {
            console.log(`    - ${c}`);
          }
        }

        if (note.code_snippets.length > 0) {
          console.log(`\n  Code Snippets:\n`);
          for (const s of note.code_snippets) {
            console.log(`    [${s.language}] ${s.description}`);
            for (const line of s.code.split('\n').slice(0, 5)) {
              console.log(`      ${line}`);
            }
            if (s.code.split('\n').length > 5) {
              console.log(`      ...`);
            }
            console.log();
          }
        }
        console.log();
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to get note');
        process.exit(1);
      }
    });

  notes
    .command('relations <id>')
    .description('View relations for a note')
    .action(async (id) => {
      const globalOpts = program.opts();
      const client = new CrystalClient(globalOpts.baseUrl);

      try {
        const relations = await client.getNoteRelations(Number(id));

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(relations);
          return;
        }

        if (relations.length === 0) {
          console.log('\n  No relations found for this note.\n');
          return;
        }

        printHeader(`Relations for note #${id}`);
        printTable(
          ['Type', 'Target', 'Title', 'Confidence'],
          relations.map((r) => [
            r.relation_type,
            `#${r.target_note_id === Number(id) ? r.source_note_id : r.target_note_id}`,
            truncate((r.target_note_id === Number(id) ? r.source_title : r.target_title) || '', 40),
            (r.confidence * 100).toFixed(0) + '%',
          ]),
        );
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to get relations');
        process.exit(1);
      }
    });
}
