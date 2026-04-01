import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';

export function useNoteRelations(noteId: number) {
  return useQuery({
    queryKey: ['note-relations', noteId],
    queryFn: () => api.getNoteRelations(noteId),
    enabled: noteId > 0,
  });
}

export function useCreateRelation(noteId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { target_note_id: number; relation_type: string; description?: string }) =>
      api.createRelation(noteId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-relations', noteId] });
    },
  });
}

export function useDeleteRelation(noteId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (relationId: number) => api.deleteRelation(relationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-relations', noteId] });
    },
  });
}

export function useDiscoverRelations(noteId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.discoverRelations(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-relations', noteId] });
    },
  });
}
