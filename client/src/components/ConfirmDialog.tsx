import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  title: string;
  warnings: string[];
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  warnings,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
    >
      <div
        className="bg-secondary border border-theme p-5 w-full max-w-md mx-4"
        style={{ borderRadius: 'var(--radius)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle size={20} style={{ color: 'var(--warning)', marginTop: 2 }} className="shrink-0" />
          <div>
            <h3 className="text-sm font-bold mb-2">{title}</h3>
            <ul className="space-y-1.5">
              {warnings.map((w, i) => (
                <li key={i} className="text-xs text-secondary">{w}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-muted border border-theme hover:text-primary transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {t('action.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs font-medium border transition-colors"
            style={{ borderRadius: 'var(--radius)', color: 'var(--warning)', borderColor: 'var(--warning)' }}
          >
            {confirmLabel ?? t('action.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
