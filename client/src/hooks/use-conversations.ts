import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';

export function useConversations(
  params?: {
    source?: string;
    project?: string;
    search?: string;
    offset?: number;
    limit?: number;
  },
  options?: {
    /**
     * Extra polling of the list, e.g. while a background sync is importing
     * (`refetchInterval: 3000`). The sync status hook also invalidates
     * `['conversations']` as new conversations come in, so callers only need
     * this when they want the list to refresh on their own schedule.
     */
    refetchInterval?: number | false;
  },
) {
  return useQuery({
    queryKey: ['conversations', params],
    queryFn: () => api.getConversations(params),
    refetchInterval: options?.refetchInterval,
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.getConversation(id),
    enabled: !!id,
  });
}

export function useImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.triggerImport(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => api.getStatus(),
    refetchInterval: 30_000,
  });
}
