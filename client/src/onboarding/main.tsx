import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/i18n";
import "@/index.css";
import { OnboardingApp } from "@/onboarding/OnboardingApp";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<OnboardingApp />
	</StrictMode>,
);
