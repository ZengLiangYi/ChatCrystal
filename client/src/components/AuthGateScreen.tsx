import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	Cloud,
	Database,
	KeyRound,
	Loader2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";

import { AccessShell } from "@/components/AccessShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getSelectedLanguageCode } from "@/i18n/language";

type AuthGateScreenStatus = "loading" | "setup" | "token";

export function AuthGateScreen({
	status,
	providerWarnings,
	setupCode,
	token,
	error,
	submitting,
	onSetupCodeChange,
	onTokenChange,
	onSubmit,
	onRetry,
}: {
	status: AuthGateScreenStatus;
	providerWarnings: string[];
	setupCode: string;
	token: string;
	error: string | null;
	submitting: boolean;
	onSetupCodeChange: (value: string) => void;
	onTokenChange: (value: string) => void;
	onSubmit: () => void;
	onRetry: () => void;
}) {
	const { t, i18n } = useTranslation();
	const setupCodeId = useId();
	const tokenId = useId();
	const isSetup = status === "setup";
	const selectedLanguage =
		getSelectedLanguageCode(i18n.resolvedLanguage ?? i18n.language) ?? "en";
	const submitDisabled =
		submitting || token.trim().length === 0 || (isSetup && setupCode.trim().length === 0);

	return (
		<AccessShell
			eyebrow={t("auth.status_memory")}
			eyebrowIcon={<Cloud className="size-3.5 text-accent" aria-hidden="true" />}
			title={t("auth.title")}
			description={isSetup ? t("auth.setup_hint") : t("auth.token_hint")}
			statusCards={[
				{
					icon: <Database className="size-4" aria-hidden="true" />,
					label: t("auth.status_index"),
				},
				{
					icon: <ShieldCheck className="size-4" aria-hidden="true" />,
					label: t("auth.status_secure"),
				},
				{
					icon: <KeyRound className="size-4" aria-hidden="true" />,
					label: t("auth.status_ready"),
				},
			]}
			panelKicker={t("auth.form_title")}
			panelTitle={t("auth.title")}
			selectedLanguage={selectedLanguage}
			onLanguageChange={(value) => void i18n.changeLanguage(value)}
		>
			{providerWarnings.length > 0 && (
				<Alert className="mb-4 border-border bg-background text-warning">
					<AlertTriangle aria-hidden="true" />
					<AlertTitle>{t("auth.warning_title")}</AlertTitle>
					<AlertDescription className="text-warning">
						{providerWarnings.map((warning) => (
							<p key={warning}>{warning}</p>
						))}
					</AlertDescription>
				</Alert>
			)}

			<div className="flex flex-col gap-4">
				{isSetup && (
					<label className="block" htmlFor={setupCodeId}>
						<span className="mb-1.5 block text-sm text-muted-foreground">
							{t("auth.setup_code")}
						</span>
						<Input
							id={setupCodeId}
							value={setupCode}
							onChange={(event) => onSetupCodeChange(event.target.value)}
							autoComplete="one-time-code"
						/>
					</label>
				)}

				<label className="block" htmlFor={tokenId}>
					<span className="mb-1.5 block text-sm text-muted-foreground">
						{t("auth.token")}
					</span>
					<Input
						id={tokenId}
						type="password"
						value={token}
						onChange={(event) => onTokenChange(event.target.value)}
						autoComplete="current-password"
					/>
				</label>
			</div>

			{error && (
				<Alert variant="destructive" className="mt-4">
					<AlertTriangle aria-hidden="true" />
					<AlertTitle>{t("auth.error")}</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<Separator className="my-6" />

			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" disabled={submitDisabled} onClick={onSubmit}>
					{submitting && (
						<Loader2
							data-icon="inline-start"
							className="animate-spin"
							aria-hidden="true"
						/>
					)}
					{submitting ? t("status.submitting") : t("auth.submit")}
				</Button>
				<Button type="button" variant="outline" onClick={onRetry}>
					<RefreshCw data-icon="inline-start" aria-hidden="true" />
					{t("action.retry")}
				</Button>
			</div>
		</AccessShell>
	);
}
