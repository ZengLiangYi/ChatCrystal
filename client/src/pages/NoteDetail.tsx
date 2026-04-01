import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FolderGit2, Tag, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNote } from '@/hooks/use-notes.ts';
import { MarkdownRenderer } from '@/components/MarkdownRenderer.tsx';
import { RelatedNotes } from '@/components/RelatedNotes.tsx';

export function NoteDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: note, isLoading } = useNote(Number(id) || 0);

  if (isLoading) {
    return <div className="p-6 text-muted">{t('status.loading')}</div>;
  }

  if (!note) {
    return <div className="p-6 text-error">{t('error.note_not_found')}</div>;
  }

  const conclusions = (note.key_conclusions as string[]) ?? [];
  const snippets = (note.code_snippets as { language: string; code: string; description: string }[]) ?? [];
  const tags = (note.tags as string[]) ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-theme bg-secondary shrink-0">
        <button
          type="button"
          onClick={() => navigate('/notes')}
          className="text-muted hover:text-primary"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold truncate">{note.title as string}</h2>
          <div className="flex items-center gap-2 text-xs text-muted">
            <FolderGit2 size={11} />
            <span>{note.project_name as string}</span>
            <span className="opacity-30">·</span>
            <button
              type="button"
              onClick={() => navigate(`/conversations/${note.conversation_id}`)}
              className="hover:text-accent transition-colors"
            >
              {t('action.view_original_conversation')}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {tags.map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-xs bg-tertiary text-muted border border-theme"
                style={{ borderRadius: '999px' }}
              >
                <Tag size={9} className="inline mr-0.5 -mt-px" />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Summary */}
        <section className="mb-6">
          <MarkdownRenderer content={note.summary as string} className="markdown-content text-sm leading-relaxed" />
        </section>

        {/* Key conclusions */}
        {conclusions.length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Lightbulb size={12} />
              {t('key_conclusions')}
            </h3>
            <ul className="space-y-1.5">
              {conclusions.map((c, i) => (
                <li key={i} className="flex gap-2 text-sm text-secondary">
                  <span className="text-accent shrink-0">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Code snippets */}
        {snippets.length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2">{t('code_snippets')}</h3>
            <div className="space-y-3">
              {snippets.map((s, i) => (
                <div key={i}>
                  <p className="text-xs text-muted mb-1">{s.description}</p>
                  <MarkdownRenderer
                    content={`\`\`\`${s.language}\n${s.code}\n\`\`\``}
                    className="markdown-content"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Related notes */}
        <RelatedNotes noteId={note.id as number} />
      </div>
    </div>
  );
}
