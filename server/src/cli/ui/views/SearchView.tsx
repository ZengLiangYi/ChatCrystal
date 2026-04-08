import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { SearchBar } from '../components/SearchBar.js';
import { InteractiveList, type ColumnDef } from '../components/InteractiveList.js';
import { getLocale } from '../locale/index.js';
import type { CrystalClient } from '../../client.js';

interface SearchResult {
  note_id: number;
  title: string;
  project_name: string;
  score: number;
  tags: string[];
}

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
  const [showInput, setShowInput] = useState(!initialQuery);
  const [query, setQuery] = useState(initialQuery || '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = getLocale();

  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setQuery(q);
    setShowInput(false);
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const data = await client.search(q, 50);
      if (controller.signal.aborted) return;
      setResults(data as SearchResult[]);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, [client]);

  useEffect(() => {
    if (initialQuery) doSearch(initialQuery);
  }, [initialQuery, doSearch]);

  const columns: ColumnDef[] = useMemo(() => [
    { header: t.headerScore, accessor: (r: SearchResult) => r.score.toFixed(3), width: 7 },
    { header: t.headerTitle, accessor: (r: SearchResult) => r.title },
    { header: t.headerProject, accessor: (r: SearchResult) => r.project_name, width: 17 },
    { header: t.headerTags, accessor: (r: SearchResult) => r.tags.slice(0, 3).join(', '), width: 20 },
  ], [t]);

  // Input mode: only SearchBar, no InteractiveList
  if (showInput) {
    return (
      <Box flexDirection="column" paddingTop={1} paddingLeft={1}>
        <SearchBar
          onSubmit={doSearch}
          onCancel={onBack}
          placeholder={t.searchPlaceholder}
          initialValue={query}
        />
      </Box>
    );
  }

  // Searching + results: single InteractiveList instance, never unmounted between states.
  // This avoids Ink useInput re-registration issues on phase transitions.
  const titleText = searching
    ? `${t.searching} "${query}"`
    : `${t.searchTitle}: "${query}" (${t.searchResult(results.length)})`;

  return (
    <InteractiveList<SearchResult>
      items={results}
      columns={columns}
      total={results.length}
      loading={searching}
      error={error}
      hasMore={false}
      onLoadMore={() => {}}
      onSelect={(item, index) => onSelectNote(item.note_id, index)}
      onSearch={() => setShowInput(true)}
      onQuit={onBack}
      title={titleText}
      keyboardActive={!searching}
    />
  );
}
