import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CrystalClient } from '../client.js';
import {
  RecallForTaskRequestShape,
  WriteTaskMemoryRequestShape,
} from '../../services/memory/schemas.js';

export async function startMcpServer(baseUrl: string) {
  const client = new CrystalClient(baseUrl);
  const server = new McpServer({
    name: 'chatcrystal',
    version: '0.2.0',
  });

  // Tool 1: search_knowledge
  server.tool(
    'search_knowledge',
    'Semantic search across your AI conversation knowledge base. Returns matching notes ranked by relevance.',
    {
      query: z.string().describe('Search query text'),
      limit: z.number().optional().default(10).describe('Maximum number of results'),
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
  server.tool(
    'get_note',
    'Get the full content of a note including title, summary, key conclusions, code snippets, and tags.',
    {
      id: z.number().describe('Note ID'),
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
  server.tool(
    'list_notes',
    'Browse notes in the knowledge base. Filter by tag or keyword search.',
    {
      tag: z.string().optional().describe('Filter by tag name'),
      search: z.string().optional().describe('Filter by keyword in title/summary'),
      page: z.number().optional().default(1).describe('Page number'),
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
  server.tool(
    'get_relations',
    'Get related notes for a given note, including relationship type and confidence score.',
    {
      noteId: z.number().describe('Note ID to find relations for'),
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

  server.tool(
    'recall_for_task',
    'Recall project-first and global-supplement memories for a task.',
    RecallForTaskRequestShape,
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

  server.tool(
    'write_task_memory',
    'Persist a task memory with idempotent auto-writeback semantics.',
    WriteTaskMemoryRequestShape,
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
