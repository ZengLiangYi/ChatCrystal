import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AUTH_CHANGED_EVENT,
	api,
	assertSafeWebAuthTransport,
	getStoredToken,
	isInsecureRemoteHttpLocation,
	setStoredToken,
} from "@/lib/api.ts";

type GateState =
	| { status: "loading"; providerWarnings: string[] }
	| { status: "ready"; providerWarnings: string[] }
	| { status: "token"; providerWarnings: string[] }
	| { status: "setup"; providerWarnings: string[] };

export function AuthGate({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const [state, setState] = useState<GateState>({ status: "loading", providerWarnings: [] });
	const [setupCode, setSetupCode] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const refresh = useCallback(async () => {
		setError(null);
		setState((current) => ({ status: "loading", providerWarnings: current.providerWarnings }));
		if (getStoredToken() && isInsecureRemoteHttpLocation()) {
			setError(t("auth.insecure_http"));
			setState({ status: "token", providerWarnings: [] });
			return;
		}
		try {
			const status = await api.getSetupStatus();
			if (!status.cloudMode || status.authenticated) {
				setState({ status: "ready", providerWarnings: status.providerWarnings });
			} else if (status.setupRequired) {
				setState({ status: "setup", providerWarnings: status.providerWarnings });
			} else if (getStoredToken()) {
				try {
					await api.verifyToken();
					setState({ status: "ready", providerWarnings: status.providerWarnings });
				} catch {
					setState({ status: "token", providerWarnings: status.providerWarnings });
				}
			} else {
				setState({ status: "token", providerWarnings: status.providerWarnings });
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("auth.error"));
			setState({ status: "token", providerWarnings: [] });
		}
	}, [t]);

	useEffect(() => {
		refresh();
		window.addEventListener(AUTH_CHANGED_EVENT, refresh);
		return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
	}, [refresh]);

	async function submit() {
		setSubmitting(true);
		setError(null);
		try {
			if (isInsecureRemoteHttpLocation()) {
				setError(t("auth.insecure_http"));
				return;
			}
			assertSafeWebAuthTransport();
			if (state.status === "setup") {
				await api.completeSetup({ setupCode, token });
			} else {
				setStoredToken(token);
				await api.verifyToken();
			}
			setStoredToken(token);
			setState({ status: "ready", providerWarnings: state.providerWarnings });
		} catch (err) {
			setError(err instanceof Error ? err.message : t("auth.error"));
		} finally {
			setSubmitting(false);
		}
	}

	if (state.status === "ready") return <>{children}</>;

	return (
		<div className="flex min-h-screen w-screen items-center justify-center bg-primary px-4 py-8">
			<div className="w-full max-w-md rounded-md border border-theme bg-secondary p-5 shadow-xl">
				<div className="mb-5">
					<p className="text-sm text-muted">{t("brand.tagline")}</p>
					<h1 className="mt-1 text-2xl font-semibold text-primary">{t("auth.title")}</h1>
					<p className="mt-2 text-sm leading-6 text-secondary">
						{state.status === "setup" ? t("auth.setup_hint") : t("auth.token_hint")}
					</p>
				</div>

				{state.providerWarnings.length > 0 && (
					<div className="mb-4 rounded-md border border-theme bg-tertiary p-3 text-sm text-warning">
						{state.providerWarnings.map((warning) => <p key={warning}>{warning}</p>)}
					</div>
				)}

				{state.status === "setup" && (
					<label className="mb-3 block">
						<span className="mb-1 block text-sm text-secondary">{t("auth.setup_code")}</span>
						<input
							className="w-full rounded-md border border-theme bg-primary px-3 py-2 text-primary outline-none focus:border-[var(--accent)]"
							value={setupCode}
							onChange={(event) => setSetupCode(event.target.value)}
							autoComplete="one-time-code"
						/>
					</label>
				)}

				<label className="mb-4 block">
					<span className="mb-1 block text-sm text-secondary">{t("auth.token")}</span>
					<input
						className="w-full rounded-md border border-theme bg-primary px-3 py-2 text-primary outline-none focus:border-[var(--accent)]"
						type="password"
						value={token}
						onChange={(event) => setToken(event.target.value)}
						autoComplete="current-password"
					/>
				</label>

				{error && <p className="mb-4 text-sm text-error">{error}</p>}

				<div className="flex items-center gap-3">
					<button
						type="button"
						className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-60"
						disabled={submitting || token.trim().length === 0 || (state.status === "setup" && setupCode.trim().length === 0)}
						onClick={submit}
					>
						{submitting ? t("status.submitting") : t("auth.submit")}
					</button>
					<button
						type="button"
						className="rounded-md border border-theme px-4 py-2 text-sm text-secondary"
						onClick={refresh}
					>
						{t("action.retry")}
					</button>
				</div>
			</div>
		</div>
	);
}
