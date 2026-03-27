import { useNavigate } from 'react-router-dom';
import { MessageSquare, FileText, Tag, Sparkles, ArrowRight, Loader2, CheckCircle, Square } from 'lucide-react';
import { useStatus } from '@/hooks/use-conversations.ts';
import { useSummarizeBatch, useCancelQueue } from '@/hooks/use-notes.ts';
import { useQueueTasks } from '@/hooks/use-queue.ts';

export function Dashboard() {
  const { data: status, isLoading } = useStatus();
  const navigate = useNavigate();
  const summarizeBatch = useSummarizeBatch();
  const cancelQueue = useCancelQueue();
  const { data: queueData } = useQueueTasks();

  if (isLoading) {
    return <div className="p-6"><p className="text-muted">加载中...</p></div>;
  }

  const stats = status?.stats;
  const recentNotes = (status as Record<string, unknown>)?.recentNotes as
    { id: number; title: string; project_name: string; created_at: string }[] | undefined;

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-6">Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label="对话总数"
          value={stats?.totalConversations ?? 0}
          icon={<MessageSquare size={16} />}
          onClick={() => navigate('/conversations')}
        />
        <StatCard
          label="笔记总数"
          value={stats?.totalNotes ?? 0}
          icon={<FileText size={16} />}
          onClick={() => navigate('/notes')}
        />
        <StatCard
          label="标签总数"
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
            <h3 className="text-sm font-medium text-secondary uppercase tracking-wider">最近笔记</h3>
            <button
              type="button"
              onClick={() => navigate('/notes')}
              className="flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors"
            >
              查看全部 <ArrowRight size={12} />
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
                  {new Date(note.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {(!recentNotes || recentNotes.length === 0) && (
        <div className="bg-secondary border border-theme p-4" style={{ borderRadius: 'var(--radius)' }}>
          <h3 className="text-sm font-medium text-secondary mb-2">快速开始</h3>
          <ul className="text-sm text-secondary space-y-2">
            <li>1. 点击左侧「导入对话」扫描 Claude Code 对话</li>
            <li>2. 前往「对话」页浏览对话，点击「生成摘要」提炼笔记</li>
            <li>3. 在「搜索」页通过语义搜索查找知识</li>
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
        提交中...
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
          生成中 {completed}/{total}
        </button>
        <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-theme hover:border-[var(--error)] transition-colors"
          style={{ borderRadius: 'var(--radius)', color: 'var(--error)' }}
          title="取消排队中的任务"
        >
          <Square size={12} />
          取消
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
        完成 {completed}/{total}{failed > 0 ? ` · ${failed} 失败` : ''}
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
      批量生成摘要
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
