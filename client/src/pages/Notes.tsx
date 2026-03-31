import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Tag, FolderGit2, Sparkles, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotes, useTags, useSummarizeBatch } from '@/hooks/use-notes.ts';

export function Notes() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState('');
  const [page, setPage] = useState(0);
  const [tagSearch, setTagSearch] = useState('');
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const limit = 20;
  const navigate = useNavigate();
  const tagsContainerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const { data, isLoading } = useNotes({
    search: search || undefined,
    tag: activeTag || undefined,
    offset: page * limit,
    limit,
  });

  const { data: tags } = useTags();
  const summarizeBatch = useSummarizeBatch();

  const filteredTags = useMemo(() => {
    if (!tags) return [];
    if (!tagSearch) return tags;
    const kw = tagSearch.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(kw));
  }, [tags, tagSearch]);

  useEffect(() => {
    const el = tagsContainerRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollHeight > 60);
  }, [filteredTags]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{t('title.notes')}</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{t('notes_total', { count: data?.total ?? 0 })}</span>
          <button
            type="button"
            onClick={() => summarizeBatch.mutate()}
            disabled={summarizeBatch.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-tertiary border border-theme hover:border-[var(--accent)] transition-colors"
            style={{ borderRadius: 'var(--radius)', color: 'var(--accent)' }}
          >
            <Sparkles size={12} />
            {summarizeBatch.isPending ? t('status.processing') : t('action.batch_generate')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder={t('placeholder.search_notes')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="w-full bg-secondary border border-theme px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-[var(--accent)]"
          style={{ borderRadius: 'var(--radius)' }}
        />
      </div>

      {/* Tags */}
      {tags && tags.length > 0 && (
        <div className="mb-4">
          {tags.length >= 15 && (
            <div className="relative mb-2">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder={t('placeholder.filter_tags')}
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                className="w-48 bg-secondary border border-theme pl-7 pr-2 py-1 text-xs text-primary placeholder:text-muted outline-none focus:border-[var(--accent)]"
                style={{ borderRadius: '999px' }}
              />
            </div>
          )}
          <div
            ref={tagsContainerRef}
            className="flex flex-wrap gap-1.5 overflow-hidden transition-[max-height] duration-200"
            style={{ maxHeight: tagsExpanded ? '1000px' : '56px' }}
          >
            <button
              type="button"
              onClick={() => { setActiveTag(''); setPage(0); }}
              className={`px-2 py-0.5 text-xs border transition-colors ${
                !activeTag ? 'border-[var(--accent)] text-accent' : 'border-theme text-muted hover:text-secondary'
              }`}
              style={{ borderRadius: '999px' }}
            >
              {t('filter.all')}
            </button>
            {filteredTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => { setActiveTag(tag.name); setPage(0); }}
                className={`px-2 py-0.5 text-xs border transition-colors ${
                  activeTag === tag.name ? 'border-[var(--accent)] text-accent' : 'border-theme text-muted hover:text-secondary'
                }`}
                style={{ borderRadius: '999px' }}
              >
                {tag.name}
                <span className="ml-1 opacity-50">{tag.count}</span>
              </button>
            ))}
          </div>
          {isOverflowing && !tagSearch && (
            <button
              type="button"
              onClick={() => setTagsExpanded((v) => !v)}
              className="flex items-center gap-1 mt-1.5 text-xs text-muted hover:text-secondary transition-colors"
            >
              {tagsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {tagsExpanded ? t('action.collapse') : t('action.expand_all_tags', { count: tags.length })}
            </button>
          )}
        </div>
      )}

      {/* Notes grid */}
      {isLoading ? (
        <p className="text-muted text-sm">{t('status.loading')}</p>
      ) : data?.items.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm">
          <FileText size={32} className="mx-auto mb-3 opacity-30" />
          <p>{t('empty_state.no_notes')}</p>
          <p className="mt-1 text-xs">{t('empty_state.no_notes_hint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data?.items.map((note) => (
            <div
              key={note.id as number}
              onClick={() => navigate(`/notes/${note.id}`)}
              className="bg-secondary border border-theme p-4 hover:border-[var(--accent)] cursor-pointer transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <h3 className="text-sm font-bold mb-1.5 truncate">{note.title as string}</h3>
              <div className="flex items-center gap-1.5 text-xs text-muted mb-2">
                <FolderGit2 size={11} />
                <span>{note.project_name as string}</span>
              </div>
              <p className="text-xs text-secondary line-clamp-3 mb-3">
                {(note.summary as string).slice(0, 200)}
              </p>
              {(note.tags as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(note.tags as string[]).slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 text-xs bg-tertiary text-muted"
                      style={{ borderRadius: '3px' }}
                    >
                      <Tag size={9} className="inline mr-0.5 -mt-px" />
                      {tag}
                    </span>
                  ))}
                  {(note.tags as string[]).length > 5 && (
                    <span
                      className="px-1.5 py-0.5 text-xs bg-tertiary text-muted"
                      style={{ borderRadius: '3px' }}
                    >
                      +{(note.tags as string[]).length - 5}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="text-sm text-secondary hover:text-primary disabled:opacity-30"
          >
            {t('pagination.previous')}
          </button>
          <span className="text-xs text-muted">
            {page + 1} / {Math.ceil(data.total / limit)}
          </span>
          <button
            type="button"
            disabled={(page + 1) * limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-secondary hover:text-primary disabled:opacity-30"
          >
            {t('pagination.next')}
          </button>
        </div>
      )}
    </div>
  );
}
