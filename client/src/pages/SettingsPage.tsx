import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@/providers/ThemeProvider.tsx';
import { Server, Brain, FolderSearch } from 'lucide-react';
import { api } from '@/lib/api.ts';

function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
  });
}

export function SettingsPage() {
  const { themeName, availableThemes, setTheme } = useTheme();
  const { data: config } = useConfig();

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-6">设置</h2>

      {/* Theme */}
      <Section title="主题" icon={<span className="text-sm">🎨</span>}>
        <div className="flex gap-2">
          {availableThemes.map((name) => (
            <button
              type="button"
              key={name}
              onClick={() => setTheme(name)}
              className={`px-4 py-2 text-sm border transition-colors ${
                name === themeName
                  ? 'border-[var(--accent)] text-accent'
                  : 'border-theme text-secondary hover:text-primary'
              }`}
              style={{ borderRadius: 'var(--radius)' }}
            >
              {name}
            </button>
          ))}
        </div>
      </Section>

      {/* LLM Config */}
      <Section title="LLM 摘要" icon={<Brain size={14} />}>
        {config ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <ConfigRow label="Provider" value={config.llm.provider} />
            <ConfigRow label="Model" value={config.llm.model} />
            <ConfigRow label="Base URL" value={config.llm.baseURL} />
            <ConfigRow label="API Key" value={config.llm.hasApiKey ? '••••••' : '未设置'} />
          </div>
        ) : (
          <p className="text-muted text-sm">加载中...</p>
        )}
        <p className="text-xs text-muted mt-3">修改 .env 文件后重启服务生效</p>
      </Section>

      {/* Embedding Config */}
      <Section title="Embedding 搜索" icon={<Server size={14} />}>
        {config ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <ConfigRow label="Provider" value={config.embedding.provider} />
            <ConfigRow label="Model" value={config.embedding.model} />
            <ConfigRow label="Base URL" value={config.embedding.baseURL} />
          </div>
        ) : (
          <p className="text-muted text-sm">加载中...</p>
        )}
      </Section>

      {/* Data source */}
      <Section title="数据源" icon={<FolderSearch size={14} />}>
        {config ? (
          <ConfigRow label="Claude Code 目录" value={config.claudeProjectsDir} />
        ) : (
          <p className="text-muted text-sm">加载中...</p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h3 className="flex items-center gap-2 text-sm font-medium text-secondary mb-3 uppercase tracking-wider">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="text-primary font-mono text-xs">{value}</span>
    </>
  );
}
