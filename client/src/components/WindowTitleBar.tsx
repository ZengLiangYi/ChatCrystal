import { useEffect, useState } from 'react';
import { Minus, PanelTopOpen, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function WindowTitleBar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const controls = window.electronAPI?.windowControls;

  useEffect(() => {
    let mounted = true;
    controls?.isMaximized().then((value) => {
      if (mounted) setIsMaximized(value);
    });
    const unsubscribe = controls?.onMaximizedChange((value) => {
      setIsMaximized(value);
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [controls]);

  return (
    <header className="app-titlebar flex h-11 shrink-0 items-center border-b border-theme">
      <div className="app-drag-region flex h-full min-w-0 flex-1 items-center">
        <div className="flex h-full w-56 shrink-0 items-center gap-2 border-r border-theme px-3">
          <img src="/icon.png" alt="" className="h-5 w-5" />
          <div className="min-w-0 truncate text-[13px] font-semibold text-primary">
            {t('brand.name')}
          </div>
        </div>
      </div>

      {controls && (
        <div className="app-no-drag flex h-full shrink-0 items-center">
          <button
            type="button"
            className="window-control-button"
            title={t('window.minimize')}
            aria-label={t('window.minimize')}
            onClick={() => void controls.minimize()}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="window-control-button"
            title={isMaximized ? t('window.restore') : t('window.maximize')}
            aria-label={isMaximized ? t('window.restore') : t('window.maximize')}
            onClick={() => void controls.toggleMaximize()}
          >
            {isMaximized ? <PanelTopOpen size={14} /> : <Square size={13} />}
          </button>
          <button
            type="button"
            className="window-control-button window-control-close"
            title={t('window.close')}
            aria-label={t('window.close')}
            onClick={() => void controls.close()}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </header>
  );
}
