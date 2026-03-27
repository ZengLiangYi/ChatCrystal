import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';

export function useConversations(params?: {
  source?: string;
  project?: string;
  search?: string;
  offset?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['conversations', params],
    queryFn: () => api.getConversations(params),
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
