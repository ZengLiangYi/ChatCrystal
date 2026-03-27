import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FolderGit2, Tag, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';

type SearchResult = {
  note_id: number;
  conversation_id: string;
  title: string;
  project_name: string;
  score: number;
  tags: string[];
};

export function SearchPage() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const search = useMutation({
    mutationFn: (q: string) => api.search(q),
  });

  const handleSearch = () => {
    if (!query.trim()) return;
    search.mutate(query);
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">语义搜索</h2>

      {/* Search input */}
      <div className="flex gap-2 mb-6">
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            placeholder="输入关键词进行语义搜索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full bg-secondary border border-theme pl-9 pr-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-[var(--accent)]"
            style={{ borderRadius: 'var(--radius)' }}
          />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={search.isPending || !query.trim()}
          className="px-4 py-2 text-sm font-medium border border-theme hover:border-[var(--accent)] disabled:opacity-40 transition-colors"
          style={{ borderRadius: 'var(--radius)', color: 'var(--accent)' }}
        >
          {search.isPending ? <Loader2 size={14} className="animate-spin" /> : '搜索'}
        </button>
      </div>

      {/* Results */}
      {search.isError && (
        <p className="text-error text-sm mb-4">{search.error.message}</p>
      )}

      {search.data && search.data.length === 0 && (
        <div className="text-center py-12 text-muted text-sm">
          <Search size={32} className="mx-auto mb-3 opacity-30" />
          <p>未找到相关结果</p>
          <p className="mt-1 text-xs">确保已生成笔记和 embedding</p>
        </div>
      )}

      {search.data && search.data.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted mb-3">找到 {search.data.length} 条相关结果</p>
          {search.data.map((result: SearchResult) => (
            <div
              key={result.note_id}
              onClick={() => navigate(`/notes/${result.note_id}`)}
              className="flex items-start gap-3 bg-secondary border border-theme p-3 hover:border-[var(--accent)] cursor-pointer transition-colors"
              style={{ borderRadius: 'var(--radius)' }}
            >
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold truncate">{result.title}</h3>
                <div className="flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <FolderGit2 size={11} />
                    {result.project_name}
                  </span>
                  {result.tags.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted">
                      <Tag size={9} />
                      {result.tags.slice(0, 3).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              <span
                className="shrink-0 text-xs font-mono px-1.5 py-0.5"
                style={{
                  background: 'var(--bg-tertiary)',
                  borderRadius: '3px',
                  color: result.score > 0.7 ? 'var(--success)' : result.score > 0.4 ? 'var(--warning)' : 'var(--text-muted)',
                }}
              >
                {(result.score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
