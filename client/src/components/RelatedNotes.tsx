import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Sparkles, X, Plus, ChevronDown, Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNoteRelations, useDeleteRelation, useDiscoverRelations, useCreateRelation } from '@/hooks/use-relations.ts';
import { api } from '@/lib/api.ts';

// Relation type display config
const RELATION_CONFIG: Record<string, { label_zh: string; label_en: string; color: string }> = {
  CAUSED_BY:   { label_zh: '由此引起', label_en: 'Caused by',   color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  LEADS_TO:    { label_zh: '导致',     label_en: 'Leads to',    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  RESOLVED_BY: { label_zh: '被解决',   label_en: 'Resolved by', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  SIMILAR_TO:  { label_zh: '相似',     label_en: 'Similar to',  color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  CONTRADICTS: { label_zh: '矛盾',     label_en: 'Contradicts', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  DEPENDS_ON:  { label_zh: '依赖',     label_en: 'Depends on',  color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  EXTENDS:     { label_zh: '扩展',     label_en: 'Extends',     color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
  REFERENCES:  { label_zh: '引用',     label_en: 'References',  color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
};

const INVERSE_LABELS: Record<string, { zh: string; en: string }> = {
  CAUSED_BY:   { zh: '引起了',   en: 'Caused' },
  LEADS_TO:    { zh: '由此导致', en: 'Led from' },
  RESOLVED_BY: { zh: '解决了',   en: 'Resolved' },
  SIMILAR_TO:  { zh: '相似',     en: 'Similar to' },
  CONTRADICTS: { zh: '矛盾',     en: 'Contradicts' },
  DEPENDS_ON:  { zh: '被依赖',   en: 'Depended by' },
  EXTENDS:     { zh: '被扩展',   en: 'Extended by' },
  REFERENCES:  { zh: '被引用',   en: 'Referenced by' },
};

const RELATION_TYPES = Object.keys(RELATION_CONFIG);

// =============================================
// Note Search Combobox
// =============================================

interface NoteOption {
  id: number;
  title: string;
  project_name?: string;
}

function NoteSearchInput({
  excludeId,
  value,
  onChange,
  isZh,
}: {
  excludeId: number;
  value: NoteOption | null;
  onChange: (note: NoteOption | null) => void;
  isZh: boolean;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<NoteOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const search = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!q.trim()) {
        setOptions([]);
        setIsOpen(false);
        return;
      }
      setIsSearching(true);
      debounceRef.current = setTimeout(async () => {
        try {
          const result = await api.getNotes({ search: q, limit: 10 });
          const filtered = (result.items as unknown as NoteOption[]).filter((n) => n.id !== excludeId);
          setOptions(filtered);
          setIsOpen(filtered.length > 0);
        } catch {
          setOptions([]);
        } finally {
          setIsSearching(false);
        }
      }, 300);
    },
    [excludeId],
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (value) {
    return (
      <div className="flex-1 flex items-center gap-1 px-2 py-1 bg-primary border border-theme text-xs" style={{ borderRadius: '4px' }}>
        <span className="flex-1 truncate text-primary">{value.title}</span>
        <button
          type="button"
          onClick={() => { onChange(null); setQuery(''); }}
          className="shrink-0 text-muted hover:text-red-400"
        >
          <X size={10} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 relative">
      <div className="relative">
        <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder={isZh ? '搜索笔记标题...' : 'Search notes...'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            search(e.target.value);
          }}
          onFocus={() => { if (options.length > 0) setIsOpen(true); }}
          className="w-full pl-6 pr-2 py-1 bg-primary border border-theme text-primary text-xs"
          style={{ borderRadius: '4px' }}
        />
        {isSearching && (
          <Loader2 size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted animate-spin" />
        )}
      </div>
      {isOpen && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 bg-primary border border-theme overflow-hidden max-h-[180px] overflow-y-auto"
          style={{ borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
        >
          {options.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => {
                onChange(note);
                setIsOpen(false);
                setQuery('');
              }}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-tertiary transition-colors"
            >
              <div className="truncate text-primary">{note.title}</div>
              {note.project_name && (
                <div className="text-[10px] text-muted truncate">{note.project_name}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================
// Main Component
// =============================================

interface RelatedNotesProps {
  noteId: number;
}

export function RelatedNotes({ noteId }: RelatedNotesProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isZh = i18n.language?.startsWith('zh');

  const { data: relations, isLoading } = useNoteRelations(noteId);
  const deleteMutation = useDeleteRelation(noteId);
  const discoverMutation = useDiscoverRelations(noteId);
  const createMutation = useCreateRelation(noteId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedNote, setSelectedNote] = useState<NoteOption | null>(null);
  const [relationType, setRelationType] = useState('SIMILAR_TO');
  const [description, setDescription] = useState('');

  if (isLoading) return null;

  const relationList = relations ?? [];

  function getRelationLabel(relType: string, isInverse: boolean) {
    if (isInverse) {
      const inv = INVERSE_LABELS[relType];
      return inv ? (isZh ? inv.zh : inv.en) : relType;
    }
    const cfg = RELATION_CONFIG[relType];
    return cfg ? (isZh ? cfg.label_zh : cfg.label_en) : relType;
  }

  function handleAdd() {
    if (!selectedNote) return;
    createMutation.mutate(
      {
        target_note_id: selectedNote.id,
        relation_type: relationType,
        description: description || undefined,
      },
      {
        onSuccess: () => {
          setShowAddForm(false);
          setSelectedNote(null);
          setRelationType('SIMILAR_TO');
          setDescription('');
        },
      },
    );
  }

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
          <Network size={12} />
          {isZh ? '相关笔记' : 'Related Notes'}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted hover:text-accent transition-colors disabled:opacity-50"
            title={isZh ? 'AI 发现关联' : 'AI Discover'}
          >
            {discoverMutation.isPending ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Sparkles size={11} />
            )}
            {isZh ? '发现' : 'Discover'}
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted hover:text-accent transition-colors"
          >
            <Plus size={11} />
            {isZh ? '添加' : 'Add'}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="mb-3 p-3 bg-tertiary border border-theme text-sm space-y-2" style={{ borderRadius: '6px' }}>
          <div className="flex gap-2">
            <NoteSearchInput
              excludeId={noteId}
              value={selectedNote}
              onChange={setSelectedNote}
              isZh={!!isZh}
            />
            <div className="relative">
              <select
                value={relationType}
                onChange={(e) => setRelationType(e.target.value)}
                className="appearance-none px-2 py-1 pr-6 bg-primary border border-theme text-primary text-xs"
                style={{ borderRadius: '4px' }}
              >
                {RELATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {getRelationLabel(type, false)}
                  </option>
                ))}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            </div>
          </div>
          <input
            type="text"
            placeholder={isZh ? '描述（可选）' : 'Description (optional)'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-2 py-1 bg-primary border border-theme text-primary text-xs"
            style={{ borderRadius: '4px' }}
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setSelectedNote(null); }}
              className="px-2 py-0.5 text-xs text-muted hover:text-primary transition-colors"
            >
              {t('action.cancel')}
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!selectedNote || createMutation.isPending}
              className="px-2 py-0.5 text-xs bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-colors disabled:opacity-50"
              style={{ borderRadius: '4px' }}
            >
              {createMutation.isPending ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                t('action.confirm')
              )}
            </button>
          </div>
        </div>
      )}

      {/* Relations list */}
      {relationList.length === 0 ? (
        <p className="text-xs text-muted opacity-60">
          {isZh ? '暂无关联笔记，点击「发现」让 AI 自动分析' : 'No related notes yet. Click "Discover" to analyze.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {relationList.map((rel) => {
            const isSource = rel.source_note_id === noteId;
            const linkedNoteId = isSource ? rel.target_note_id : rel.source_note_id;
            const linkedTitle = isSource ? rel.target_title : rel.source_title;
            const config = RELATION_CONFIG[rel.relation_type] || RELATION_CONFIG.REFERENCES;

            return (
              <div
                key={rel.id}
                className="flex items-center gap-2 px-2.5 py-1.5 bg-secondary border border-theme hover:border-accent/30 transition-colors group"
                style={{ borderRadius: '6px' }}
              >
                <span
                  className={`shrink-0 px-1.5 py-0.5 text-[10px] font-medium border ${config.color}`}
                  style={{ borderRadius: '3px' }}
                >
                  {getRelationLabel(rel.relation_type, !isSource)}
                </span>
                <button
                  type="button"
                  onClick={() => navigate(`/notes/${linkedNoteId}`)}
                  className="flex-1 text-xs text-secondary hover:text-accent transition-colors truncate text-left"
                >
                  {linkedTitle}
                </button>
                {rel.description && (
                  <span className="shrink-0 text-[10px] text-muted opacity-60 max-w-[120px] truncate">
                    {rel.description}
                  </span>
                )}
                {rel.created_by === 'llm' && (
                  <span className="shrink-0 text-[10px] text-muted opacity-40">
                    {Math.round((rel.confidence as number) * 100)}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(rel.id)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
