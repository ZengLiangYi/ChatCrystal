import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { StarBanner } from './StarBanner.tsx';
import { WindowTitleBar } from './WindowTitleBar.tsx';

export function Layout() {
  const isElectron = window.electronAPI?.isElectron === true;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-primary">
      {isElectron && <WindowTitleBar />}
      <div className="flex min-h-0 flex-1">
        <Sidebar showBrand={!isElectron} />
        <div className="min-w-0 flex-1 flex flex-col">
          <main className="min-h-0 flex-1 overflow-auto app-content-surface">
            <Outlet />
          </main>
          <StarBanner />
          <StatusBar />
        </div>
      </div>
    </div>
  );
}
