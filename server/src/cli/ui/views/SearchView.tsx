import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { SearchBar } from '../components/SearchBar.js';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { Spinner } from '../components/Spinner.js';
import { getLocale } from '../locale/index.js';
import { truncate } from '../../formatter.js';
import type { CrystalClient } from '../../client.js';

interface SearchResult {
  note_id: number;
  title: string;
  project_name: string;
  score: number;
  tags: string[];
}

type SearchPhase = 'input' | 'searching' | 'results';

interface SearchViewProps {
  client: CrystalClient;
  /** Pre-filled query (e.g., from search command argument) */
  initialQuery?: string;
  /** Called when user selects a result */
  onSelectNote: (noteId: number, index: number) => void;
  /** Called when user cancels/quits */
  onBack: () => void;
}

export function SearchView({ client, initialQuery, onSelectNote, onBack }: SearchViewProps) {
  const [phase, setPhase] = useState<SearchPhase>(initialQuery ? 'searching' : 'input');
  const [query, setQuery] = useState(initialQuery || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const t = getLocale();

  // I3 fix: AbortController to cancel previous search on new search
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setQuery(q);
    setPhase('searching');
    setError(null);
    try {
      const data = await client.search(q, 50);
      if (controller.signal.aborted) return;
      setResults(data as SearchResult[]);
      setPhase('results');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('results');
    }
  }, [client]);

  // I4 fix: auto-search with correct deps
  useEffect(() => {
    if (initialQuery) doSearch(initialQuery);
  }, [initialQuery, doSearch]);

  const columns: ColumnDef[] = useMemo(() => [
    { header: t.headerScore, accessor: (r: SearchResult) => r.score.toFixed(3), width: 7 },
    { header: t.headerTitle, accessor: (r: SearchResult) => r.title },
    { header: t.headerProject, accessor: (r: SearchResult) => r.project_name, width: 17 },
    { header: t.headerTags, accessor: (r: SearchResult) => r.tags.slice(0, 3).join(', '), width: 20 },
  ], [t]);

  if (phase === 'input') {
    return (
      <Box key="search-input" flexDirection="column" paddingTop={1} paddingLeft={1}>
        <SearchBar
          onSubmit={doSearch}
          onCancel={onBack}
          placeholder={t.searchPlaceholder}
          initialValue={query}
        />
      </Box>
    );
  }

  if (phase === 'searching') {
    return (
      <Box key="search-loading" flexDirection="column" paddingTop={1} paddingLeft={2}>
        <Spinner label={`${t.searching} "${query}"`} />
      </Box>
    );
  }

  // Results phase — key forces full remount so useInput registers correctly
  return (
    <InteractiveList<SearchResult>
      key="search-results"
      items={results}
      columns={columns}
      total={results.length}
      loading={false}
      error={error}
      hasMore={false}
      onLoadMore={() => {}}
      onSelect={(item, index) => onSelectNote(item.note_id, index)}
      onSearch={() => setPhase('input')}
      onQuit={onBack}
      title={`${t.searchTitle}: "${query}" (${t.searchResult(results.length)})`}
    />
  );
}
