import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';

export interface TaskEntry {
  id: string;
  title: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface QueueSnapshot {
  total: number;
  completed: number;
  failed: number;
  active: number;
  tasks: TaskEntry[];
}

export function useQueueTasks() {
  return useQuery({
    queryKey: ['queue-status'],
    queryFn: () => api.getQueueStatus(),
    refetchInterval: (query) => {
      const data = query.state.data as QueueSnapshot | undefined;
      // Poll every 2s when active, otherwise every 10s (catch newly enqueued tasks)
      return data && data.active > 0 ? 2000 : 10000;
    },
  });
}
