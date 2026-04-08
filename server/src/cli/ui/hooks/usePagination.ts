import { useState, useCallback, useRef } from 'react';

export interface PaginationState<T> {
  /** All loaded items so far */
  items: T[];
  /** Total items available on server */
  total: number;
  /** Whether currently loading a page */
  loading: boolean;
  /** Error from last fetch attempt */
  error: string | null;
  /** Whether there are more pages to load */
  hasMore: boolean;
}

interface UsePaginationOptions<T> {
  pageSize?: number;
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>;
}

interface UsePaginationReturn<T> extends PaginationState<T> {
  /** Load the next page. No-op if already loading or no more pages. */
  loadMore: () => void;
  /** Reload from scratch (e.g., after filter change). */
  reload: () => void;
  /** Retry last failed load. */
  retry: () => void;
}

/**
 * Lazy-loading pagination hook. Fetches one page at a time,
 * appending to in-memory list. Supports reload and retry.
 */
export function usePagination<T>({ pageSize = 20, fetchPage }: UsePaginationOptions<T>): UsePaginationReturn<T> {
  const [state, setState] = useState<PaginationState<T>>({
    items: [],
    total: 0,
    loading: true,
    error: null,
    hasMore: true,
  });

  const abortRef = useRef<AbortController | null>(null);
  const offsetRef = useRef(0);
  const initialLoadDone = useRef(false);

  const doFetch = useCallback((offset: number, replace: boolean) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState(prev => ({ ...prev, loading: true, error: null }));

    fetchPage(offset, pageSize)
      .then(result => {
        if (controller.signal.aborted) return;
        setState(prev => {
          const merged = replace ? result.items : [...prev.items, ...result.items];
          return {
            items: merged,
            total: result.total,
            loading: false,
            error: null,
            hasMore: merged.length < result.total,
          };
        });
        offsetRef.current = offset + result.items.length;
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
  }, [fetchPage, pageSize]);

  const loadMore = useCallback(() => {
    if (state.loading || !state.hasMore) return;
    doFetch(offsetRef.current, false);
  }, [state.loading, state.hasMore, doFetch]);

  const reload = useCallback(() => {
    offsetRef.current = 0;
    setState({ items: [], total: 0, loading: true, error: null, hasMore: true });
    doFetch(0, true);
  }, [doFetch]);

  const retry = useCallback(() => {
    doFetch(offsetRef.current, offsetRef.current === 0);
  }, [doFetch]);

  // Auto-load first page on mount
  if (!initialLoadDone.current) {
    initialLoadDone.current = true;
    doFetch(0, true);
  }

  return {
    ...state,
    loadMore,
    reload,
    retry,
  };
}
