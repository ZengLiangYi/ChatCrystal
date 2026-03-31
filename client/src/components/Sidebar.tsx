import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  FileText,
  Search,
  Settings,
  Import,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useImport, useStatus } from '@/hooks/use-conversations.ts';

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { to: '/conversations', icon: MessageSquare, labelKey: 'nav.conversations' },
  { to: '/notes', icon: FileText, labelKey: 'nav.notes' },
  { to: '/search', icon: Search, labelKey: 'nav.search' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
] as const;

export function Sidebar() {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  const importMutation = useImport();

  return (
    <aside
      className="flex flex-col w-52 shrink-0 border-r border-theme bg-secondary"
      style={{ minHeight: '100vh' }}
    >
      {/* Brand */}
      <div className="px-4 py-4 border-b border-theme">
        <h1
          className="text-base font-bold tracking-tight text-accent m-0 flex items-center gap-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          <img src="/icon.png" alt="ChatCrystal" className="w-5 h-5" />
          {t('brand.name')}
        </h1>
        <p className="text-xs text-muted mt-1">{t('brand.tagline')}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {navItems.map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'text-accent bg-tertiary border-r-2'
                  : 'text-secondary hover:text-primary hover:bg-tertiary'
              }`
            }
            style={({ isActive }) =>
              isActive ? { borderRightColor: 'var(--accent)' } : undefined
            }
          >
            <Icon size={16} />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>

      {/* Import button */}
      <div className="px-3 py-3 border-t border-theme">
        <button
          type="button"
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          className="flex items-center justify-center gap-2 w-full px-3 py-2 text-sm rounded transition-colors accent-bg hover:opacity-90 disabled:opacity-50"
          style={{
            color: 'var(--bg-primary)',
            borderRadius: 'var(--radius)',
          }}
        >
          {importMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Import size={14} />
          )}
          {importMutation.isPending ? t('status.importing') : t('action.import_conversations')}
        </button>
        {importMutation.data && (
          <p className="text-xs text-muted mt-2 text-center">
            {t('import_success', { count: importMutation.data.imported })}
          </p>
        )}
      </div>

      {/* Stats footer */}
      {status && (
        <div className="px-4 py-3 border-t border-theme text-xs text-muted">
          <div className="flex justify-between">
            <span>{t('stat.conversations')}</span>
            <span className="text-primary">
              {status.stats.totalConversations}
            </span>
          </div>
          <div className="flex justify-between mt-1">
            <span>{t('stat.notes')}</span>
            <span className="text-primary">{status.stats.totalNotes}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
