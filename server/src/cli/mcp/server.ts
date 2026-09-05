import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CrystalClient, type CrystalClientOptions } from '../client.js';
import { readCliPackageVersion } from '../version.js';
import {
  RecallForTaskRequestShape,
  ValidateTaskMemoryRequestShape,
  WriteTaskMemoryRequestShape,
} from '../../services/memory/schemas.js';

const LIST_NOTES_DESCRIPTION = [
  'List note summaries for browsing and narrowing the ChatCrystal knowledge base.',
  'Use this when you need paginated notes filtered by tag or title/summary keyword.',
  'Use search_knowledge instead for semantic relevance ranking, and get_note when you already have an id and need the full note body.',
  'Returns note metadata and summaries, not full note content.',
].join(' ');

const RECALL_FOR_TASK_DESCRIPTION = [
  'Retrieve reusable task memories before starting substantive coding work.',
  'Use this at the beginning of implementation, debugging, migration, configuration, investigation, refactor, or optimization tasks to load project-scoped memories first and optional global lessons second.',
  'Use mode="debug" when the user reports an error, failing command, regression, or incident; include error_signatures and related_files when available.',
  'Use search_knowledge instead for ad hoc semantic note search that is not tied to the current task.',
  'This tool is read-only and returns ranked memories plus optional related-note context without writing anything.',
].join(' ');

const VALIDATE_TASK_MEMORY_DESCRIPTION = [
  'Dry-run validation for a candidate task memory before calling write_task_memory.',
  'Use this after meaningful work and before persisting a lesson to check whether the candidate is durable, specific, reusable, and shaped like a high-quality ChatCrystal note.',
  'It has no side effects and never writes to the knowledge base.',
  'Returns acceptance, rejection reason, warnings, and materialized note fields so agents can revise the candidate or skip weak work logs.',
].join(' ');

export async function startMcpServer(options?: string | CrystalClientOptions) {
  const client = new CrystalClient(options);
  const status = await client.status();
  console.error(`ChatCrystal MCP: ${client.getConnectionSummary(status)}`);
  const server = new McpServer({
    name: 'chatcrystal',
    version: readCliPackageVersion(),
  });

  // Tool 1: search_knowledge
  server.registerTool(
    'search_knowledge',
    {
      description: 'Semantic search across your AI conversation knowledge base. Returns matching notes ranked by relevance.',
      inputSchema: {
        query: z.string().describe('Search query text'),
        limit: z.number().optional().default(10).describe('Maximum number of results'),
      },
    },
    async ({ query, limit }) => {
      const results = await client.search(query, limit);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(results, null, 2),
        }],
      };
    },
  );

  // Tool 2: get_note
  server.registerTool(
    'get_note',
    {
      description: 'Get the full content of a note including title, summary, key conclusions, code snippets, and tags.',
      inputSchema: {
        id: z.number().describe('Note ID'),
      },
    },
    async ({ id }) => {
      const note = await client.getNote(id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(note, null, 2),
        }],
      };
    },
  );

  // Tool 3: list_notes
  server.registerTool(
    'list_notes',
    {
      description: LIST_NOTES_DESCRIPTION,
      inputSchema: {
        tag: z.string().optional().describe('Exact tag name to filter notes by, for example "mcp" or "cursor".'),
        search: z.string().optional().describe('Literal keyword filter applied to note title and summary; not semantic search.'),
        page: z.number().optional().default(1).describe('1-based page number for paginated note summaries. Each page returns up to 20 notes.'),
      },
    },
    async ({ tag, search, page }) => {
      const limit = 20;
      const offset = ((page ?? 1) - 1) * limit;
      const data = await client.listNotes({ tag, search, offset, limit });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        }],
      };
    },
  );

  // Tool 4: get_relations
  server.registerTool(
    'get_relations',
    {
      description: 'Get related notes for a given note, including relationship type and confidence score.',
      inputSchema: {
        noteId: z.number().describe('Note ID to find relations for'),
      },
    },
    async ({ noteId }) => {
      const relations = await client.getNoteRelations(noteId);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(relations, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'recall_for_task',
    {
      description: RECALL_FOR_TASK_DESCRIPTION,
      inputSchema: RecallForTaskRequestShape,
    },
    async (input) => {
      const data = await client.recallForTask(input);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'validate_task_memory',
    {
      description: VALIDATE_TASK_MEMORY_DESCRIPTION,
      inputSchema: ValidateTaskMemoryRequestShape,
    },
    async (input) => {
      const data = await client.validateTaskMemory(input);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    'write_task_memory',
    {
      description: 'Persist a task memory only when it can become a high-quality ChatCrystal note: specific title, concrete summary, meaningful key conclusions, and a durable reusable lesson such as a pitfall, fix, decision, pattern, or symptom-to-resolution mapping. Do not write one-time environment checks, version/status reports, ordinary progress logs, or vague robustness claims. Weak auto writebacks are skipped by core validation and recorded only as receipts.',
      inputSchema: WriteTaskMemoryRequestShape,
    },
    async (input) => {
      const data = await client.writeTaskMemory(input);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        }],
      };
    },
  );

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
