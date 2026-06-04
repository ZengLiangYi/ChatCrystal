import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AUTH_CHANGED_EVENT,
	api,
	getStoredToken,
	setStoredToken,
} from "@/lib/api.ts";
import { AuthGateScreen } from "@/components/AuthGateScreen.tsx";

type GateState =
	| { status: "loading"; providerWarnings: string[] }
	| { status: "ready"; providerWarnings: string[] }
	| { status: "token"; providerWarnings: string[] }
	| { status: "setup"; providerWarnings: string[] };

export function AuthGate({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const authErrorFallbackRef = useRef(t("auth.error"));
	const [state, setState] = useState<GateState>({ status: "loading", providerWarnings: [] });
	const [setupCode, setSetupCode] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		authErrorFallbackRef.current = t("auth.error");
	}, [t]);

	const refresh = useCallback(async () => {
		setError(null);
		setState((current) => ({ status: "loading", providerWarnings: current.providerWarnings }));
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
			setError(err instanceof Error ? err.message : authErrorFallbackRef.current);
			setState({ status: "token", providerWarnings: [] });
		}
	}, []);

	useEffect(() => {
		refresh();
		window.addEventListener(AUTH_CHANGED_EVENT, refresh);
		return () => window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
	}, [refresh]);

	async function submit() {
		setSubmitting(true);
		setError(null);
		try {
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
		<AuthGateScreen
			status={state.status}
			providerWarnings={state.providerWarnings}
			setupCode={setupCode}
			token={token}
			error={error}
			submitting={submitting}
			onSetupCodeChange={setSetupCode}
			onTokenChange={setToken}
			onSubmit={submit}
			onRetry={refresh}
		/>
	);
}
