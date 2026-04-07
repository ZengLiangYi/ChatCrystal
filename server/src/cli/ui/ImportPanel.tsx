import React, { useState, useEffect } from 'react';
import { render, Text, Box } from 'ink';
import { Spinner } from './components/Spinner.js';
import { ProgressBar } from './components/ProgressBar.js';
import type { CrystalClient } from '../client.js';

interface ImportProgress {
  total: number;
  current: number;
  currentFile: string;
  imported: number;
  skipped: number;
  errors: number;
}

interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
}

function ImportPanelApp({ client, onDone }: { client: CrystalClient; onDone: (err?: Error) => void }) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .importScanStream((p) => setProgress(p))
      .then((res) => {
        setResult(res);
        setTimeout(() => onDone(), 500);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setTimeout(() => onDone(err instanceof Error ? err : new Error(String(err))), 500);
      });
  }, []);

  if (error) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Text color="red">✗ Import failed: {error}</Text>
      </Box>
    );
  }

  if (result) {
    return (
      <Box flexDirection="column" paddingLeft={2} gap={1}>
        <Text color="green">✓ Import complete</Text>
        <Box flexDirection="column">
          <Text>  <Text dimColor>Scanned  </Text> {result.total}</Text>
          <Text>  <Text dimColor>Imported </Text> {result.imported}</Text>
          <Text>  <Text dimColor>Skipped  </Text> {result.skipped}</Text>
          <Text>  <Text dimColor>Errors   </Text> {result.errors}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingLeft={2} gap={1}>
      <Spinner label="Importing conversations..." />
      {progress && (
        <>
          <ProgressBar current={progress.current} total={progress.total} />
          <Box flexDirection="column">
            <Text>  <Text dimColor>Imported </Text> {progress.imported}</Text>
            <Text>  <Text dimColor>Skipped  </Text> {progress.skipped}</Text>
            <Text>  <Text dimColor>Errors   </Text> {progress.errors}</Text>
          </Box>
          <Text dimColor>  Current: {progress.currentFile}</Text>
        </>
      )}
    </Box>
  );
}

export async function renderImportPanel(client: CrystalClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const { unmount } = render(
      <ImportPanelApp
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
