import { useState } from 'react';
import { Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DISMISSED_KEY = 'chatcrystal-star-dismissed';
const GITHUB_URL = 'https://github.com/ZengLiangYi/ChatCrystal';

export function StarBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1'
  );

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
