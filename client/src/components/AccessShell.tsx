import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	Languages,
	Minus,
	PanelTopOpen,
	Square,
	X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	ToggleGroup,
	ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
	getSelectedLanguageCode,
	LANGUAGE_OPTIONS,
} from "@/i18n/language";
import { dawnHaze } from "@/themes/dawn-haze";
import { themeToCSSVars } from "@/themes/theme.types";

export type AccessShellStatusCard = {
	icon: ReactNode;
	label: string;
};

type AccessShellProps = {
	eyebrow: string;
	eyebrowIcon: ReactNode;
	title: string;
	description: string;
	statusCards: AccessShellStatusCard[];
	panelKicker: string;
	panelTitle: string;
	selectedLanguage: string;
	onLanguageChange: (language: string) => void;
	children: ReactNode;
	windowControls?: ChatCrystalWindowControls;
	showWindowControls?: boolean;
};

const accessThemeVars = {
	...themeToCSSVars(dawnHaze),
	"--background": "var(--bg-primary)",
	"--foreground": "var(--text-primary)",
	"--card": "var(--bg-secondary)",
	"--card-foreground": "var(--text-primary)",
	"--popover": "var(--bg-secondary)",
	"--popover-foreground": "var(--text-primary)",
	"--primary-foreground": "var(--accent-foreground)",
	"--secondary": "var(--bg-tertiary)",
	"--secondary-foreground": "var(--text-primary)",
	"--muted": "var(--bg-tertiary)",
	"--muted-foreground": "var(--text-muted)",
	"--destructive": "var(--error)",
	"--destructive-foreground": "var(--error-foreground)",
	"--input": "var(--border)",
	"--ring": "var(--accent)",
	"--radius-sm": "calc(var(--radius) - 2px)",
	"--radius-md": "var(--radius)",
	"--radius-lg": "calc(var(--radius) + 2px)",
	"--radius-xl": "calc(var(--radius) + 4px)",
	colorScheme: "light",
} as CSSProperties;

export function AccessShell({
	eyebrow,
	eyebrowIcon,
	title,
	description,
	statusCards,
	panelKicker,
	panelTitle,
	selectedLanguage,
	onLanguageChange,
	children,
	windowControls,
	showWindowControls = false,
}: AccessShellProps) {
	const { t } = useTranslation();
	const [isMaximized, setIsMaximized] = useState(false);
	const activeLanguage = getSelectedLanguageCode(selectedLanguage) ?? "en";

	useEffect(() => {
		if (!windowControls) return;
		let mounted = true;
		windowControls.isMaximized().then((value) => {
			if (mounted) setIsMaximized(value);
		});
		const unsubscribe = windowControls.onMaximizedChange((value) => {
			setIsMaximized(value);
		});
		return () => {
			mounted = false;
			unsubscribe();
		};
	}, [windowControls]);

	return (
		<div
			className="relative grid min-h-screen w-screen bg-primary text-primary lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]"
			style={accessThemeVars}
		>
			<header className="app-drag-region absolute inset-x-0 top-0 z-20 flex h-11 items-center justify-between">
				<div className="flex h-full items-center gap-2.5 px-6 lg:px-8">
					<img
						src="/icon.png"
						alt=""
						className="size-7 rounded-md"
						draggable={false}
					/>
					<span className="text-sm font-semibold text-foreground">
						{t("brand.name")}
					</span>
				</div>
				{showWindowControls && (
					<div className="app-no-drag flex h-full shrink-0 items-center">
						<button
							type="button"
							className="window-control-button"
							title={t("window.minimize")}
							aria-label={t("window.minimize")}
							onClick={() => void windowControls?.minimize()}
						>
							<Minus size={15} aria-hidden="true" />
						</button>
						<button
							type="button"
							className="window-control-button"
							title={isMaximized ? t("window.restore") : t("window.maximize")}
							aria-label={isMaximized ? t("window.restore") : t("window.maximize")}
							onClick={() => void windowControls?.toggleMaximize()}
						>
							{isMaximized ? (
								<PanelTopOpen size={14} aria-hidden="true" />
							) : (
								<Square size={13} aria-hidden="true" />
							)}
						</button>
						<button
							type="button"
							className="window-control-button window-control-close"
							title={t("window.close")}
							aria-label={t("window.close")}
							onClick={() => void windowControls?.close()}
						>
							<X size={15} aria-hidden="true" />
						</button>
					</div>
				)}
			</header>

			<section className="flex min-h-[360px] flex-col justify-between px-8 pt-20 pb-8 lg:min-h-screen lg:px-12 lg:pt-16 lg:pb-10">
				<div />
				<div className="my-12 max-w-2xl lg:my-0">
					<div className="mb-5 inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
						{eyebrowIcon}
						<span>{eyebrow}</span>
					</div>
					<h1 className="text-3xl font-semibold text-foreground md:text-4xl">
						{title}
					</h1>
					<p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
						{description}
					</p>
				</div>

				<div className="grid max-w-2xl gap-2 sm:grid-cols-3">
					{statusCards.map((card) => (
						<div
							key={card.label}
							className="rounded-md border border-border bg-secondary/70 p-3"
						>
							<div className="mb-2 text-accent">{card.icon}</div>
							<p className="text-sm font-medium text-foreground">{card.label}</p>
						</div>
					))}
				</div>
			</section>

			<section className="flex min-h-screen items-center border-t border-border bg-secondary/60 px-6 py-8 lg:border-l lg:border-t-0 lg:px-10">
				<div className="w-full">
					<div className="mb-6 flex items-start justify-between gap-4">
						<div className="min-w-0">
							<p className="text-xs font-medium text-muted-foreground">
								{panelKicker}
							</p>
							<h2 className="mt-2 text-xl font-semibold text-foreground">
								{panelTitle}
							</h2>
						</div>
						<div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
							<Languages className="size-3.5" aria-hidden="true" />
							<ToggleGroup
								type="single"
								value={activeLanguage}
								onValueChange={(value) => {
									if (value) onLanguageChange(value);
								}}
								variant="outline"
								size="sm"
								spacing={0}
								aria-label={t("access.language_switch")}
							>
								{LANGUAGE_OPTIONS.map((code) => (
									<ToggleGroupItem
										key={code}
										value={code}
										aria-label={t(`language_name.${code}`)}
										className="min-w-8 px-2 data-[state=on]:border-[var(--accent)] data-[state=on]:text-accent"
									>
										{t(`language_short.${code}`)}
									</ToggleGroupItem>
								))}
							</ToggleGroup>
						</div>
					</div>
					{children}
				</div>
			</section>
		</div>
	);
}
