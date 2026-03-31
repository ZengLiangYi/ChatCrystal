import { X, CheckCircle, Loader2, Clock, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskEntry } from '@/hooks/use-queue.ts';

interface ActivityPanelProps {
  tasks: TaskEntry[];
  onClose: () => void;
}

export function ActivityPanel({ tasks, onClose }: ActivityPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className="shrink-0 border-t border-theme bg-secondary overflow-auto"
      style={{ maxHeight: '240px' }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-theme">
        <span className="text-xs font-medium text-muted uppercase tracking-wider">{t('section.task_queue')}</span>
        <button type="button" onClick={onClose} className="text-muted hover:text-primary">
          <X size={14} />
        </button>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {tasks.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted">{t('empty_state.no_tasks')}</div>
        )}
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 px-4 py-2">
            <TaskStatusIcon status={task.status} />
            <span className="flex-1 text-xs text-secondary truncate">{task.title}</span>
            <span className="text-xs text-muted font-mono shrink-0">
              {task.status === 'completed' && task.startedAt && task.finishedAt
                ? `${Math.round((task.finishedAt - task.startedAt) / 1000)}s`
                : task.status === 'processing'
                  ? t('status.processing')
                  : task.status === 'queued'
                    ? t('status.queued')
                    : ''}
            </span>
            {task.status === 'failed' && task.error && (
              <span className="text-xs text-error truncate max-w-32" title={task.error}>
                {task.error.slice(0, 30)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: TaskEntry['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={12} style={{ color: 'var(--success)' }} />;
    case 'processing':
      return <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />;
    case 'queued':
      return <Clock size={12} style={{ color: 'var(--text-muted)' }} />;
    case 'failed':
      return <AlertCircle size={12} style={{ color: 'var(--error)' }} />;
  }
}
