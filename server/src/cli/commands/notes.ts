import type { Command } from 'commander';
import type { ExperienceReviewReason } from '@chatcrystal/shared';
import { CrystalClient } from '../client.js';
import { resolveConnection } from '../connection.js';
import {
  shouldOutputJson, outputJson,
  printHeader, printTable, printKeyValue, printError, truncate,
} from '../formatter.js';
import { isInteractive } from '../interactive.js';
import { renderApp } from '../ui/renderApp.js';

const EXPERIENCE_REVIEW_REASONS = new Set<ExperienceReviewReason>([
  'low-value',
  'inaccurate',
  'not-experience',
  'duplicate',
  'other',
]);

function isExperienceReviewReason(reason: string): reason is ExperienceReviewReason {
  return EXPERIENCE_REVIEW_REASONS.has(reason as ExperienceReviewReason);
}

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
      const connection = resolveConnection({ baseUrl: globalOpts.baseUrl, token: globalOpts.token });
      const client = new CrystalClient({
        baseUrl: connection.baseUrl,
        token: connection.token,
        connectionSource: connection.source,
      });

      try {
        // Interactive mode
        if (isInteractive(globalOpts)) {
          await renderApp(client, {
            type: 'notes-list',
            props: { tagFilter: opts.tag },
          });
          return;
        }

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
      const connection = resolveConnection({ baseUrl: globalOpts.baseUrl, token: globalOpts.token });
      const client = new CrystalClient({
        baseUrl: connection.baseUrl,
        token: connection.token,
        connectionSource: connection.source,
      });

      try {
        // Interactive mode
        if (isInteractive(globalOpts)) {
          await renderApp(client, {
            type: 'note-detail',
            props: { noteId: Number(id) },
          });
          return;
        }

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
    .command('delete <id>')
    .description('Delete a note and record quality feedback')
    .requiredOption(
      '--reason <reason>',
      'Feedback reason: low-value, inaccurate, not-experience, duplicate, other',
    )
    .option('--comment <text>', 'Optional short feedback comment')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (id, opts) => {
      const globalOpts = program.opts();
      const connection = resolveConnection({ baseUrl: globalOpts.baseUrl, token: globalOpts.token });
      const client = new CrystalClient({
        baseUrl: connection.baseUrl,
        token: connection.token,
        connectionSource: connection.source,
      });
      const rawId = String(id);
      const reason = String(opts.reason);

      try {
        if (!/^[1-9]\d*$/.test(rawId)) {
          throw new Error('Invalid note id');
        }

        if (!isExperienceReviewReason(reason)) {
          throw new Error(
            'Invalid reason. Use one of: low-value, inaccurate, not-experience, duplicate, other',
          );
        }

        if (!opts.yes) {
          if (shouldOutputJson(globalOpts.json) || !process.stdout.isTTY) {
            throw new Error('Use --yes when deleting with --json or redirected output');
          }

          if (!process.stdin.isTTY) {
            throw new Error('Use --yes when deleting from a non-interactive shell');
          }
        }

        const noteId = Number(rawId);
        const note = await client.getNote(noteId);

        if (!opts.yes) {
          printHeader(`Delete note #${noteId}`);
          printKeyValue('Title', note.title);
          printKeyValue('Project', note.project_name);
          printKeyValue('Reason', reason);
          process.stdout.write('\nType "delete" to confirm: ');

          const answer = await new Promise<string>((resolve) => {
            process.stdin.resume();
            process.stdin.once('data', (data) => {
              process.stdin.pause();
              resolve(String(data).trim());
            });
          });

          if (answer !== 'delete') {
            console.log('\n  Cancelled.\n');
            return;
          }
        }

        const result = await client.deleteNote(noteId, {
          reason,
          comment: opts.comment,
          source: 'cli',
        });

        if (shouldOutputJson(globalOpts.json)) {
          outputJson(result);
          return;
        }

        printHeader('Deleted note');
        printKeyValue('Note', `#${result.noteId}`);
        printKeyValue('Conversation', result.conversationId);
        printKeyValue('Review', `#${result.reviewId}`);
        printKeyValue('Status', result.conversationStatus);
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Failed to delete note');
        process.exit(1);
      }
    });

  notes
    .command('relations <id>')
    .description('View relations for a note')
    .action(async (id) => {
      const globalOpts = program.opts();
      const connection = resolveConnection({ baseUrl: globalOpts.baseUrl, token: globalOpts.token });
      const client = new CrystalClient({
        baseUrl: connection.baseUrl,
        token: connection.token,
        connectionSource: connection.source,
      });

      try {
        // Interactive mode
        if (isInteractive(globalOpts)) {
          await renderApp(client, {
            type: 'relations',
            props: { noteId: Number(id) },
          });
          return;
        }

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
