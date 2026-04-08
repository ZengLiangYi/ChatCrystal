import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface ImportProgress {
  total: number;
  current: number;
  currentFile: string;
  imported: number;
  skipped: number;
  errors: number;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: number;
}

type ImportState =
  | { status: 'idle' }
  | { status: 'running'; progress: ImportProgress | null }
  | { status: 'done'; result: ImportResult }
  | { status: 'error'; error: string };

const API_BASE = import.meta.env.DEV ? 'http://localhost:3721' : '';

export function useImportStream() {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const queryClient = useQueryClient();

  const start = useCallback(() => {
    setState({ status: 'running', progress: null });

    fetch(`${API_BASE}/api/import/scan/stream`, {
      headers: { Accept: 'text/event-stream' },
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          setState({ status: 'error', error: `Request failed: ${res.status}` });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventType = '';

        const processChunk = (text: string) => {
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'progress') {
                setState({ status: 'running', progress: data });
              } else if (eventType === 'done') {
                setState({ status: 'done', result: data });
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
                queryClient.invalidateQueries({ queryKey: ['status'] });
              } else if (eventType === 'error') {
                setState({ status: 'error', error: data.error });
              }
            }
          }
        };

        const read = async () => {
          const { done, value } = await reader.read();
          if (done) return;
          processChunk(decoder.decode(value, { stream: true }));
          await read();
        };

        await read();
      })
      .catch((err) => {
        setState({ status: 'error', error: err instanceof Error ? err.message : 'Import failed' });
      });
  }, [queryClient]);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, start, reset };
}
