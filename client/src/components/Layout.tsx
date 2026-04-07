import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';
import { StatusBar } from './StatusBar.tsx';
import { StarBanner } from './StarBanner.tsx';

export function Layout() {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex-1 min-w-0 h-screen flex flex-col">
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
        <StarBanner />
        <StatusBar />
      </div>
    </div>
  );
}
