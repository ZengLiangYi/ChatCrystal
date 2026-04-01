import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/providers/ThemeProvider.tsx';
import '@/i18n';
import { Layout } from '@/components/Layout.tsx';
import { Dashboard } from '@/pages/Dashboard.tsx';
import { Conversations } from '@/pages/Conversations.tsx';
import { ConversationDetail } from '@/pages/ConversationDetail.tsx';
import { Notes } from '@/pages/Notes.tsx';
import { NoteDetail } from '@/pages/NoteDetail.tsx';
import { SearchPage } from '@/pages/SearchPage.tsx';
import { SettingsPage } from '@/pages/SettingsPage.tsx';
import { RelationGraph } from '@/pages/RelationGraph.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/conversations" element={<Conversations />} />
              <Route path="/conversations/:id" element={<ConversationDetail />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/notes/:id" element={<NoteDetail />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/graph" element={<RelationGraph />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
