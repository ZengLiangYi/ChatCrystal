import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FolderGit2, Tag, Lightbulb, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDeleteNote, useNote } from '@/hooks/use-notes.ts';
import { DeleteNoteDialog } from '@/components/DeleteNoteDialog.tsx';
import { MarkdownRenderer } from '@/components/MarkdownRenderer.tsx';
import { RelatedNotes } from '@/components/RelatedNotes.tsx';
import { Button } from '@/components/ui/button.tsx';
import { createNoteMarkdownExport, downloadMarkdownFile } from '@/lib/markdown-export.ts';
import { notify } from '@/lib/notify.ts';

export function NoteDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { data: note, isLoading } = useNote(Number(id) || 0);
  const deleteNote = useDeleteNote();

  if (isLoading) {
    return <div className="p-6 text-muted">{t('status.loading')}</div>;
  }

  if (!note) {
    return <div className="p-6 text-error">{t('error.note_not_found')}</div>;
  }

  const conclusions = (note.key_conclusions as string[]) ?? [];
  const snippets = (note.code_snippets as { language: string; code: string; description: string }[]) ?? [];
  const tags = (note.tags as string[]) ?? [];
  const canOpenOriginalConversation = note.can_open_original_conversation === true;
  const handleExportMarkdown = () => {
    try {
      downloadMarkdownFile(createNoteMarkdownExport(note, {
        labels: {
          summary: t('note_detail.markdown_section.summary'),
          keyConclusions: t('note_detail.markdown_section.key_conclusions'),
          codeSnippets: t('note_detail.markdown_section.code_snippets'),
        },
      }));
    } catch {
      notify.error(t('note_detail.export_failed'));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-theme bg-secondary shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('note_detail.back_to_notes')}
          title={t('note_detail.back_to_notes')}
          onClick={() => navigate('/notes')}
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold truncate">{note.title as string}</h2>
          <div className="flex items-center gap-2 text-xs text-muted">
            <FolderGit2 size={11} />
            <span>{note.project_name as string}</span>
            {canOpenOriginalConversation && (
              <>
                <span className="opacity-30">·</span>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => navigate(`/conversations/${note.conversation_id}`)}
                  className="h-auto p-0 text-xs"
                >
                  {t('action.view_original_conversation')}
                </Button>
              </>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportMarkdown}
        >
          <Download data-icon="inline-start" />
          {t('note_detail.export_markdown')}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setIsDeleteDialogOpen(true)}
        >
          <Trash2 data-icon="inline-start" />
          {t('delete_note.delete')}
        </Button>
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

      {isDeleteDialogOpen && (
        <DeleteNoteDialog
          noteTitle={note.title as string}
          isPending={deleteNote.isPending}
          errorMessage={deleteNote.error instanceof Error ? deleteNote.error.message : undefined}
          onCancel={() => setIsDeleteDialogOpen(false)}
          onConfirm={(input) => {
            deleteNote.mutate(
              { id: note.id as number, ...input },
              { onSuccess: () => navigate('/notes') },
            );
          }}
        />
      )}
    </div>
  );
}
