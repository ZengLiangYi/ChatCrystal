import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { useQueueTasks } from '@/hooks/use-queue.ts';
import { ActivityPanel } from './ActivityPanel.tsx';

export function StatusBar() {
  const { data } = useQueueTasks();
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [doneMessage, setDoneMessage] = useState(false);

  const total = data?.total ?? 0;
  const completed = data?.completed ?? 0;
  const failed = data?.failed ?? 0;
  const active = data?.active ?? 0;
  const isRunning = active > 0;
  const isDone = total > 0 && active === 0;
  const hasFailed = failed > 0;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  useEffect(() => {
    if (isRunning) {
      setVisible(true);
      setDoneMessage(false);
    } else if (isDone && total > 0) {
      setDoneMessage(true);
      if (!hasFailed) {
        const timer = setTimeout(() => setVisible(false), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isRunning, isDone, total, hasFailed]);

  if (!visible && !isRunning) return null;

  return (
    <>
      {expanded && data && <ActivityPanel tasks={data.tasks} onClose={() => setExpanded(false)} />}
      <div
        className="shrink-0 border-t border-theme bg-secondary px-4 py-1.5 flex items-center gap-3 text-xs cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status icon */}
        {isRunning && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />}
        {doneMessage && !hasFailed && <CheckCircle size={12} style={{ color: 'var(--success)' }} />}
        {doneMessage && hasFailed && <AlertTriangle size={12} style={{ color: 'var(--error)' }} />}

        {/* Status text */}
        <span className="text-secondary">
          {isRunning && `摘要生成中 ${completed}/${total}`}
          {doneMessage && !hasFailed && `全部完成 ${completed}/${total}`}
          {doneMessage && hasFailed && `完成 ${completed}/${total} · ${failed} 个失败`}
        </span>

        {/* Progress bar */}
        {isRunning && (
          <div className="flex-1 max-w-48 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'var(--accent)' }}
            />
          </div>
        )}

        <div className="ml-auto">
          {expanded ? <ChevronDown size={12} className="text-muted" /> : <ChevronUp size={12} className="text-muted" />}
        </div>
      </div>
    </>
  );
}
