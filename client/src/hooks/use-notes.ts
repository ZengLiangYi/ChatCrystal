import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExperienceReviewReason } from '@chatcrystal/shared';
import { api } from '@/lib/api.ts';

export function useNotes(params?: {
  tag?: string;
  search?: string;
  offset?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['notes', params],
    queryFn: () => api.getNotes(params),
  });
}

export function useNote(id: number) {
  return useQuery({
    queryKey: ['note', id],
    queryFn: () => api.getNote(id),
    enabled: id > 0,
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      reason,
      comment,
    }: {
      id: number;
      reason: ExperienceReviewReason;
      comment?: string;
    }) => api.deleteNote(id, { reason, comment, source: 'web' }),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['note', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversation', data.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useSummarize() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api.summarize(conversationId),
    onSuccess: (_data, conversationId) => {
      // Invalidate queue so StatusBar starts polling
      queryClient.invalidateQueries({ queryKey: ['queue-status'] });
      // Invalidate the specific conversation detail (refreshes status from DB)
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useSummarizeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.summarizeBatch(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-status'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useCancelQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.cancelQueue(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-status'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.getTags(),
  });
}
