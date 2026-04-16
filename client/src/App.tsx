import { Suspense, lazy, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ThemeProvider } from '@/providers/ThemeProvider.tsx';
import '@/i18n';
import { Layout } from '@/components/Layout.tsx';

const DashboardPage = lazy(() => import('@/pages/Dashboard.tsx').then((module) => ({ default: module.Dashboard })));
const ConversationsPage = lazy(() => import('@/pages/Conversations.tsx').then((module) => ({ default: module.Conversations })));
const ConversationDetailPage = lazy(() => import('@/pages/ConversationDetail.tsx').then((module) => ({ default: module.ConversationDetail })));
const NotesPage = lazy(() => import('@/pages/Notes.tsx').then((module) => ({ default: module.Notes })));
const NoteDetailPage = lazy(() => import('@/pages/NoteDetail.tsx').then((module) => ({ default: module.NoteDetail })));
const SearchPage = lazy(() => import('@/pages/SearchPage.tsx').then((module) => ({ default: module.SearchPage })));
const RelationGraphPage = lazy(() => import('@/pages/RelationGraph.tsx').then((module) => ({ default: module.RelationGraph })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage.tsx').then((module) => ({ default: module.SettingsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function RouteSuspense({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<div className="p-6 text-muted">{t('status.loading')}</div>}>
      {children}
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<RouteSuspense><DashboardPage /></RouteSuspense>} />
              <Route path="/conversations" element={<RouteSuspense><ConversationsPage /></RouteSuspense>} />
              <Route path="/conversations/:id" element={<RouteSuspense><ConversationDetailPage /></RouteSuspense>} />
              <Route path="/notes" element={<RouteSuspense><NotesPage /></RouteSuspense>} />
              <Route path="/notes/:id" element={<RouteSuspense><NoteDetailPage /></RouteSuspense>} />
              <Route path="/search" element={<RouteSuspense><SearchPage /></RouteSuspense>} />
              <Route path="/graph" element={<RouteSuspense><RelationGraphPage /></RouteSuspense>} />
              <Route path="/settings" element={<RouteSuspense><SettingsPage /></RouteSuspense>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
