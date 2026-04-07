import React, { useState, useEffect } from 'react';
import { render, Text, Box } from 'ink';
import { Spinner } from './components/Spinner.js';
import { TaskList, type TaskItem } from './components/TaskList.js';
import type { CrystalClient } from '../client.js';

interface QueueSnapshot {
  total: number;
  completed: number;
  failed: number;
  active: number;
  tasks: TaskItem[];
}

interface DoneResult {
  total: number;
  completed: number;
  failed: number;
}

function SummarizePanelApp({ client, onDone }: { client: CrystalClient; onDone: (err?: Error) => void }) {
  const [snapshot, setSnapshot] = useState<QueueSnapshot | null>(null);
  const [result, setResult] = useState<DoneResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  useEffect(() => {
    client
      .summarizeBatch()
      .then((data) => {
        setQueued(data.queued);
        if (data.queued === 0) {
          setResult({ total: 0, completed: 0, failed: 0 });
          setTimeout(() => onDone(), 500);
          return;
        }
        return client.queueStream((snap) => setSnapshot(snap as QueueSnapshot));
      })
      .then((res) => {
        if (res) {
          setResult(res);
          setTimeout(() => onDone(), 500);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setTimeout(() => onDone(err instanceof Error ? err : new Error(String(err))), 500);
      });
  }, []);

  if (error) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color="red">✗ Summarization failed: {error}</Text>
      </Box>
    );
  }

  if (result) {
    if (result.total === 0) {
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color="green">✓ Nothing to summarize — all conversations already have notes</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingLeft={2} gap={1}>
        <Text color="green">✓ Summarization complete</Text>
        <Box flexDirection="column">
          <Text>  <Text dimColor>Total    </Text> {result.total}</Text>
          <Text>  <Text dimColor>Completed</Text> {result.completed}</Text>
          {result.failed > 0 && <Text>  <Text color="red">Failed   </Text> {result.failed}</Text>}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} gap={1}>
      <Spinner
        label={snapshot
          ? `Summarizing conversations... (${snapshot.completed}/${snapshot.total})`
          : queued != null
            ? `Queued ${queued} conversations...`
            : 'Starting batch summarization...'}
      />
      {snapshot && snapshot.tasks.length > 0 && (
        <>
          <TaskList tasks={snapshot.tasks} maxVisible={10} />
          <Text>
            <Text dimColor>  Completed: </Text><Text color="green">{snapshot.completed}</Text>
            <Text dimColor>  Processing: </Text><Text color="yellow">{snapshot.active}</Text>
            {snapshot.failed > 0 && <><Text dimColor>  Failed: </Text><Text color="red">{snapshot.failed}</Text></>}
          </Text>
        </>
      )}
    </Box>
  );
}

export async function renderSummarizePanel(client: CrystalClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const { unmount } = render(
      <SummarizePanelApp
        client={client}
        onDone={(err) => {
          unmount();
          if (err) reject(err);
          else resolve();
        }}
      />,
    );
  });
}
