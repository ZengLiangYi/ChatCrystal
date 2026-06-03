import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderGit2, Loader2, Network, Search, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api.ts';

type SearchResult = {
  note_id: number;
  conversation_id: string;
  title: string;
  project_name: string;
  score: number;
  tags: string[];
  via_relation: string | null;
};

export function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [expand, setExpand] = useState(false);
  const navigate = useNavigate();

  const search = useMutation({
    mutationFn: (q: string) => api.search(q, 10, expand),
  });

  const handleSearch = () => {
    if (!query.trim()) return;
    search.mutate(query);
  };

  return (
    <div className="p-6">
      <h2 className="mb-4 text-xl font-bold">{t('title.semantic_search')}</h2>

      <div className="mb-3 flex gap-2">
        <label htmlFor="semantic-search-input" className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            id="semantic-search-input"
            type="text"
            placeholder={t('placeholder.semantic_search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
            className="bg-secondary pl-8"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={handleSearch}
          disabled={search.isPending || !query.trim()}
          className="text-accent"
        >
          {search.isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Search data-icon="inline-start" />
          )}
          {t('action.search')}
        </Button>
      </div>

      <label
        htmlFor="search-expand-related"
        className="mb-6 flex cursor-pointer select-none items-center gap-2 text-xs text-muted"
      >
        <Checkbox
          id="search-expand-related"
          checked={expand}
          onCheckedChange={(checked) => setExpand(checked === true)}
        />
        <Network className="size-3" />
        {t('search_page.expand_related_notes')}
      </label>

      {search.isError && (
        <p className="mb-4 text-sm text-error">{search.error.message}</p>
      )}

      {search.data && search.data.length === 0 && (
        <div className="py-12 text-center text-sm text-muted">
          <Search className="mx-auto mb-3 size-8 opacity-30" />
          <p>{t('empty_state.no_search_results')}</p>
          <p className="mt-1 text-xs">{t('empty_state.no_search_results_hint')}</p>
        </div>
      )}

      {search.data && search.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="mb-1 text-xs text-muted">{t('search_results_count', { count: search.data.length })}</p>
          {search.data.map((result: SearchResult) => (
            <div
              key={result.note_id}
              onClick={() => navigate(`/notes/${result.note_id}`)}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-secondary p-3 transition-colors hover:border-[var(--accent)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-bold">{result.title}</h3>
                  {result.via_relation && (
                    <Badge variant="outline" className="shrink-0 text-info">
                      <Network className="size-3" />
                      {t(`relation.search.${result.via_relation}`, { defaultValue: result.via_relation })}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <FolderGit2 className="size-3" />
                    {result.project_name}
                  </span>
                  {result.tags.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Tag className="size-3" />
                      {result.tags.slice(0, 3).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <Badge
                variant="secondary"
                className={
                  result.score > 0.7
                    ? 'font-mono text-success'
                    : result.score > 0.4
                      ? 'font-mono text-warning'
                      : 'font-mono text-muted'
                }
              >
                {(result.score * 100).toFixed(0)}%
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
