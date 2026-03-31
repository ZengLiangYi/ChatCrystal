import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Brain,
	CheckCircle,
	FolderSearch,
	Globe,
	Loader2,
	Palette,
	Server,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { api } from "@/lib/api.ts";
import { useTheme } from "@/providers/ThemeProvider.tsx";

const SOURCE_COLORS: Record<string, string> = {
	"claude-code": "#e8784a",
	codex: "#10a37f",
	cursor: "#a855f7",
};

function useProviders() {
	return useQuery({
		queryKey: ["providers"],
		queryFn: () => api.getProviders(),
	});
}

function useConfig() {
	return useQuery({ queryKey: ["config"], queryFn: () => api.getConfig() });
}

export function SettingsPage() {
	const { t, i18n } = useTranslation();
	const { themeName, availableThemes, setTheme } = useTheme();
	const { data: config } = useConfig();
	const { data: providers } = useProviders();
	const queryClient = useQueryClient();

	// LLM form state
	const [llmProvider, setLlmProvider] = useState("");
	const [llmBaseURL, setLlmBaseURL] = useState("");
	const [llmApiKey, setLlmApiKey] = useState("");
	const [llmModel, setLlmModel] = useState("");

	// Embedding form state
	const [embProvider, setEmbProvider] = useState("");
	const [embBaseURL, setEmbBaseURL] = useState("");
	const [embApiKey, setEmbApiKey] = useState("");
	const [embModel, setEmbModel] = useState("");

	// Source toggles
	const [enabledSources, setEnabledSources] = useState<string[]>([]);

	// Confirmation dialog
	const [confirmWarnings, setConfirmWarnings] = useState<string[] | null>(null);
	const [pendingConfig, setPendingConfig] = useState<Record<
		string,
		unknown
	> | null>(null);

	// Test connection
	const testMutation = useMutation({ mutationFn: () => api.testConfig() });

	// Initialize form from config (only on first load)
	const [initialized, setInitialized] = useState(false);
	useEffect(() => {
		if (config && !initialized) {
			setLlmProvider(config.llm.provider);
			setLlmBaseURL(config.llm.baseURL);
			setLlmApiKey("");
			setLlmModel(config.llm.model);
			setEmbProvider(config.embedding.provider);
			setEmbBaseURL(config.embedding.baseURL);
			setEmbApiKey("");
			setEmbModel(config.embedding.model);
			setEnabledSources(config.enabledSources || []);
			setInitialized(true);
		}
	}, [config, initialized]);

	const llmProviderInfo = providers?.find((p) => p.name === llmProvider);
	const embProviderInfo = providers?.find((p) => p.name === embProvider);

	const toggleSource = (name: string) => {
		const next = enabledSources.includes(name)
			? enabledSources.filter((s) => s !== name)
			: [...enabledSources, name];
		setEnabledSources(next);
		api.updateConfig({ enabledSources: next }).then(() => {
			queryClient.invalidateQueries({ queryKey: ["config"] });
		});
	};

	// Save config mutation
	const saveMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) =>
			api.updateConfig(data as Parameters<typeof api.updateConfig>[0]),
		onSuccess: (result) => {
			if (result.requiresConfirm && result.warnings) {
				setConfirmWarnings(result.warnings);
				return;
			}
			queryClient.invalidateQueries({ queryKey: ["config"] });
			queryClient.invalidateQueries({ queryKey: ["status"] });
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

	const languages = [
		{ code: "zh", label: t("language_name.zh") },
		{ code: "en", label: t("language_name.en") },
	];

	return (
		<div className="p-6 max-w-2xl">
			<h2 className="text-xl font-bold mb-6">{t("title.settings")}</h2>

			{/* Theme */}
			<Section title={t("section.theme")} icon={<Palette size={14} />}>
				<div className="flex gap-2">
					{availableThemes.map((theme) => (
						<button
							type="button"
							key={theme.name}
							onClick={() => setTheme(theme.name)}
							className={`group relative px-4 py-2 text-sm border transition-colors ${
								theme.name === themeName
									? "border-[var(--accent)] text-accent"
									: "border-theme text-secondary hover:text-primary"
							}`}
							style={{ borderRadius: "var(--radius)" }}
						>
							<div className="flex items-center gap-2">
								{/* Color preview dots */}
								<div className="flex gap-0.5">
									<span
										className="w-2.5 h-2.5 rounded-full border border-black/10"
										style={{ backgroundColor: theme.colors.bgPrimary }}
									/>
									<span
										className="w-2.5 h-2.5 rounded-full border border-black/10"
										style={{ backgroundColor: theme.colors.accent }}
									/>
									<span
										className="w-2.5 h-2.5 rounded-full border border-black/10"
										style={{ backgroundColor: theme.colors.textPrimary }}
									/>
								</div>
								<span>{t(`theme_name.${theme.name}`)}</span>
							</div>
						</button>
					))}
				</div>
			</Section>

			{/* Language */}
			<Section title={t("section.language")} icon={<Globe size={14} />}>
				<div className="flex gap-2">
					{languages.map(({ code, label }) => (
						<button
							type="button"
							key={code}
							onClick={() => i18n.changeLanguage(code)}
							className={`px-4 py-2 text-sm border transition-colors ${
								i18n.language === code
									? "border-[var(--accent)] text-accent"
									: "border-theme text-secondary hover:text-primary"
							}`}
							style={{ borderRadius: "var(--radius)" }}
						>
							{label}
						</button>
					))}
				</div>
			</Section>

			{/* LLM Config */}
			<Section title={t("section.llm")} icon={<Brain size={14} />}>
				<div className="space-y-3">
					<FieldRow label={t("label.provider")}>
						<select
							value={llmProvider}
							onChange={(e) => setLlmProvider(e.target.value)}
							className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-48"
							style={{ borderRadius: "var(--radius)" }}
						>
							{providers?.map((p) => (
								<option key={p.name} value={p.name}>
									{p.displayName}
								</option>
							))}
						</select>
					</FieldRow>
					<FieldRow label={t("label.model")}>
						<input
							value={llmModel}
							onChange={(e) => setLlmModel(e.target.value)}
							className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
							style={{ borderRadius: "var(--radius)" }}
							placeholder={t("placeholder.llm_model")}
						/>
					</FieldRow>
					{llmProviderInfo?.requiresBaseURL && (
						<FieldRow label={t("label.base_url")}>
							<input
								value={llmBaseURL}
								onChange={(e) => setLlmBaseURL(e.target.value)}
								className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
								style={{ borderRadius: "var(--radius)" }}
								placeholder={t("placeholder.llm_base_url")}
							/>
						</FieldRow>
					)}
					{llmProviderInfo?.requiresApiKey && (
						<FieldRow label={t("label.api_key")}>
							<input
								type="password"
								value={llmApiKey}
								onChange={(e) => setLlmApiKey(e.target.value)}
								className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
								style={{ borderRadius: "var(--radius)" }}
								placeholder={
									config?.llm.hasApiKey
										? t("placeholder.api_key_set")
										: t("placeholder.api_key_not_set")
								}
							/>
						</FieldRow>
					)}
				</div>
			</Section>

			{/* Embedding Config */}
			<Section title={t("section.embedding")} icon={<Server size={14} />}>
				<div className="space-y-3">
					<FieldRow label={t("label.provider")}>
						<select
							value={embProvider}
							onChange={(e) => setEmbProvider(e.target.value)}
							className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-48"
							style={{ borderRadius: "var(--radius)" }}
						>
							{providers
								?.filter((p) => p.supportsEmbedding)
								.map((p) => (
									<option key={p.name} value={p.name}>
										{p.displayName}
									</option>
								))}
						</select>
					</FieldRow>
					<FieldRow label={t("label.model")}>
						<input
							value={embModel}
							onChange={(e) => setEmbModel(e.target.value)}
							className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
							style={{ borderRadius: "var(--radius)" }}
							placeholder={t("placeholder.embedding_model")}
						/>
					</FieldRow>
					{embProviderInfo?.requiresBaseURL && (
						<FieldRow label={t("label.base_url")}>
							<input
								value={embBaseURL}
								onChange={(e) => setEmbBaseURL(e.target.value)}
								className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
								style={{ borderRadius: "var(--radius)" }}
							/>
						</FieldRow>
					)}
					{embProviderInfo?.requiresApiKey && (
						<FieldRow label={t("label.api_key")}>
							<input
								type="password"
								value={embApiKey}
								onChange={(e) => setEmbApiKey(e.target.value)}
								className="bg-tertiary border border-theme px-3 py-1.5 text-sm text-primary w-64 font-mono"
								style={{ borderRadius: "var(--radius)" }}
								placeholder={
									config?.embedding.hasApiKey
										? t("placeholder.api_key_set")
										: t("placeholder.api_key_not_set")
								}
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
					style={{ borderRadius: "var(--radius)", color: "var(--accent)" }}
				>
					{saveMutation.isPending ? (
						<Loader2 size={14} className="animate-spin inline mr-1" />
					) : null}
					{t("action.save")}
				</button>
				<button
					type="button"
					onClick={() => testMutation.mutate()}
					disabled={testMutation.isPending}
					className="px-4 py-2 text-sm border border-theme text-secondary hover:text-primary transition-colors"
					style={{ borderRadius: "var(--radius)" }}
				>
					{testMutation.isPending ? (
						<Loader2 size={14} className="animate-spin inline mr-1" />
					) : null}
					{t("action.test_connection")}
				</button>
				{testMutation.data && (
					<span className="flex items-center gap-1 text-xs">
						{testMutation.data.connected ? (
							<>
								<CheckCircle size={12} style={{ color: "var(--success)" }} />{" "}
								<span className="text-success">{t("status.connected")}</span>
							</>
						) : (
							<>
								<XCircle size={12} style={{ color: "var(--error)" }} />{" "}
								<span className="text-error">{testMutation.data.error}</span>
							</>
						)}
					</span>
				)}
			</div>

			{/* Data source */}
			<Section title={t("section.data_source")} icon={<FolderSearch size={14} />}>
				{config?.sources && config.sources.length > 0 ? (
					<div className="space-y-3">
						{config.sources.map((src) => {
							const enabled = enabledSources.includes(src.name);
							return (
								<div key={src.name} className="flex items-center gap-3 text-sm">
									<button
										type="button"
										onClick={() => toggleSource(src.name)}
										className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
											enabled
												? "bg-[var(--accent)]"
												: "bg-tertiary border border-theme"
										}`}
									>
										<span
											className={`absolute top-0.5 w-4 h-4 rounded-full bg-primary transition-transform ${
												enabled ? "left-[18px]" : "left-0.5"
											}`}
											style={{
												backgroundColor: enabled ? "#fff" : "var(--text-muted)",
											}}
										/>
									</button>
									<span
										className="inline-block w-2 h-2 rounded-full shrink-0"
										style={{
											backgroundColor:
												SOURCE_COLORS[src.name] || "var(--text-muted)",
											opacity: enabled ? 1 : 0.3,
										}}
									/>
									<span
										className={`font-medium w-24 ${enabled ? "text-primary" : "text-muted"}`}
									>
										{src.displayName}
									</span>
									<span className="text-muted text-xs">
										{t("data_source_conversations", { count: src.conversationCount })}
									</span>
									<span className="text-muted font-mono text-xs truncate max-w-64">
										{src.dataDir}
									</span>
								</div>
							);
						})}
					</div>
				) : (
					<p className="text-muted text-sm">{t("empty_state.no_data_sources")}</p>
				)}
			</Section>

			{/* Confirm dialog */}
			{confirmWarnings && (
				<ConfirmDialog
					title={t("dialog.config_change")}
					warnings={confirmWarnings}
					confirmLabel={t("action.confirm")}
					onConfirm={handleConfirm}
					onCancel={() => {
						setConfirmWarnings(null);
						setPendingConfig(null);
					}}
				/>
			)}
		</div>
	);
}

function Section({
	title,
	icon,
	children,
}: {
	title: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="mb-8">
			<h3 className="flex items-center gap-2 text-sm font-medium text-secondary mb-3 uppercase tracking-wider">
				{icon} {title}
			</h3>
			{children}
		</section>
	);
}

function FieldRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-4">
			<span className="text-xs text-muted w-20 shrink-0 text-right">
				{label}
			</span>
			{children}
		</div>
	);
}
