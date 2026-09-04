import { z } from 'zod';

export const SourceAgentSchema = z.enum([
  'codex',
  'claude',
  'copilot',
  'cursor',
  'trae',
  'unknown',
]).describe('AI coding tool or agent that is calling ChatCrystal; use unknown when unsure.');

const TaskBaseSchema = z.object({
  goal: z.string().min(1).describe('Plain-language task goal or user request. Include enough context to retrieve relevant memories.'),
  task_kind: z.enum([
    'debug',
    'implement',
    'refactor',
    'migration',
    'config',
    'investigate',
    'optimization',
  ]).describe('Kind of work being performed. Use debug for failures; choose the closest non-debug category for planned work.'),
  project_key: z.string().optional().describe('Stable project identifier used to prioritize project-scoped memories, such as a repository or workspace key.'),
  project_dir: z.string().optional().describe('Absolute project directory when known; helps ChatCrystal match memories to the right local workspace.'),
  cwd: z.string().optional().describe('Current working directory of the agent session.'),
  branch: z.string().optional().describe('Current VCS branch when relevant to the task.'),
  files_touched: z.array(z.string()).optional().describe('Files already touched or expected to be touched; improves project memory matching.'),
  error_signatures: z.array(z.string()).optional().describe('Concrete errors, stack traces, failing commands, or symptoms. Most useful with debug tasks.'),
  source_agent: SourceAgentSchema.optional(),
});

const RecallTaskSchema = TaskBaseSchema.extend({
  related_files: z.array(z.string()).optional().describe('Additional files related to the task but not necessarily modified.'),
});

const NormalizedTaskSchema = TaskBaseSchema.transform((task) => ({
  ...task,
  source_agent: task.source_agent ?? 'unknown',
})).describe('Current task context used to scope, rank, and store memories.');

export const RecallForTaskOptionsShape = {
  project_limit: z.number().int().nonnegative().default(5).describe('Maximum number of project-scoped memories to return first.'),
  global_limit: z.number().int().nonnegative().default(3).describe('Maximum number of cross-project/global lessons to append after project memories.'),
  include_relations: z.boolean().default(true).describe('Whether to include related-note context for returned memories.'),
} as const;

export const RecallForTaskRequestShape = {
  mode: z.enum(['task', 'debug']).default('task').describe('Use task for normal work and debug when the task starts from an error, failing test, or incident.'),
  task: RecallTaskSchema.transform((task) => ({
    ...task,
    source_agent: task.source_agent ?? 'unknown',
  })).describe('Current task context used to retrieve relevant project and global memories.'),
  options: z.object(RecallForTaskOptionsShape).optional().describe('Optional limits and relation expansion controls for recall results.'),
} as const;

export const RecallForTaskRequestSchema = z.object(RecallForTaskRequestShape);

export const WriteTaskMemoryPayloadShape = {
  title: z.string().optional().describe('Specific note title. Prefer the durable lesson over a generic task name.'),
  summary: z.string().min(1).describe('Concrete summary of what was learned or decided, written so it remains useful in a later session.'),
  outcome_type: z.enum(['pitfall', 'fix', 'pattern', 'decision']).describe('Primary kind of reusable memory being saved.'),
  pitfalls: z.array(z.string()).optional().describe('Mistakes, traps, or failure modes future agents should avoid.'),
  root_cause: z.string().optional().describe('Underlying cause of the problem when the memory is about a fix or pitfall.'),
  resolution: z.string().optional().describe('Specific fix or action that resolved the issue.'),
  reusable_patterns: z.array(z.string()).optional().describe('Generalizable implementation, debugging, migration, or configuration patterns.'),
  decisions: z.array(z.string()).optional().describe('Durable design, product, architecture, or process decisions made during the task.'),
  key_conclusions: z.array(z.string()).optional().describe('Important takeaways that should be recalled before similar future work.'),
  code_snippets: z.array(
    z.object({
      language: z.string().describe('Programming or markup language for the snippet.'),
      code: z.string().describe('Minimal code, command, config, or query that illustrates the reusable lesson.'),
      description: z.string().describe('Why this snippet matters and when to reuse it.'),
    }),
  ).optional().describe('Small snippets that make the memory actionable without copying large files.'),
  files_touched: z.array(z.string()).optional().describe('Files that provide useful provenance for the memory.'),
  error_signatures: z.array(z.string()).optional().describe('Exact errors or symptoms that should trigger this memory in future debug recall.'),
  tags: z.array(z.string()).optional().describe('Short tags for retrieval, such as framework, subsystem, source tool, or failure type.'),
} as const;

export const WriteTaskMemoryRequestShape = {
  mode: z.enum(['auto', 'manual']).describe('Use auto for agent-generated writebacks and manual for explicit user-curated memories.'),
  source_run_key: z.string().optional().describe('Idempotency key for auto writebacks; required in auto mode to avoid duplicate memory receipts.'),
  scope: z.enum(['project', 'global']).optional().describe('Store as project memory by default; global is reserved for broadly reusable manual lessons.'),
  task: NormalizedTaskSchema,
  memory: z.object(WriteTaskMemoryPayloadShape).describe('Candidate ChatCrystal note content to validate or persist as reusable task memory.'),
} as const;

export const WriteTaskMemoryRequestSchema = z
  .object(WriteTaskMemoryRequestShape)
  .superRefine((value, ctx) => {
    if (value.mode === 'auto' && !value.source_run_key) {
      ctx.addIssue({
        code: 'custom',
        path: ['source_run_key'],
        message: 'source_run_key is required when mode=auto',
      });
    }
    if (value.mode === 'auto' && value.scope === 'global') {
      ctx.addIssue({
        code: 'custom',
        path: ['scope'],
        message: 'scope=global is only allowed when mode=manual',
      });
    }
  });

export const ValidateTaskMemoryRequestShape = WriteTaskMemoryRequestShape;
export const ValidateTaskMemoryRequestSchema = WriteTaskMemoryRequestSchema;

export function parseWriteTaskMemoryRequest(input: unknown) {
  return WriteTaskMemoryRequestSchema.parse(input);
}

export function parseValidateTaskMemoryRequest(input: unknown) {
  return ValidateTaskMemoryRequestSchema.parse(input);
}

export function parseRecallForTaskRequest(input: unknown) {
  return RecallForTaskRequestSchema.parse(input);
}
