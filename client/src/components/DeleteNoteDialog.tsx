import { useState, type FormEvent } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { ExperienceReviewReason } from '@chatcrystal/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';

const REASONS: ExperienceReviewReason[] = [
  'not-experience',
  'low-value',
  'inaccurate',
  'duplicate',
  'other',
];

interface DeleteNoteDialogProps {
  noteTitle: string;
  isPending?: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onConfirm: (input: { reason: ExperienceReviewReason; comment?: string }) => void;
}

export function DeleteNoteDialog({
  noteTitle,
  isPending = false,
  errorMessage,
  onCancel,
  onConfirm,
}: DeleteNoteDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ExperienceReviewReason | ''>('');
  const [comment, setComment] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason || isPending) return;

    const trimmedComment = comment.trim();
    onConfirm({
      reason,
      comment: trimmedComment || undefined,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onCancel();
      }}
    >
      <DialogContent
        className="max-w-lg border-border bg-popover p-5"
        closeLabel={t('action.close')}
        showCloseButton={!isPending}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader className="flex-row items-start gap-3">
            <AlertTriangle
              data-icon="inline-start"
              className="mt-0.5 shrink-0 text-warning"
            />
            <div className="min-w-0">
              <DialogTitle className="mb-1 text-sm font-bold">
                {t('delete_note.title')}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed text-secondary">
                {t('delete_note.description', { title: noteTitle })}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted">{t('delete_note.reason_required')}</p>
            <RadioGroup
              value={reason}
              onValueChange={(value) => setReason(value as ExperienceReviewReason)}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {REASONS.map((item) => (
                <label
                  key={item}
                  htmlFor={`delete-note-reason-${item}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors',
                    reason === item
                      ? 'border-[var(--warning)] text-primary'
                      : 'border-border text-secondary hover:border-ring hover:text-primary',
                  )}
                >
                  <RadioGroupItem
                    id={`delete-note-reason-${item}`}
                    value={item}
                    className="data-checked:border-[var(--warning)] data-checked:bg-[var(--warning)]"
                  />
                  <span>{t(`delete_note.reason.${item}`)}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <label htmlFor="delete-note-comment" className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted">{t('delete_note.comment_optional')}</span>
            <Textarea
              id="delete-note-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              className="resize-none bg-tertiary"
              placeholder={t('delete_note.comment_placeholder')}
            />
          </label>

          {errorMessage && (
            <p className="text-xs text-error">{errorMessage}</p>
          )}

          <DialogFooter className="-mx-5 -mb-5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isPending}
            >
              {t('action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!reason || isPending}
              className="border-[var(--warning)] text-warning hover:bg-muted"
            >
              <Trash2 data-icon="inline-start" />
              {isPending ? t('delete_note.deleting') : t('delete_note.delete')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
