import React from 'react';
import { Text, Box } from 'ink';

export interface TaskItem {
  id: string;
  title: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  duration?: number;
  error?: string;
}

interface TaskListProps {
  tasks: TaskItem[];
  maxVisible?: number;
}

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: TaskItem['status'] }) {
  switch (status) {
    case 'completed':
      return <Text color="green">✓</Text>;
    case 'processing':
      return <Text color="yellow">◉</Text>;
    case 'failed':
      return <Text color="red">✗</Text>;
    case 'queued':
      return <Text dimColor>○</Text>;
  }
}

export function TaskList({ tasks, maxVisible = 10 }: TaskListProps) {
  const processing = tasks.filter((t) => t.status === 'processing');
  const completed = tasks.filter((t) => t.status === 'completed');
  const failed = tasks.filter((t) => t.status === 'failed');
  const queued = tasks.filter((t) => t.status === 'queued');

  const visible = [
    ...processing,
    ...completed.slice(-Math.max(maxVisible - processing.length - queued.length, 2)),
    ...failed,
    ...queued.slice(0, Math.max(maxVisible - processing.length - completed.length - failed.length, 2)),
  ].slice(0, maxVisible);

  return (
    <Box flexDirection="column">
      {visible.map((task) => (
        <Box key={task.id} gap={1}>
          <StatusIcon status={task.status} />
          <Text
            dimColor={task.status === 'queued'}
            color={task.status === 'failed' ? 'red' : undefined}
          >
            {task.title.length > 40 ? task.title.slice(0, 37) + '...' : task.title}
          </Text>
          {task.status === 'completed' && task.duration != null && (
            <Text dimColor>{formatDuration(task.duration)}</Text>
          )}
          {task.status === 'processing' && (
            <Text color="yellow">...</Text>
          )}
          {task.status === 'failed' && task.error && (
            <Text dimColor>{task.error.length > 30 ? task.error.slice(0, 27) + '...' : task.error}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
