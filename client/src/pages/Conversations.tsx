import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Clock, FolderGit2 } from 'lucide-react';
import { useConversations } from '@/hooks/use-conversations.ts';

export function Conversations() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useConversations({
    search: search || undefined,
    offset: page * limit,
    limit,
  });

  const navigate = useNavigate();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">对话列表</h2>
        <span className="text-sm text-muted">
          共 {data?.total ?? 0} 条对话
        </span>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="搜索项目名或对话..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="w-full bg-secondary border border-theme px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-[var(--accent)]"
          style={{ borderRadius: 'var(--radius)' }}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-muted text-sm">加载中...</p>
      ) : (
        <div className="border border-theme overflow-hidden" style={{ borderRadius: 'var(--radius)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-tertiary text-left text-xs text-muted uppercase tracking-wider">
                <th className="px-4 py-2">项目</th>
                <th className="px-4 py-2">对话标识</th>
                <th className="px-4 py-2 text-center">消息数</th>
                <th className="px-4 py-2">最后活跃</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((conv) => (
                <tr
                  key={conv.id as string}
                  onClick={() => navigate(`/conversations/${conv.id}`)}
                  className="border-t border-theme hover:bg-tertiary cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FolderGit2 size={14} className="text-info shrink-0" />
                      <span className="text-primary font-medium truncate max-w-48">
                        {conv.project_name as string}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-secondary font-mono text-xs">
                      {conv.slug as string || (conv.id as string).slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-muted">
                      <MessageSquare size={12} />
                      {conv.message_count as number}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-muted text-xs">
                      <Clock size={12} />
                      {formatTime(conv.last_message_at as string)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > limit && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="text-sm text-secondary hover:text-primary disabled:opacity-30"
          >
            上一页
          </button>
          <span className="text-xs text-muted">
            {page + 1} / {Math.ceil(data.total / limit)}
          </span>
          <button
            type="button"
            disabled={(page + 1) * limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-secondary hover:text-primary disabled:opacity-30"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} 天前`;

  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
