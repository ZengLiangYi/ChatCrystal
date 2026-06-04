import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
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
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@/components/ui/alert.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogMedia,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@/components/ui/toggle-group.tsx";
import {
	getSelectedLanguageCode,
	LANGUAGE_OPTIONS,
} from "@/i18n/language.ts";
import { api } from "@/lib/api.ts";
import { cn } from "@/lib/cn.ts";
import { getSourceColor } from "@/lib/source-colors.ts";
import { useTheme } from "@/providers/useTheme.ts";

type ProviderOption = {
	name: string;
	displayName: string;
	supportsEmbedding: boolean;
	requiresApiKey: boolean;
	requiresBaseURL: boolean;
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

	const [llmProvider, setLlmProvider] = useState("");
	const [llmBaseURL, setLlmBaseURL] = useState("");
	const [llmApiKey, setLlmApiKey] = useState("");
	const [llmModel, setLlmModel] = useState("");

	const [embProvider, setEmbProvider] = useState("");
	const [embBaseURL, setEmbBaseURL] = useState("");
	const [embApiKey, setEmbApiKey] = useState("");
	const [embModel, setEmbModel] = useState("");

	const [enabledSources, setEnabledSources] = useState<string[]>([]);
	const [confirmWarnings, setConfirmWarnings] = useState<string[] | null>(null);
	const [pendingConfig, setPendingConfig] = useState<Record<
		string,
		unknown
	> | null>(null);

	const testMutation = useMutation({ mutationFn: () => api.testConfig() });

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
	const embeddingProviders = providers?.filter((p) => p.supportsEmbedding) ?? [];

	const toggleSource = (name: string) => {
		const next = enabledSources.includes(name)
			? enabledSources.filter((s) => s !== name)
			: [...enabledSources, name];
		setEnabledSources(next);
		api.updateConfig({ enabledSources: next }).then(() => {
			queryClient.invalidateQueries({ queryKey: ["config"] });
		});
	};

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

	const selectedLanguage = getSelectedLanguageCode(
		i18n.resolvedLanguage ?? i18n.language,
	);
	const languages = LANGUAGE_OPTIONS.map((code) => ({
		code,
		label: t(`language_name.${code}`),
	}));
	const loading = !config || !providers || !initialized;

	return (
		<div className="flex w-full max-w-3xl flex-col gap-6 p-6">
			<h2 className="text-xl font-bold">{t("title.settings")}</h2>

			{loading ? (
				<SettingsSkeleton />
			) : (
				<>
					<Section title={t("section.theme")} icon={<Palette />}>
						<ToggleGroup
							type="single"
							value={themeName}
							onValueChange={(value) => {
								if (value) setTheme(value);
							}}
							variant="outline"
							size="sm"
							className="flex-wrap"
						>
							{availableThemes.map((theme) => (
								<ToggleGroupItem
									key={theme.name}
									value={theme.name}
									className="data-[state=on]:border-[var(--accent)] data-[state=on]:text-accent"
								>
									<span className="flex items-center gap-2">
										<span className="flex gap-0.5">
											<span
												className="size-2.5 rounded-full border border-black/10"
												style={{ backgroundColor: theme.colors.bgPrimary }}
											/>
											<span
												className="size-2.5 rounded-full border border-black/10"
												style={{ backgroundColor: theme.colors.accent }}
											/>
											<span
												className="size-2.5 rounded-full border border-black/10"
												style={{ backgroundColor: theme.colors.textPrimary }}
											/>
										</span>
										<span>{t(`theme_name.${theme.name}`)}</span>
									</span>
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Section>

					<Section title={t("section.language")} icon={<Globe />}>
						<ToggleGroup
							type="single"
							value={selectedLanguage}
							onValueChange={(value) => {
								if (value) i18n.changeLanguage(value);
							}}
							variant="outline"
							size="sm"
							className="flex-wrap"
						>
							{languages.map(({ code, label }) => (
								<ToggleGroupItem
									key={code}
									value={code}
									className="data-[state=on]:border-[var(--accent)] data-[state=on]:text-accent"
								>
									{label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Section>

					<Section title={t("section.llm")} icon={<Brain />}>
						<ModelProviderFields
							providers={providers}
							provider={llmProvider}
							onProviderChange={setLlmProvider}
							model={llmModel}
							onModelChange={setLlmModel}
							baseURL={llmBaseURL}
							onBaseURLChange={setLlmBaseURL}
							apiKey={llmApiKey}
							onApiKeyChange={setLlmApiKey}
							providerInfo={llmProviderInfo}
							hasApiKey={config.llm.hasApiKey}
							modelPlaceholder={t("placeholder.llm_model")}
							baseUrlPlaceholder={t("placeholder.llm_base_url")}
						/>
					</Section>

					<Section title={t("section.embedding")} icon={<Server />}>
						<ModelProviderFields
							providers={embeddingProviders}
							provider={embProvider}
							onProviderChange={setEmbProvider}
							model={embModel}
							onModelChange={setEmbModel}
							baseURL={embBaseURL}
							onBaseURLChange={setEmbBaseURL}
							apiKey={embApiKey}
							onApiKeyChange={setEmbApiKey}
							providerInfo={embProviderInfo}
							hasApiKey={config.embedding.hasApiKey}
							modelPlaceholder={t("placeholder.embedding_model")}
							baseUrlPlaceholder={t("placeholder.llm_base_url")}
						/>
					</Section>

					<div className="flex flex-col gap-3 sm:flex-row sm:items-start">
						<div className="flex items-center gap-2">
							<Button
								type="button"
								onClick={handleSave}
								disabled={saveMutation.isPending}
							>
								{saveMutation.isPending ? (
									<Loader2 data-icon="inline-start" className="animate-spin" />
								) : null}
								{t("action.save")}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={() => testMutation.mutate()}
								disabled={testMutation.isPending}
							>
								{testMutation.isPending ? (
									<Loader2 data-icon="inline-start" className="animate-spin" />
								) : null}
								{t("action.test_connection")}
							</Button>
						</div>
						{testMutation.data && (
							<ConnectionTestResult
								llm={testMutation.data.llm}
								embedding={testMutation.data.embedding}
							/>
						)}
					</div>

					<Section title={t("section.data_source")} icon={<FolderSearch />}>
						{config.sources && config.sources.length > 0 ? (
							<div className="flex flex-col gap-3">
								{config.sources.map((src) => {
									const enabled = enabledSources.includes(src.name);
									return (
										<div
											key={src.name}
											className="flex items-center gap-3 text-sm"
										>
											<Switch
												size="default"
												checked={enabled}
												onCheckedChange={() => toggleSource(src.name)}
												aria-label={src.displayName}
											/>
											<span
												className="inline-block size-2 rounded-full shrink-0"
												style={{
													backgroundColor: getSourceColor(src.name),
													opacity: enabled ? 1 : 0.3,
												}}
											/>
											<span
												className={cn(
													"w-24 font-medium",
													enabled ? "text-foreground" : "text-muted-foreground",
												)}
											>
												{src.displayName}
											</span>
											<span className="text-xs text-muted-foreground">
												{t("data_source_conversations", {
													count: src.conversationCount,
												})}
											</span>
											<span className="max-w-64 truncate font-mono text-xs text-muted-foreground">
												{src.dataDir}
											</span>
										</div>
									);
								})}
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								{t("empty_state.no_data_sources")}
							</p>
						)}
					</Section>
				</>
			)}

			<ConfigChangeAlertDialog
				open={Boolean(confirmWarnings)}
				title={t("dialog.config_change")}
				warnings={confirmWarnings ?? []}
				confirmLabel={t("action.confirm")}
				cancelLabel={t("action.cancel")}
				onConfirm={handleConfirm}
				onCancel={() => {
					setConfirmWarnings(null);
					setPendingConfig(null);
				}}
			/>
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
		<section className="flex flex-col gap-3">
			<h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider [&_svg]:size-4">
				{icon} {title}
			</h3>
			{children}
			<Separator />
		</section>
	);
}

function ModelProviderFields({
	providers,
	provider,
	onProviderChange,
	model,
	onModelChange,
	baseURL,
	onBaseURLChange,
	apiKey,
	onApiKeyChange,
	providerInfo,
	hasApiKey,
	modelPlaceholder,
	baseUrlPlaceholder,
}: {
	providers: ProviderOption[];
	provider: string;
	onProviderChange: (value: string) => void;
	model: string;
	onModelChange: (value: string) => void;
	baseURL: string;
	onBaseURLChange: (value: string) => void;
	apiKey: string;
	onApiKeyChange: (value: string) => void;
	providerInfo?: ProviderOption;
	hasApiKey: boolean;
	modelPlaceholder: string;
	baseUrlPlaceholder: string;
}) {
	const { t } = useTranslation();

	return (
		<FieldGroup className="gap-3">
			<FieldRow label={t("label.provider")}>
				<Select value={provider} onValueChange={onProviderChange}>
					<SelectTrigger className="w-52" size="sm">
						<SelectValue placeholder={t("label.provider")} />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{providers.map((p) => (
								<SelectItem key={p.name} value={p.name}>
									{p.displayName}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</FieldRow>
			<FieldRow label={t("label.model")}>
				<Input
					value={model}
					onChange={(e) => onModelChange(e.target.value)}
					className="w-72 font-mono"
					placeholder={modelPlaceholder}
				/>
			</FieldRow>
			{providerInfo?.requiresBaseURL && (
				<FieldRow label={t("label.base_url")}>
					<Input
						value={baseURL}
						onChange={(e) => onBaseURLChange(e.target.value)}
						className="w-72 font-mono"
						placeholder={baseUrlPlaceholder}
					/>
				</FieldRow>
			)}
			{providerInfo?.requiresApiKey && (
				<FieldRow label={t("label.api_key")}>
					<Input
						type="password"
						value={apiKey}
						onChange={(e) => onApiKeyChange(e.target.value)}
						className="w-72 font-mono"
						placeholder={
							hasApiKey
								? t("placeholder.api_key_set")
								: t("placeholder.api_key_not_set")
						}
					/>
				</FieldRow>
			)}
		</FieldGroup>
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
		<Field
			orientation="horizontal"
			className="w-fit max-w-full items-center gap-3 [&>[data-slot=field-label]]:flex-none"
		>
			<FieldLabel className="w-24 shrink-0 justify-start text-xs text-muted-foreground">
				{label}
			</FieldLabel>
			<div className="min-w-0 flex-none">{children}</div>
		</Field>
	);
}

function ConnectionTestResult({
	llm,
	embedding,
}: {
	llm?: { connected: boolean; error?: string };
	embedding?: { connected: boolean; error?: string };
}) {
	const { t } = useTranslation();
	const hasError = llm?.connected === false || embedding?.connected === false;

	return (
		<Alert
			variant={hasError ? "destructive" : "default"}
			className="max-w-md py-2"
		>
			{hasError ? <XCircle /> : <CheckCircle className="text-success" />}
			<AlertTitle className="text-sm">
				{hasError ? t("status.error") : t("status.connected")}
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-1 text-xs">
				<StatusLine
					label="LLM"
					connected={llm?.connected}
					error={llm?.error}
				/>
				<StatusLine
					label="Embedding"
					connected={embedding?.connected}
					error={embedding?.error}
				/>
			</AlertDescription>
		</Alert>
	);
}

function StatusLine({
	label,
	connected,
	error,
}: {
	label: string;
	connected?: boolean;
	error?: string;
}) {
	const { t } = useTranslation();
	if (connected) {
		return (
			<span className="flex items-center gap-1 text-success">
				<CheckCircle />
				<span>
					{label} {t("status.connected")}
				</span>
			</span>
		);
	}

	return (
		<span className="flex items-center gap-1 text-error">
			<XCircle />
			<span>
				{label}: {error}
			</span>
		</span>
	);
}

function ConfigChangeAlertDialog({
	open,
	title,
	warnings,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
}: {
	open: boolean;
	title: string;
	warnings: string[];
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogMedia>
						<AlertTriangle />
					</AlertDialogMedia>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription asChild>
						<ul className="flex flex-col gap-1.5 text-left">
							{warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onConfirm}>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function SettingsSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			{Array.from({ length: 4 }).map((_, index) => (
				<div key={index} className="flex flex-col gap-3">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="h-8 w-72" />
					<Separator />
				</div>
			))}
		</div>
	);
}
