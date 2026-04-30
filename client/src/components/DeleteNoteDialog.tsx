import { useState, type FormEvent } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { ExperienceReviewReason } from '@chatcrystal/shared';

const REASONS: { value: ExperienceReviewReason; label: string }[] = [
  { value: 'not-experience', label: '不是可复用经验' },
  { value: 'low-value', label: '价值较低' },
  { value: 'inaccurate', label: '内容不准确' },
  { value: 'duplicate', label: '重复笔记' },
  { value: 'other', label: '其他原因' },
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
    >
      <form
        className="bg-secondary border border-theme w-full max-w-lg p-5"
        style={{ borderRadius: 'var(--radius)' }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={20} style={{ color: 'var(--warning)', marginTop: 2 }} className="shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold mb-1">删除笔记并记录反馈</h3>
            <p className="text-xs text-secondary leading-relaxed">
              将删除笔记“{noteTitle}”，把原始对话标记为已过滤，并记录一次 false accept 反馈用于后续审查。
            </p>
          </div>
        </div>

        <fieldset className="mb-4">
          <legend className="text-xs font-medium text-muted mb-2">删除原因（必选）</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {REASONS.map((item) => (
              <label
                key={item.value}
                className={`flex items-center gap-2 px-3 py-2 text-xs border cursor-pointer transition-colors ${
                  reason === item.value
                    ? 'border-[var(--warning)] text-primary'
                    : 'border-theme text-secondary hover:text-primary hover:border-[var(--accent)]'
                }`}
                style={{ borderRadius: 'var(--radius)' }}
              >
                <input
                  type="radio"
                  name="delete-note-reason"
                  value={item.value}
                  checked={reason === item.value}
                  onChange={() => setReason(item.value)}
                  className="accent-[var(--warning)]"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-muted mb-2">补充说明（可选）</span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            className="w-full bg-tertiary border border-theme px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-[var(--accent)] resize-none"
            style={{ borderRadius: 'var(--radius)' }}
            placeholder="例如：结论不成立、上下文不足或已经有更好的笔记。"
          />
        </label>

        {errorMessage && (
          <p className="mb-3 text-xs text-error">{errorMessage}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-4 py-1.5 text-xs text-muted border border-theme hover:text-primary transition-colors disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!reason || isPending}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 'var(--radius)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
          >
            <Trash2 size={12} />
            {isPending ? '删除中...' : '删除笔记'}
          </button>
        </div>
      </form>
    </div>
  );
}
