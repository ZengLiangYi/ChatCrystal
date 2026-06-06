import { useEffect, useState } from 'react';
import { Download, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DISMISSED_KEY = 'chatcrystal-star-dismissed';
const GITHUB_URL = 'https://github.com/ZengLiangYi/ChatCrystal';
const AUTO_UPDATE_CHECK_DELAY_MS = 60_000;

export function StarBanner() {
  const { t } = useTranslation();
  const updates = window.electronAPI?.updates;
  const [updateResult, setUpdateResult] = useState<ChatCrystalUpdateCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1'
  );

  useEffect(() => {
    if (!updates) return;
    const timer = window.setTimeout(() => {
      updates.check({ manual: false }).then((result) => {
        if (result.status === 'available') {
          setUpdateResult(result);
        }
      }).catch(() => {
        // Automatic update checks stay quiet by design.
      });
    }, AUTO_UPDATE_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [updates]);

  if (updateResult?.status === 'available') {
    const openRelease = () => {
      void updates?.openReleasePage(updateResult.releaseUrl);
    };
    return (
      <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-theme" style={{ background: 'var(--bg-secondary)' }}>
        <div className="flex min-w-0 items-center gap-2">
          <Download size={12} className="shrink-0 text-accent" />
          <span className="truncate text-secondary">
            {t('update.available_banner', { version: updateResult.latestVersion })}
          </span>
          <button
            type="button"
            onClick={openRelease}
            className="shrink-0 text-accent hover:underline"
          >
            {t('update.open_releases')}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void updates?.remindLater(updateResult.latestVersion);
              setUpdateResult(null);
            }}
            className="text-muted hover:text-secondary transition-colors"
          >
            {t('update.remind_later')}
          </button>
          <button
            type="button"
            onClick={() => {
              void updates?.skipVersion(updateResult.latestVersion);
              setUpdateResult(null);
            }}
            className="text-muted hover:text-secondary transition-colors"
            aria-label={t('update.skip_version')}
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-theme" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex items-center gap-2">
        <Star size={12} className="text-accent" />
        <span className="text-secondary">{t('star.message')}</span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          Star on GitHub
        </a>
      </div>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, '1');
          setDismissed(true);
        }}
        className="text-muted hover:text-secondary transition-colors"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}
