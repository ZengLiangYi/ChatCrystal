import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/providers/ThemeProvider.tsx';
import { Brain, Server, FolderSearch, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog.tsx';

function useProviders() {
  return useQuery({ queryKey: ['providers'], queryFn: () => api.getProviders() });
}

function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.getConfig() });
}

export function SettingsPage() {
  const { themeName, availableThemes, setTheme } = useTheme();
  const { data: config } = useConfig();
  const { data: providers } = useProviders();
  const queryClient = useQueryClient();

  // LLM form state
  const [llmProvider, setLlmProvider] = useState('');
  const [llmBaseURL, setLlmBaseURL] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('');

  // Embedding form state
  const [embProvider, setEmbProvider] = useState('');
  const [embBaseURL, setEmbBaseURL] = useState('');
  const [embApiKey, setEmbApiKey] = useState('');
  const [embModel, setEmbModel] = useState('');

  // Confirmation dialog
  const [confirmWarnings, setConfirmWarnings] = useState<string[] | null>(null);
  const [pendingConfig, setPendingConfig] = useState<Record<string, unknown> | null>(null);

  // Test connection
  const testMutation = useMutation({ mutationFn: () => api.testConfig() });

  // Initialize form from config
  useEffect(() => {
    if (config) {
      setLlmProvider(config.llm.provider);
      setLlmBaseURL(config.llm.baseURL);
      setLlmApiKey('');
      setLlmModel(config.llm.model);
      setEmbProvider(config.embedding.provider);
      setEmbBaseURL(config.embedding.baseURL);
      setEmbApiKey('');
      setEmbModel(config.embedding.model);
    }
  }, [config]);

  const llmProviderInfo = providers?.find((p) => p.name === llmProvider);
  const embProviderInfo = providers?.find((p) => p.name === embProvider);

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.updateConfig(data as Parameters<typeof api.updateConfig>[0]),
    onSuccess: (result) => {
      if (result.requiresConfirm && result.warnings) {
        setConfirmWarnings(result.warnings);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });

  const handleSave = () => {
    const data = {
      llm: {
        provider: llmProvider,
        baseURL: llmBaseURL,
        model: llmModel,
        ...(llmApiKey ? { apiKey: llmApiKey } : {}),
      },
      embedding: {
        provider: embProvider,
        baseURL: embBaseURL,
        model: embModel,
        ...(embApiKey ? { apiKey: embApiKey } : {}),
      },
    };
    setPendingConfig(data);
    saveMutation.mutate(data);
  };

  const handleConfirm = () => {
    if (pendingConfig) {
      saveMutation.mutate({ ...pendingConfig, confirm: true });
    }
    setConfirmWarnings(null);
    setPendingConfig(null);
  };

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-6">Settings</h2>

      {/* Theme */}
      <Section title="Theme" icon={<span className="text-sm">🎨</span>}>
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
      <Section title="LLM" icon={<Brain size={14} />}>
        <div className="space-y-3">
          <FieldRow label="Provider">
            <select
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value)}
              className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-48"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {providers?.map((p) => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Model">
            <input
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
              style={{ borderRadius: 'var(--radius)' }}
              placeholder="e.g. qwen2.5:7b"
            />
          </FieldRow>
          {llmProviderInfo?.requiresBaseURL && (
            <FieldRow label="Base URL">
              <input
                value={llmBaseURL}
                onChange={(e) => setLlmBaseURL(e.target.value)}
                className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
                style={{ borderRadius: 'var(--radius)' }}
                placeholder="http://localhost:11434"
              />
            </FieldRow>
          )}
          {llmProviderInfo?.requiresApiKey && (
            <FieldRow label="API Key">
              <input
                type="password"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
                className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
                style={{ borderRadius: 'var(--radius)' }}
                placeholder={config?.llm.hasApiKey ? '••••••（已设置）' : '未设置'}
              />
            </FieldRow>
          )}
        </div>
      </Section>

      {/* Embedding Config */}
      <Section title="Embedding" icon={<Server size={14} />}>
        <div className="space-y-3">
          <FieldRow label="Provider">
            <select
              value={embProvider}
              onChange={(e) => setEmbProvider(e.target.value)}
              className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-48"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {providers?.filter((p) => p.supportsEmbedding).map((p) => (
                <option key={p.name} value={p.name}>{p.displayName}</option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Model">
            <input
              value={embModel}
              onChange={(e) => setEmbModel(e.target.value)}
              className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
              style={{ borderRadius: 'var(--radius)' }}
              placeholder="e.g. nomic-embed-text"
            />
          </FieldRow>
          {embProviderInfo?.requiresBaseURL && (
            <FieldRow label="Base URL">
              <input
                value={embBaseURL}
                onChange={(e) => setEmbBaseURL(e.target.value)}
                className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </FieldRow>
          )}
          {embProviderInfo?.requiresApiKey && (
            <FieldRow label="API Key">
              <input
                type="password"
                value={embApiKey}
                onChange={(e) => setEmbApiKey(e.target.value)}
                className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
                style={{ borderRadius: 'var(--radius)' }}
              />
            </FieldRow>
          )}
        </div>
      </Section>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="px-4 py-2 text-sm font-medium border border-theme hover:border-[var(--accent)] transition-colors"
          style={{ borderRadius: 'var(--radius)', color: 'var(--accent)' }}
        >
          {saveMutation.isPending ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
          Save
        </button>
        <button
          type="button"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
          className="px-4 py-2 text-sm border border-theme text-secondary hover:text-primary transition-colors"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {testMutation.isPending ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
          Test Connection
        </button>
        {testMutation.data && (
          <span className="flex items-center gap-1 text-xs">
            {testMutation.data.connected ? (
              <><CheckCircle size={12} style={{ color: 'var(--success)' }} /> <span className="text-success">Connected</span></>
            ) : (
              <><XCircle size={12} style={{ color: 'var(--error)' }} /> <span className="text-error">{testMutation.data.error}</span></>
            )}
          </span>
        )}
      </div>

      {/* Data source */}
      <Section title="Data Source" icon={<FolderSearch size={14} />}>
        {config && (
          <div className="text-sm">
            <span className="text-muted">Claude Code: </span>
            <span className="text-primary font-mono text-xs">{config.claudeProjectsDir}</span>
          </div>
        )}
      </Section>

      {/* Confirm dialog */}
      {confirmWarnings && (
        <ConfirmDialog
          title="Configuration Change"
          warnings={confirmWarnings}
          confirmLabel="Confirm"
          onConfirm={handleConfirm}
          onCancel={() => { setConfirmWarnings(null); setPendingConfig(null); }}
        />
      )}
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

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-xs text-muted w-20 shrink-0 text-right">{label}</span>
      {children}
    </div>
  );
}
