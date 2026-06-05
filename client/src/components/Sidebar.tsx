import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  Search,
  Network,
  Settings,
  Import,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useStatus } from '@/hooks/use-conversations.ts';
import { useImportStream } from '@/hooks/use-import-stream.ts';
import { useCallback, useEffect, useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { to: '/conversations', icon: MessageSquare, labelKey: 'nav.conversations' },
  { to: '/notes', icon: FileText, labelKey: 'nav.notes' },
  { to: '/search', icon: Search, labelKey: 'nav.search' },
  { to: '/graph', icon: Network, labelKey: 'nav.graph' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
] as const;

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
  const { state: importState, start: startImport, reset: resetImport } = useImportStream();
  const [cloudUploadState, setCloudUploadState] = useState<CloudUploadState>({ status: 'idle' });
  const cloudMode = status?.cloudMode === true;
  const uploadLocalHistoryToCloud =
    typeof window !== 'undefined' ? window.chatcrystalElectronCloud?.uploadLocalHistory : undefined;
  const canUploadLocalHistoryToCloud = cloudMode && Boolean(uploadLocalHistoryToCloud);

  // Auto-dismiss done/error state after 5 seconds
  useEffect(() => {
    if (importState.status === 'done' || importState.status === 'error') {
      const timer = setTimeout(resetImport, 5000);
      return () => clearTimeout(timer);
    }
  }, [importState.status, resetImport]);

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

      {/* Import */}
      {!cloudMode && (
        <div className="px-3 py-3 border-t border-theme">
        <button
          type="button"
          onClick={startImport}
          disabled={importState.status === 'running'}
          className="cc-primary-action flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {importState.status === 'running' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Import size={14} />
          )}
          {importState.status === 'running'
            ? importState.progress
              ? `${t('status.importing')} ${importState.progress.current}/${importState.progress.total}`
              : t('status.scanning')
            : t('action.import_conversations')}
        </button>

        {/* Progress details */}
        {importState.status === 'running' && importState.progress && (
          <div className="mt-2 space-y-1">
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${importState.progress.total > 0 ? (importState.progress.current / importState.progress.total) * 100 : 0}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
            <p className="text-xs text-muted text-center">
              {t('import.imported')}: {importState.progress.imported} · {t('import.skipped')}: {importState.progress.skipped}
            </p>
          </div>
        )}

        {/* Done */}
        {importState.status === 'done' && (
          <p className="flex items-center justify-center gap-1 text-xs mt-2" style={{ color: 'var(--success)' }}>
            <CheckCircle size={12} />
            {t('import.complete', { imported: importState.result.imported, total: importState.result.total })}
          </p>
        )}

        {/* Error */}
        {importState.status === 'error' && (
          <p className="flex items-center justify-center gap-1 text-xs mt-2" style={{ color: 'var(--error)' }}>
            <XCircle size={12} />
            {importState.error}
          </p>
        )}
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
