import { NavLink } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  Import,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  RotateCw,
  Search,
  Settings,
  Square,
  XCircle,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useStatus } from '@/hooks/use-conversations.ts';
import { useSyncStatus } from '@/hooks/use-sync.ts';
import type { ImportProgress } from '@/lib/api.ts';
import { useCallback, useEffect, useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { to: '/conversations', icon: MessageSquare, labelKey: 'nav.conversations' },
  { to: '/notes', icon: FileText, labelKey: 'nav.notes' },
  { to: '/search', icon: Search, labelKey: 'nav.search' },
  { to: '/graph', icon: Network, labelKey: 'nav.graph' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Relative label for the last completed sync, using the existing time.* keys. */
function relativeTimeLabel(
  t: TFunction,
  timestamp: number | undefined,
  now: number,
): string | null {
  if (!timestamp) return null;
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE_MS) return t('time.just_now');
  if (diff < HOUR_MS) {
    return t('time.minutes_ago', { count: Math.floor(diff / MINUTE_MS) });
  }
  if (diff < DAY_MS) {
    return t('time.hours_ago', { count: Math.floor(diff / HOUR_MS) });
  }
  return t('time.days_ago', { count: Math.floor(diff / DAY_MS) });
}

/** Re-renders every `intervalMs` while active so relative time labels stay fresh. */
function useNow(active: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

const KNOWN_PHASES = new Set(['detecting', 'scanning', 'importing', 'done', 'error']);
const PHASE_ALIASES: Record<string, string> = {
  detect: 'detecting',
  detecting: 'detecting',
  scan: 'scanning',
  scanning: 'scanning',
  import: 'importing',
  importing: 'importing',
  done: 'done',
  complete: 'done',
  completed: 'done',
  error: 'error',
};

/** Human label for the sync stage: progress.phase, else the active source's phase. */
function phaseLabel(t: TFunction, progress: ImportProgress | undefined): string {
  const raw = (progress?.phase ?? '').trim().toLowerCase();
  const key = PHASE_ALIASES[raw];
  if (key && KNOWN_PHASES.has(key)) return t(`sync.phase.${key}`);
  const activeSource = progress?.sources?.find(
    (source) =>
      source.status === 'detecting' ||
      source.status === 'scanning' ||
      source.status === 'importing',
  );
  if (activeSource) return t(`sync.phase.${activeSource.status}`);
  return t('sync.phase.importing');
}

/**
 * Persistent sync status for the local mode: waiting / synced / syncing with
 * progress / cancelled / error with retry. Replaces the old one-shot import
 * button whose result auto-dismissed after five seconds.
 */
function SyncPanel() {
  const { t } = useTranslation();
  const {
    status,
    phase,
    isLoading,
    error,
    isUnavailable,
    isSyncing,
    isStarting,
    isCancelling,
    startSync,
    cancelSync,
    refresh,
  } = useSyncStatus();

  const progress = status?.progress;
  const completedAt = status?.lastCompletedAt ?? status?.finishedAt;
  const relative = relativeTimeLabel(
    t,
    completedAt,
    useNow(Boolean(completedAt) && !isSyncing),
  );

  if (isLoading && !status && !isUnavailable) {
    // Only the very first load shows the spinner; once the endpoint is known
    // to be unreachable the panel below stays put instead of flickering.
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" />
        {t('sync.checking')}
      </div>
    );
  }

  // The status endpoint itself is unreachable (e.g. an older server build).
  // Checked before the loading state so background retries do not make the
  // panel flash between "checking" and "unavailable".
  if (isUnavailable) {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--error)' }}>
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="break-words">{t('sync.unavailable')}</span>
        </p>
        {error && (
          <p className="break-words text-[11px] text-muted" title={error}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={refresh}
          className="cc-primary-action flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          <RotateCw size={14} />
          {t('sync.retry')}
        </button>
      </div>
    );
  }

  if (isSyncing) {
    const current = progress?.current ?? 0;
    const total = progress?.total ?? 0;
    const percent = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 text-xs text-primary">
            <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
            <span className="truncate">
              {t('sync.syncing')}
              {total > 0 ? ` ${t('sync.progress', { current, total })}` : ''}
            </span>
          </span>
          <button
            type="button"
            onClick={cancelSync}
            disabled={isCancelling}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-error disabled:opacity-50"
            title={t('sync.cancel')}
          >
            {isCancelling ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Square size={10} />
            )}
            {t('sync.cancel')}
          </button>
        </div>
        <div
          className="h-1 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--bg-tertiary)' }}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              total > 0 ? '' : 'animate-pulse'
            }`}
            style={{ width: `${total > 0 ? percent : 35}%`, background: 'var(--accent)' }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate">{phaseLabel(t, progress)}</span>
          <span className="shrink-0">
            {t('sync.progress_counts', {
              imported: progress?.imported ?? 0,
              skipped: progress?.skipped ?? 0,
            })}
          </span>
        </div>
        {error && (
          <p className="flex items-start gap-1.5 text-[11px]" style={{ color: 'var(--error)' }}>
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </p>
        )}
      </div>
    );
  }

  if (phase === 'error' || (error && phase !== 'cancelled')) {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-xs" style={{ color: 'var(--error)' }}>
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="break-words">{status?.error || error || t('sync.error')}</span>
        </p>
        <button
          type="button"
          onClick={() => startSync()}
          disabled={isStarting}
          className="cc-primary-action flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isStarting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCw size={14} />
          )}
          {t('sync.retry')}
        </button>
      </div>
    );
  }

  if (phase === 'cancelled') {
    const imported = status?.progress?.imported ?? status?.lastResult?.imported ?? 0;
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-xs text-secondary">
          <XCircle size={13} className="mt-0.5 shrink-0 text-muted" />
          <span className="break-words">
            {imported > 0
              ? t('sync.cancelled_with_progress', { imported })
              : t('sync.cancelled')}
          </span>
        </p>
        <button
          type="button"
          onClick={() => startSync()}
          disabled={isStarting}
          className="cc-primary-action flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isStarting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RotateCw size={14} />
          )}
          {t('sync.retry')}
        </button>
      </div>
    );
  }

  // idle → already synced once: "Synced · 2 minutes ago", click to sync again.
  if (completedAt) {
    return (
      <div>
        <button
          type="button"
          onClick={() => startSync()}
          disabled={isStarting}
          title={t('sync.click_to_start')}
          className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-secondary transition-colors hover:bg-tertiary hover:text-primary disabled:opacity-50"
        >
          {isStarting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <CheckCircle size={13} className="shrink-0" style={{ color: 'var(--success)' }} />
          )}
          <span className="truncate">
            {t('sync.last_synced', { time: relative ?? t('time.just_now') })}
          </span>
          <RefreshCw
            size={11}
            className="ml-auto shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
        {status?.lastResult && (
          <p className="mt-1 text-center text-[11px] text-muted">
            {t('sync.last_result', {
              imported: status.lastResult.imported,
              skipped: status.lastResult.skipped,
            })}
          </p>
        )}
      </div>
    );
  }

  // idle → never synced: waiting for the background pass (or start it manually).
  return (
    <div>
      <button
        type="button"
        onClick={() => startSync()}
        disabled={isStarting}
        className="cc-primary-action flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {isStarting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : status?.autoSyncEnabled ? (
          <Clock size={14} />
        ) : (
          <RefreshCw size={14} />
        )}
        {status?.autoSyncEnabled ? t('sync.waiting') : t('sync.start')}
      </button>
      <p className="mt-1.5 text-center text-[11px] text-muted">
        {status?.autoSyncEnabled ? t('sync.auto_enabled') : t('sync.manual_hint')}
      </p>
    </div>
  );
}

type SidebarProps = {
  showBrand?: boolean;
};

type CloudUploadState =
  | { status: 'idle' }
  | { status: 'running' }
  | {
      status: 'done';
      result: {
        scanned?: number;
        uploaded?: number;
        imported?: number;
        replaced?: number;
        skipped?: number;
        errors?: number;
      };
    }
  | { status: 'error'; error: string };

export function Sidebar({ showBrand = true }: SidebarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status } = useStatus();
  const [cloudUploadState, setCloudUploadState] = useState<CloudUploadState>({ status: 'idle' });
  const cloudMode = status?.cloudMode === true;
  const uploadLocalHistoryToCloud =
    typeof window !== 'undefined' ? window.chatcrystalElectronCloud?.uploadLocalHistory : undefined;
  const canUploadLocalHistoryToCloud = cloudMode && Boolean(uploadLocalHistoryToCloud);

  useEffect(() => {
    if (cloudUploadState.status === 'done' || cloudUploadState.status === 'error') {
      const timer = setTimeout(() => setCloudUploadState({ status: 'idle' }), 5000);
      return () => clearTimeout(timer);
    }
  }, [cloudUploadState.status]);

  const startCloudUpload = useCallback(async () => {
    if (!uploadLocalHistoryToCloud) return;
    setCloudUploadState({ status: 'running' });
    try {
      const result = await uploadLocalHistoryToCloud();
      setCloudUploadState({ status: 'done', result });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    } catch (error) {
      setCloudUploadState({
        status: 'error',
        error: error instanceof Error ? error.message : t('import.cloud_upload_error'),
      });
    }
  }, [queryClient, t, uploadLocalHistoryToCloud]);

  return (
    <aside
      className="cc-sidebar flex h-full w-56 shrink-0 flex-col border-r border-theme"
    >
      {/* Brand */}
      {showBrand && (
        <div className="px-4 py-4 border-b border-theme">
          <h1
            className="text-base font-bold text-accent m-0 flex items-center gap-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <img src="/icon.png" alt="" className="w-5 h-5" />
            {t('brand.name')}
          </h1>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-tertiary text-primary shadow-[inset_0_0_0_1px_var(--border)]'
                  : 'text-secondary hover:bg-tertiary hover:text-primary'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                    isActive ? 'text-accent' : 'text-muted group-hover:text-secondary'
                  }`}
                >
                  <Icon size={16} />
                </span>
                <span className="truncate">{t(labelKey)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Background sync status (local mode) */}
      {!cloudMode && (
        <div className="px-3 py-3 border-t border-theme">
          <SyncPanel />
        </div>
      )}
      {cloudMode && (
        <div className="px-3 py-3 border-t border-theme">
          <div className="rounded-md border border-theme bg-tertiary px-3 py-2 text-xs text-muted leading-relaxed">
            <div className="font-medium text-primary">{t('import.cloud_mode')}</div>
            <div className="mt-1">
              {canUploadLocalHistoryToCloud ? t('import.cloud_upload_hint') : t('import.cloud_import_hint')}
            </div>
            {canUploadLocalHistoryToCloud && (
              <button
                type="button"
                onClick={() => void startCloudUpload()}
                disabled={cloudUploadState.status === 'running'}
                className="cc-primary-action mt-2 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {cloudUploadState.status === 'running' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Import size={14} />
                )}
                {cloudUploadState.status === 'running'
                  ? t('import.cloud_uploading')
                  : t('import.cloud_upload_action')}
              </button>
            )}
            {cloudUploadState.status === 'done' && (
              <p className="mt-2 flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
                <CheckCircle size={12} />
                {t('import.cloud_upload_complete', {
                  uploaded: cloudUploadState.result.uploaded ?? 0,
                  imported: cloudUploadState.result.imported ?? 0,
                  replaced: cloudUploadState.result.replaced ?? 0,
                })}
              </p>
            )}
            {cloudUploadState.status === 'error' && (
              <p className="mt-2 flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--error)' }}>
                <XCircle size={12} />
                {cloudUploadState.error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stats footer */}
      {status && (
        <div className="space-y-2 border-t border-theme px-3 py-3 text-xs text-muted">
          <div className="flex justify-between">
            <span>{t('stat.conversations')}</span>
            <span className="rounded bg-tertiary px-1.5 py-0.5 text-primary">
              {status.stats.totalConversations}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span>{t('stat.notes')}</span>
            <span className="rounded bg-tertiary px-1.5 py-0.5 text-primary">{status.stats.totalNotes}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
