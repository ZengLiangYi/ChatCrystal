import { useEffect, useRef } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api.ts';
import type { SyncPhase, SyncStatus } from '@/lib/api.ts';

/** Query key of GET /api/sync/status; shared by every sync status consumer. */
export const SYNC_STATUS_QUERY_KEY = ['sync', 'status'] as const;

/** Poll quickly while a run is in flight, lightly otherwise. */
const SYNCING_POLL_INTERVAL_MS = 2_000;
const IDLE_POLL_INTERVAL_MS = 10_000;
/** A failing endpoint is retried rarely; the UI offers a manual retry button. */
const UNREACHABLE_POLL_INTERVAL_MS = 30_000;

/** Everything the import service can change; refreshed after a run finishes. */
function invalidateDerivedData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['conversations'] });
  void queryClient.invalidateQueries({ queryKey: ['status'] });
  void queryClient.invalidateQueries({ queryKey: ['notes'] });
  void queryClient.invalidateQueries({ queryKey: ['tags'] });
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface StartSyncOptions {
  /** Optional source ids; the server syncs every enabled source when omitted. */
  sources?: string[];
}

export interface UseSyncStatusResult {
  /** The latest server status, `undefined` until the first response arrives. */
  status: SyncStatus | undefined;
  phase: SyncPhase | undefined;
  isLoading: boolean;
  /** Transport/HTTP error of the status query or of the last start/cancel call. */
  error: string | null;
  /** True when the sync endpoint cannot be reached at all (e.g. an older server). */
  isUnavailable: boolean;
  isSyncing: boolean;
  isStarting: boolean;
  isCancelling: boolean;
  startSync: (options?: StartSyncOptions) => void;
  cancelSync: () => void;
  /** Re-read the status after an error or a manual action. */
  refresh: () => void;
}

/**
 * Background sync status with live polling.
 *
 * - 2s polling while a run is in flight, 10s while idle, so the sidebar and the
 *   conversation list follow the import without a manual refresh;
 * - when a run finishes (or `lastCompletedAt`/`finishedAt` moves), the cached
 *   conversations/status/notes/tags queries are invalidated;
 * - while importing, a changed `imported`/`replaced` counter also invalidates the
 *   conversation list, so new conversations appear progressively.
 *
 * SSE (`GET /api/sync/stream`) is deliberately not used: polling has fewer
 * failure modes (proxy buffering, reconnects, cleanup) and 2s is enough here.
 */
export function useSyncStatus(): UseSyncStatusResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...SYNC_STATUS_QUERY_KEY],
    queryFn: () => api.getSyncStatus(),
    refetchInterval: (current) => {
      if (current.state.data?.phase === 'syncing') return SYNCING_POLL_INTERVAL_MS;
      // The endpoint may be missing on an older server; retry rarely instead of
      // hammering it, and let the user force a retry from the sidebar.
      if (current.state.error) return UNREACHABLE_POLL_INTERVAL_MS;
      return IDLE_POLL_INTERVAL_MS;
    },
    retry: 1,
    staleTime: 1_000,
  });

  const startMutation = useMutation({
    mutationFn: (options?: StartSyncOptions) => api.startSync(options),
    onSuccess: (result) => {
      if (!result.started) return;
      void queryClient.invalidateQueries({ queryKey: [...SYNC_STATUS_QUERY_KEY] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelSync(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...SYNC_STATUS_QUERY_KEY] });
    },
  });

  const status = query.data;
  const phase: SyncPhase | undefined = status?.phase;

  // Completion watcher: refresh derived data once a run is over.
  const completedRunRef = useRef<number | null>(null);
  const previousPhaseRef = useRef<SyncPhase | null>(null);
  useEffect(() => {
    if (!status) return;
    const completedAt = status.lastCompletedAt ?? status.finishedAt ?? null;
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = status.phase;

    let shouldInvalidate = false;
    if (completedAt !== null) {
      if (completedRunRef.current === null) {
        completedRunRef.current = completedAt;
      } else if (completedRunRef.current !== completedAt) {
        completedRunRef.current = completedAt;
        shouldInvalidate = true;
      }
    }
    // Safety net: whatever the timestamps say, a run that just stopped
    // syncing means new data may have landed.
    if (previousPhase === 'syncing' && status.phase !== 'syncing') {
      shouldInvalidate = true;
    }
    if (shouldInvalidate) invalidateDerivedData(queryClient);
  }, [status, queryClient]);

  // Progressive refresh: new conversations appear while the run is importing.
  const progressSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (status?.phase !== 'syncing') {
      progressSignatureRef.current = null;
      return;
    }
    const progress = status.progress;
    if (!progress) return;
    const signature = `${progress.imported}:${progress.replaced}:${progress.skipped}:${progress.errors}`;
    if (progressSignatureRef.current === signature) return;
    const isFirstSnapshot = progressSignatureRef.current === null;
    progressSignatureRef.current = signature;
    if (isFirstSnapshot) return;
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['status'] });
  }, [status, queryClient]);

  const error =
    errorMessage(query.isError ? query.error : null) ??
    errorMessage(startMutation.isError ? startMutation.error : null) ??
    errorMessage(cancelMutation.isError ? cancelMutation.error : null);

  return {
    status,
    phase,
    isLoading: query.isLoading,
    error,
    isUnavailable: query.isError && status === undefined,
    isSyncing: phase === 'syncing',
    isStarting: startMutation.isPending,
    isCancelling: cancelMutation.isPending,
    startSync: (options?: StartSyncOptions) => startMutation.mutate(options),
    cancelSync: () => cancelMutation.mutate(),
    refresh: () => {
      void query.refetch();
    },
  };
}
