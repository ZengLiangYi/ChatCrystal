import { useNavigate } from 'react-router-dom';
import { MessageSquare, FileText, Tag, Sparkles, ArrowRight, Loader2, CheckCircle, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStatus } from '@/hooks/use-conversations.ts';
import { useSummarizeBatch, useCancelQueue } from '@/hooks/use-notes.ts';
import { useQueueTasks } from '@/hooks/use-queue.ts';

export function Dashboard() {
  const { t } = useTranslation();
  const { data: status, isLoading } = useStatus();
  const navigate = useNavigate();
  const summarizeBatch = useSummarizeBatch();
  const cancelQueue = useCancelQueue();
  const { data: queueData } = useQueueTasks();

  if (isLoading) {
    return <div className="p-6"><p className="text-muted">{t('status.loading')}</p></div>;
  }

  const stats = status?.stats;
  const recentNotes = (status as Record<string, unknown>)?.recentNotes as
    { id: number; title: string; project_name: string; created_at: string }[] | undefined;

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-6">{t('title.dashboard')}</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label={t('stat.total_conversations')}
          value={stats?.totalConversations ?? 0}
          icon={<MessageSquare size={16} />}
          onClick={() => navigate('/conversations')}
        />
        <StatCard
          label={t('stat.total_notes')}
          value={stats?.totalNotes ?? 0}
          icon={<FileText size={16} />}
          onClick={() => navigate('/notes')}
        />
        <StatCard
          label={t('stat.total_tags')}
          value={stats?.totalTags ?? 0}
          icon={<Tag size={16} />}
          onClick={() => navigate('/notes')}
        />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-6">
        <BatchSummarizeButton
          onBatch={() => summarizeBatch.mutate()}
          onCancel={() => cancelQueue.mutate()}
          isPending={summarizeBatch.isPending}
          queueData={queueData}
        />
      </div>

      {/* Recent notes */}
      {recentNotes && recentNotes.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-secondary uppercase tracking-wider">{t('section.recent_notes')}</h3>
            <button
              type="button"
              onClick={() => navigate('/notes')}
              className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
            >
              {t('action.view_all')} <ArrowRight size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {recentNotes.map((note) => (
              <div
                key={note.id}
                onClick={() => navigate(`/notes/${note.id}`)}
                className="flex items-center justify-between bg-secondary border border-theme p-3 hover:border-[var(--accent)] cursor-pointer transition-colors"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{note.title}</p>
                  <p className="text-xs text-muted mt-0.5">{note.project_name}</p>
                </div>
                <span className="text-xs text-muted shrink-0 ml-3">
                  {new Date(note.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {(!recentNotes || recentNotes.length === 0) && (
        <div className="bg-secondary border border-theme p-4" style={{ borderRadius: 'var(--radius)' }}>
          <h3 className="text-sm font-medium text-secondary mb-2">{t('section.quick_start')}</h3>
          <ul className="text-sm text-secondary space-y-2">
            <li>{t('guide.step1')}</li>
            <li>{t('guide.step2')}</li>
            <li>{t('guide.step3')}</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function BatchSummarizeButton({
  onBatch, onCancel, isPending, queueData,
}: {
  onBatch: () => void;
  onCancel: () => void;
  isPending: boolean;
  queueData?: { total: number; completed: number; failed: number; active: number };
}) {
  const { t } = useTranslation();
  const isActive = (queueData?.active ?? 0) > 0;
  const total = queueData?.total ?? 0;
  const completed = queueData?.completed ?? 0;
  const failed = queueData?.failed ?? 0;
  const isDone = total > 0 && !isActive;

  if (isPending) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-2 px-4 py-2 text-sm border transition-colors"
        style={{ borderRadius: 'var(--radius)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
      >
        <Loader2 size={14} className="animate-spin" />
        {t('status.submitting')}
      </button>
    );
  }

  if (isActive) {
    const progress = total > 0 ? (completed / total) * 100 : 0;
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled
          className="flex items-center gap-2 px-4 py-2 text-sm border transition-colors"
          style={{ borderRadius: 'var(--radius)', color: 'var(--accent)', borderColor: 'var(--accent)' }}
        >
          <Loader2 size={14} className="animate-spin" />
          {t('status.generating_with_count', { completed, total })}
        </button>
        <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-theme hover:border-[var(--error)] transition-colors"
          style={{ borderRadius: 'var(--radius)', color: 'var(--error)' }}
        >
          <Square size={12} />
          {t('action.cancel')}
        </button>
      </div>
    );
  }

  if (isDone) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-2 px-4 py-2 text-sm border border-theme"
        style={{ borderRadius: 'var(--radius)', color: 'var(--success)' }}
      >
        <CheckCircle size={14} />
        {t('status.completed_with_count', { completed, total })}{failed > 0 ? t('status.failed_count', { failed }) : ''}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onBatch}
      className="flex items-center gap-2 px-4 py-2 text-sm border border-theme hover:border-[var(--accent)] transition-colors"
      style={{ borderRadius: 'var(--radius)', color: 'var(--accent)' }}
    >
      <Sparkles size={14} />
      {t('action.batch_generate')}
    </button>
  );
}

function StatCard({
  label, value, icon, onClick,
}: {
  label: string; value: number; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="bg-secondary border border-theme p-4 hover:border-[var(--accent)] cursor-pointer transition-colors"
      style={{ borderRadius: 'var(--radius)' }}
    >
      <div className="flex items-center gap-2 text-muted mb-1">
        {icon}
        <p className="text-xs uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl font-bold text-accent" style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </p>
    </div>
  );
}
