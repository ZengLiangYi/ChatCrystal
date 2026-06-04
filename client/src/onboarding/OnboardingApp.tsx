import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	CheckCircle2,
	Cloud,
	Database,
	KeyRound,
	ShieldCheck,
} from "lucide-react";

import { AccessShell } from "@/components/AccessShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSelectedLanguageCode } from "@/i18n/language";

type OnboardingMode = "local" | "cloud";
type OnboardingScreen =
	| "mode"
	| "cloud"
	| "https"
	| "import"
	| "summary"
	| "mcp"
	| "done";
type NoticeTone = "default" | "ok" | "warning" | "error";

type NoticeState = {
	text: string;
	tone?: NoticeTone;
} | null;

type ImportResult = {
	importedCount?: number;
	imported?: number;
	summarizationCandidateIds?: string[];
};

function createPreviewApi(): ChatCrystalOnboardingApi {
	const snippet = JSON.stringify(
		{
			mcpServers: {
				chatcrystal: {
					command: "crystal",
					args: ["mcp"],
				},
			},
		},
		null,
		2,
	);

	return {
		getState: () =>
			delay({
				mode: null,
				cloudBaseUrl: null,
				cloudToken: null,
			}),
		startLocal: () => delay({ mode: "local" }),
		saveCloudConnection: ({ baseUrl }) =>
			delay({
				mode: "cloud",
				cloudBaseUrl: baseUrl,
				httpsRecommended: !baseUrl.startsWith("https://"),
			}),
		importLocalHistory: () =>
			delay({
				importedCount: 18,
				summarizationCandidateIds: ["demo-1", "demo-2", "demo-3"],
			}),
		uploadLocalHistory: () =>
			delay({
				importedCount: 18,
				summarizationCandidateIds: ["demo-1", "demo-2", "demo-3"],
			}),
		testModel: () => delay({ ok: true }),
		summarizeBatch: ({ conversationIds }) =>
			delay({ summarizedCount: conversationIds?.length || 0 }),
		getMcpSnippet: () => delay(snippet),
		openApp: () => delay({ ok: true }),
		useTemporaryLocal: () => delay({ ok: true }),
	};
}

function delay<T>(value: T, ms = 260): Promise<T> {
	return new Promise((resolve) => {
		window.setTimeout(() => resolve(value), ms);
	});
}

function formatMcpSnippet(snippet: unknown): string {
	return typeof snippet === "string" ? snippet : JSON.stringify(snippet, null, 2);
}

function getImportCount(result: ImportResult | null): number {
	return result?.importedCount ?? result?.imported ?? 0;
}

function getSummarizationCandidateIds(result: ImportResult | null): string[] {
	return Array.isArray(result?.summarizationCandidateIds)
		? result.summarizationCandidateIds
		: [];
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : String(error || fallback);
}

function Notice({ notice }: { notice: NoticeState }) {
	if (!notice?.text) return null;
	const tone = notice.tone ?? "default";
	const className =
		tone === "error"
			? "border-border bg-background text-error"
			: tone === "ok"
				? "border-border bg-background text-success"
				: tone === "warning"
					? "border-border bg-background text-warning"
					: "border-border bg-background text-muted-foreground";
	const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;

	return (
		<Alert className={className}>
			<Icon aria-hidden="true" />
			<AlertDescription className="text-current">{notice.text}</AlertDescription>
		</Alert>
	);
}

export function OnboardingApp() {
	const { t, i18n } = useTranslation();
	const params = useMemo(() => new URLSearchParams(window.location.search), []);
	const isPreview = window.location.search.includes("preview=1");
	const initialError = params.get("initialError")?.trim() ?? "";
	const api = useMemo(
		() => (isPreview ? createPreviewApi() : window.chatcrystalOnboarding),
		[isPreview],
	);
	const cloudBaseUrlId = useId();
	const cloudTokenId = useId();
	const windowControls = window.electronAPI?.windowControls;
	const selectedLanguage =
		getSelectedLanguageCode(i18n.resolvedLanguage ?? i18n.language) ?? "en";
	const [screen, setScreen] = useState<OnboardingScreen>("mode");
	const [mode, setMode] = useState<OnboardingMode>("local");
	const [notice, setNotice] = useState<NoticeState>(null);
	const [cloudDraft, setCloudDraft] = useState({ baseUrl: "", token: "" });
	const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);
	const [mcpSnippet, setMcpSnippet] = useState("");

	useEffect(() => {
		document.title = t("onboarding_flow.app_title");
	}, [t]);

	useEffect(() => {
		if (!api || screen !== "mcp" || mcpSnippet) return;
		let cancelled = false;
		api.getMcpSnippet(mode)
			.then((snippet) => {
				if (!cancelled) setMcpSnippet(formatMcpSnippet(snippet));
			})
			.catch(() => {
				if (!cancelled) setMcpSnippet("");
			});
		return () => {
			cancelled = true;
		};
	}, [api, mcpSnippet, mode, screen]);

	const panelTitleKey = {
		mode: "onboarding_flow.mode_title",
		cloud: "onboarding_flow.cloud_form_title",
		https: "onboarding_flow.https_title",
		import: "onboarding_flow.import_title",
		summary: "onboarding_flow.summary_title",
		mcp: "onboarding_flow.mcp_title",
		done: "onboarding_flow.done_title",
	}[screen];

	function goTo(nextScreen: OnboardingScreen, nextNotice: NoticeState = null) {
		setScreen(nextScreen);
		setNotice(nextNotice);
	}

	async function startLocal() {
		if (!api) return;
		setMode("local");
		setNotice({ text: t("onboarding_flow.loading_local") });
		try {
			await api.startLocal();
			goTo("import", { text: t("onboarding_flow.local_ready"), tone: "ok" });
		} catch (error) {
			setNotice({
				text: errorMessage(error, t("onboarding_flow.error_fallback")),
				tone: "error",
			});
		}
	}

	async function saveCloudConnection() {
		if (!api) return;
		setMode("cloud");
		setNotice({ text: t("onboarding_flow.cloud_saving") });
		try {
			const result = await api.saveCloudConnection({
				baseUrl: cloudDraft.baseUrl,
				token: cloudDraft.token,
			});
			if (result?.httpsRecommended) {
				goTo("https");
				return;
			}
			goTo("import", { text: t("onboarding_flow.cloud_ready"), tone: "ok" });
		} catch (error) {
			setNotice({
				text: errorMessage(error, t("onboarding_flow.error_fallback")),
				tone: "error",
			});
		}
	}

	async function importLocalHistory() {
		if (!api) return;
		setNotice({ text: t("onboarding_flow.importing") });
		try {
			const result =
				mode === "cloud"
					? await api.uploadLocalHistory()
					: await api.importLocalHistory();
			setLastImportResult(result);
			goTo("summary", {
				text: t("onboarding_flow.imported", { count: getImportCount(result) }),
				tone: "ok",
			});
		} catch (error) {
			setNotice({
				text: errorMessage(error, t("onboarding_flow.error_fallback")),
				tone: "error",
			});
		}
	}

	async function summarizeBatch() {
		if (!api) return;
		setNotice({ text: t("onboarding_flow.generating") });
		try {
			const result = await api.summarizeBatch({
				mode,
				conversationIds: getSummarizationCandidateIds(lastImportResult),
			});
			goTo("mcp", {
				text: t("onboarding_flow.generated", {
					count: result?.summarizedCount || 0,
				}),
				tone: "ok",
			});
		} catch (error) {
			setNotice({
				text: errorMessage(error, t("onboarding_flow.error_fallback")),
				tone: "error",
			});
		}
	}

	async function copyMcpSnippet() {
		try {
			await navigator.clipboard.writeText(mcpSnippet);
			setNotice({ text: t("onboarding_flow.copied"), tone: "ok" });
		} catch (error) {
			setNotice({
				text: errorMessage(error, t("onboarding_flow.error_fallback")),
				tone: "error",
			});
		}
	}

	async function finishSetup() {
		if (!api) return;
		try {
			await api.openApp(mode);
			goTo("done");
		} catch (error) {
			setNotice({
				text: errorMessage(error, t("onboarding_flow.error_fallback")),
				tone: "error",
			});
		}
	}

	function renderPanel() {
		if (!api) {
			return (
				<p className="text-sm leading-6 text-muted-foreground">
					{t("onboarding_flow.missing_api_description")}
				</p>
			);
		}

		if (screen === "cloud") {
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-muted-foreground">
						{t("onboarding_flow.cloud_form_description")}
					</p>
					<label className="block" htmlFor={cloudBaseUrlId}>
						<span className="mb-1.5 block text-sm text-muted-foreground">
							{t("onboarding_flow.base_url")}
						</span>
						<Input
							id={cloudBaseUrlId}
							type="url"
							autoComplete="url"
							value={cloudDraft.baseUrl}
							placeholder="https://example.com"
							onChange={(event) =>
								setCloudDraft((draft) => ({
									...draft,
									baseUrl: event.target.value,
								}))
							}
						/>
					</label>
					<label className="block" htmlFor={cloudTokenId}>
						<span className="mb-1.5 block text-sm text-muted-foreground">
							{t("onboarding_flow.token")}
						</span>
						<Input
							id={cloudTokenId}
							type="password"
							autoComplete="off"
							value={cloudDraft.token}
							placeholder={t("onboarding_flow.token_placeholder")}
							onChange={(event) =>
								setCloudDraft((draft) => ({
									...draft,
									token: event.target.value,
								}))
							}
						/>
					</label>
					<Notice notice={notice} />
					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="outline" onClick={() => goTo("mode")}>
							{t("onboarding_flow.back")}
						</Button>
						<Button type="button" onClick={() => void saveCloudConnection()}>
							{t("onboarding_flow.continue")}
						</Button>
					</div>
				</div>
			);
		}

		if (screen === "https") {
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-muted-foreground">
						{t("onboarding_flow.https_description")}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="outline" onClick={() => goTo("cloud")}>
							{t("onboarding_flow.back")}
						</Button>
						<Button
							type="button"
							onClick={() =>
								goTo("import", {
									text: t("onboarding_flow.cloud_ready"),
									tone: "ok",
								})
							}
						>
							{t("onboarding_flow.continue_anyway")}
						</Button>
					</div>
				</div>
			);
		}

		if (screen === "import") {
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-muted-foreground">
						{t("onboarding_flow.import_description")}
					</p>
					<Notice notice={notice} />
					<div className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => void importLocalHistory()}>
							{t("onboarding_flow.import_local")}
						</Button>
						<Button type="button" variant="outline" onClick={() => goTo("mcp")}>
							{t("onboarding_flow.skip_import")}
						</Button>
					</div>
				</div>
			);
		}

		if (screen === "summary") {
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-muted-foreground">
						{t("onboarding_flow.summary_description")}
					</p>
					<Notice notice={notice} />
					<div className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => void summarizeBatch()}>
							{t("onboarding_flow.generate_notes")}
						</Button>
						<Button type="button" variant="outline" onClick={() => goTo("mcp")}>
							{t("onboarding_flow.skip_summary")}
						</Button>
					</div>
				</div>
			);
		}

		if (screen === "mcp") {
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-muted-foreground">
						{t("onboarding_flow.mcp_description")}
					</p>
					<Notice notice={notice} />
					{mcpSnippet && (
						<pre className="max-h-72 overflow-auto rounded-md border border-border bg-code p-3 text-xs leading-6 text-foreground">
							{mcpSnippet}
						</pre>
					)}
					<div className="flex flex-wrap gap-2">
						{mcpSnippet && (
							<Button
								type="button"
								variant="outline"
								onClick={() => void copyMcpSnippet()}
							>
								{t("onboarding_flow.copy_config")}
							</Button>
						)}
						<Button type="button" onClick={() => void finishSetup()}>
							{t("onboarding_flow.open_app")}
						</Button>
					</div>
				</div>
			);
		}

		if (screen === "done") {
			return (
				<div className="flex flex-col gap-4">
					<p className="text-sm leading-6 text-muted-foreground">
						{t("onboarding_flow.done_description")}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => void finishSetup()}>
							{t("onboarding_flow.open_app")}
						</Button>
					</div>
				</div>
			);
		}

		return (
			<div className="flex flex-col gap-4">
				{isPreview && (
					<Notice
						notice={{
							text: t("onboarding_flow.preview_notice"),
							tone: "warning",
						}}
					/>
				)}
				{initialError && (
					<Notice
						notice={{
							text: t("onboarding_flow.initial_error", { message: initialError }),
							tone: "error",
						}}
					/>
				)}
				<p className="text-sm leading-6 text-muted-foreground">
					{t("onboarding_flow.mode_description")}
				</p>
				<div className="grid gap-2 sm:grid-cols-2">
					<button
						type="button"
						className="min-h-28 rounded-md border border-border bg-secondary p-4 text-left text-foreground transition hover:border-[var(--accent)] hover:bg-muted"
						onClick={() => void startLocal()}
					>
						<strong className="block text-sm font-semibold">
							{t("onboarding_flow.local_title")}
						</strong>
						<span className="mt-2 block text-xs leading-5 text-muted-foreground">
							{t("onboarding_flow.local_description")}
						</span>
					</button>
					<button
						type="button"
						className="min-h-28 rounded-md border border-border bg-secondary p-4 text-left text-foreground transition hover:border-[var(--accent)] hover:bg-muted"
						onClick={() => goTo("cloud")}
					>
						<strong className="block text-sm font-semibold">
							{t("onboarding_flow.cloud_title")}
						</strong>
						<span className="mt-2 block text-xs leading-5 text-muted-foreground">
							{t("onboarding_flow.cloud_description")}
						</span>
					</button>
				</div>
				<Notice notice={notice} />
			</div>
		);
	}

	return (
		<AccessShell
			eyebrow={t("onboarding_flow.hero_kicker")}
			eyebrowIcon={<Cloud className="size-3.5 text-accent" aria-hidden="true" />}
			title={t("onboarding_flow.hero_title")}
			description={t("onboarding_flow.hero_copy")}
			statusCards={[
				{
					icon: <Database className="size-4" aria-hidden="true" />,
					label: t("onboarding_flow.status_local"),
				},
				{
					icon: <ShieldCheck className="size-4" aria-hidden="true" />,
					label: t("onboarding_flow.status_secure"),
				},
				{
					icon: <KeyRound className="size-4" aria-hidden="true" />,
					label: t("onboarding_flow.status_ready"),
				},
			]}
			panelKicker={t("onboarding_flow.panel_kicker")}
			panelTitle={api ? t(panelTitleKey) : t("onboarding_flow.missing_api_title")}
			selectedLanguage={selectedLanguage}
			onLanguageChange={(value) => void i18n.changeLanguage(value)}
			windowControls={windowControls}
			showWindowControls
		>
			{renderPanel()}
		</AccessShell>
	);
}
