import { z } from 'zod';

export const SourceAgentSchema = z.enum([
  'codex',
  'claude',
  'copilot',
  'cursor',
  'trae',
  'unknown',
]);

const TaskBaseSchema = z.object({
  goal: z.string().min(1),
  task_kind: z.enum([
    'debug',
    'implement',
    'refactor',
    'migration',
    'config',
    'investigate',
    'optimization',
  ]),
  project_key: z.string().optional(),
  project_dir: z.string().optional(),
  cwd: z.string().optional(),
  branch: z.string().optional(),
  files_touched: z.array(z.string()).optional(),
  error_signatures: z.array(z.string()).optional(),
  source_agent: SourceAgentSchema.optional(),
});

const RecallTaskSchema = TaskBaseSchema.extend({
  related_files: z.array(z.string()).optional(),
});

const NormalizedTaskSchema = TaskBaseSchema.transform((task) => ({
  ...task,
  source_agent: task.source_agent ?? 'unknown',
}));

export const RecallForTaskOptionsShape = {
  project_limit: z.number().int().nonnegative().default(5),
  global_limit: z.number().int().nonnegative().default(3),
  include_relations: z.boolean().default(true),
} as const;

export const RecallForTaskRequestShape = {
  mode: z.enum(['task', 'debug']).default('task'),
  task: RecallTaskSchema.transform((task) => ({
    ...task,
    source_agent: task.source_agent ?? 'unknown',
  })),
  options: z.object(RecallForTaskOptionsShape).optional(),
} as const;

export const RecallForTaskRequestSchema = z.object(RecallForTaskRequestShape);

export const WriteTaskMemoryPayloadShape = {
  title: z.string().optional(),
  summary: z.string().min(1),
  outcome_type: z.enum(['pitfall', 'fix', 'pattern', 'decision']),
  pitfalls: z.array(z.string()).optional(),
  root_cause: z.string().optional(),
  resolution: z.string().optional(),
  reusable_patterns: z.array(z.string()).optional(),
  decisions: z.array(z.string()).optional(),
  key_conclusions: z.array(z.string()).optional(),
  code_snippets: z.array(
    z.object({
      language: z.string(),
      code: z.string(),
      description: z.string(),
    }),
  ).optional(),
  files_touched: z.array(z.string()).optional(),
  error_signatures: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
} as const;

export const WriteTaskMemoryRequestShape = {
  mode: z.enum(['auto', 'manual']),
  source_run_key: z.string().optional(),
  scope: z.enum(['project', 'global']).optional(),
  task: NormalizedTaskSchema,
  memory: z.object(WriteTaskMemoryPayloadShape),
} as const;

export const WriteTaskMemoryRequestSchema = z
  .object(WriteTaskMemoryRequestShape)
  .superRefine((value, ctx) => {
    if (value.mode === 'auto' && !value.source_run_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source_run_key'],
        message: 'source_run_key is required when mode=auto',
      });
    }
    if (value.mode === 'auto' && value.scope === 'global') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scope'],
        message: 'scope=global is only allowed when mode=manual',
      });
    }
  });

export function parseWriteTaskMemoryRequest(input: unknown) {
  return WriteTaskMemoryRequestSchema.parse(input);
}

export function parseRecallForTaskRequest(input: unknown) {
  return RecallForTaskRequestSchema.parse(input);
}
