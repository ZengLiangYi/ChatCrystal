import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.tsx';

export function Layout() {
  return (
    <div className="flex min-h-screen w-full">
      <Sidebar />
      <div className="flex-1 min-w-0 h-screen overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
