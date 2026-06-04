import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, FolderGit2, Search, Sparkles, Tag, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDeleteNote, useNotes, useTags, useSummarizeBatch } from '@/hooks/use-notes.ts';
import { cn } from '@/lib/cn';

const MEMORY_SOURCE_TYPES = new Set(['agent-writeback', 'manual-note']);
const TAG_OPTION_LIMIT = 14;

export function Notes() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [includeTaskMemory, setIncludeTaskMemory] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const limit = 20;
  const navigate = useNavigate();

  const { data, isLoading } = useNotes({
    search: search || undefined,
    tag: selectedTags.length > 0 ? selectedTags : undefined,
    sourceKind: includeTaskMemory ? 'memory' : 'conversation',
    offset: page * limit,
    limit,
  });

  const { data: tags } = useTags();
  const summarizeBatch = useSummarizeBatch();
  const deleteNote = useDeleteNote();

  const tagOptions = useMemo(() => {
    if (!tags) return [];
    const selected = new Set(selectedTags);
    const keyword = tagSearch.trim().toLowerCase();
    if (!keyword) return [];
    return [...tags]
      .filter((tag) => !selected.has(tag.name))
      .filter((tag) => tag.name.toLowerCase().includes(keyword))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, TAG_OPTION_LIMIT);
  }, [tags, selectedTags, tagSearch]);

  const hasActiveFilters = Boolean(search.trim()) || includeTaskMemory || selectedTags.length > 0;

  function resetPage() {
    setPage(0);
  }

  function selectTag(tagName: string) {
    setSelectedTags((current) => current.includes(tagName) ? current : [...current, tagName]);
    setTagSearch('');
    resetPage();
  }

  function removeTag(tagName: string) {
    setSelectedTags((current) => current.filter((tag) => tag !== tagName));
    resetPage();
  }

  function clearFilters() {
    setSearch('');
    setIncludeTaskMemory(false);
    setSelectedTags([]);
    setTagSearch('');
    resetPage();
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">{t('title.notes')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{t('notes_total', { count: data?.total ?? 0 })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => summarizeBatch.mutate()}
            disabled={summarizeBatch.isPending}
            className="text-accent hover:bg-muted"
          >
            <Sparkles data-icon="inline-start" />
            {summarizeBatch.isPending ? t('status.processing') : t('action.batch_generate')}
          </Button>
        </div>
      </div>

      <div className="mb-4 rounded-md border border-border bg-secondary px-3 py-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <label htmlFor="notes-search-input" className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              id="notes-search-input"
              type="text"
              placeholder={t('placeholder.search_notes')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                resetPage();
              }}
              className="bg-primary pl-8"
            />
          </label>

          <div className="flex min-w-[220px] xl:w-80">
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-0 flex-1 justify-start rounded-r-none border-r-0 text-muted"
                >
                  <Tag data-icon="inline-start" />
                  <span className="truncate">
                    {selectedTags.length > 0
                      ? t('notes.filter.tags_selected', { count: selectedTags.length })
                      : t('notes.filter.tag_search')}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-1">
                <Command shouldFilter={false}>
                  <CommandInput
                    value={tagSearch}
                    onValueChange={setTagSearch}
                    placeholder={t('notes.filter.tag_search')}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {tagSearch.trim()
                        ? t('notes.filter.no_tag_matches')
                        : t('notes.filter.type_tag_to_search')}
                    </CommandEmpty>
                    {tagOptions.length > 0 && (
                      <CommandGroup>
                        {tagOptions.map((tag) => (
                          <CommandItem
                            key={tag.id}
                            value={tag.name}
                            onSelect={() => selectTag(tag.name)}
                            className="cursor-pointer"
                          >
                            <Tag className="text-muted" />
                            <span className="truncate">{tag.name}</span>
                            <CommandShortcut>{tag.count}</CommandShortcut>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className="shrink-0 rounded-l-none text-muted"
              aria-label={t('notes.filter.clear')}
              title={t('notes.filter.clear')}
            >
              <X />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge
            asChild
            variant={includeTaskMemory ? 'secondary' : 'outline'}
            className={cn(
              'cursor-pointer select-none',
              includeTaskMemory
                ? 'border-[var(--accent)] text-accent'
                : 'text-muted hover:border-ring hover:text-secondary',
            )}
          >
            <button
              type="button"
              aria-pressed={includeTaskMemory}
              onClick={() => {
                setIncludeTaskMemory((value) => !value);
                resetPage();
              }}
            >
              {includeTaskMemory && <Check data-icon="inline-start" />}
              {t('notes.filter.task_memory')}
              {includeTaskMemory && <X data-icon="inline-end" />}
            </button>
          </Badge>

          {selectedTags.map((tag) => (
            <Badge
              key={tag}
              asChild
              variant="secondary"
              className="cursor-pointer border-[var(--accent)] text-accent"
            >
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={t('notes.filter.remove_tag', { tag })}
              >
                {tag}
                <X data-icon="inline-end" />
              </button>
            </Badge>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">{t('status.loading')}</p>
      ) : data?.items.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted">
          <FileText className="mx-auto mb-3 size-8 opacity-30" />
          <p>{t('empty_state.no_notes')}</p>
          <p className="mt-1 text-xs">{t('empty_state.no_notes_hint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data?.items.map((note) => {
            const isMemoryNote = MEMORY_SOURCE_TYPES.has(String(note.source_type));

            return (
              <div
                key={note.id as number}
                onClick={() => navigate(`/notes/${note.id}`)}
                className="cursor-pointer rounded-md border border-border bg-secondary p-4 transition-colors hover:border-[var(--accent)]"
              >
                <div className="mb-1.5 flex items-start gap-2">
                  <h3 className="flex-1 truncate text-sm font-bold">{note.title as string}</h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteTarget({ id: note.id as number, title: note.title as string });
                    }}
                    className="shrink-0 text-muted hover:text-warning"
                    title={t('delete_note.delete')}
                    aria-label={t('delete_note.delete')}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <FolderGit2 className="size-3" />
                  <span>{note.project_name as string}</span>
                  <Badge variant="outline">
                    {t(isMemoryNote ? 'notes.source.memory' : 'notes.source.conversation')}
                  </Badge>
                </div>
                <p className="mb-3 line-clamp-3 text-xs text-secondary">
                  {(note.summary as string).slice(0, 200)}
                </p>
                {(note.tags as string[])?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(note.tags as string[]).slice(0, 5).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        <Tag className="size-3" />
                        {tag}
                      </Badge>
                    ))}
                    {(note.tags as string[]).length > 5 && (
                      <Badge variant="secondary">
                        +{(note.tags as string[]).length - 5}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <DeleteNoteDialog
          noteTitle={deleteTarget.title}
          isPending={deleteNote.isPending}
          errorMessage={deleteNote.error instanceof Error ? deleteNote.error.message : undefined}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={(input) => {
            deleteNote.mutate(
              { id: deleteTarget.id, ...input },
              { onSuccess: () => setDeleteTarget(null) },
            );
          }}
        />
      )}

      {data && data.total > limit && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="text-secondary"
          >
            {t('pagination.previous')}
          </Button>
          <span className="text-xs text-muted">
            {page + 1} / {Math.ceil(data.total / limit)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={(page + 1) * limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
            className="text-secondary"
          >
            {t('pagination.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
