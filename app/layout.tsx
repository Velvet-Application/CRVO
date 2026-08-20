import type { Metadata } from "next";
import "@fontsource/exo/300.css";
import "@fontsource/exo/400.css";
import "@fontsource/exo/600.css";
import "@fontsource/exo/700.css";
import "@fontsource/exo/800.css";
import "@fontsource/exo/800-italic.css";
import "./globals.css";
import "./production-fixes.css";
import "./expertise-workspace-fixes.css";
import ToolboxShell from "./toolbox-shell";
import DataTrustGuard from "./data-trust-guard";
import ActivityColorBinder from "./activity-color-binder";
import KioskFetchBridge from "./kiosk-fetch-bridge";
import PwaRegister from "./pwa-register";
import DailyAnimationOneClick from "./daily-animation-one-click-v2";
import TransphereAccessManager from "./transphere-access-manager";
import WorktimeAnnualizationPanel from "./worktime-annualization-panel";
import AtelierPublicScreen from "./atelier-public-screen";
import FriendlyLoadingPatch from "./friendly-loading-patch";

export const metadata: Metadata = {
  title: "ToolBox CRVO Lens",
  applicationName: "ToolBox CRVO Lens",
  description: "Plateforme métiers du CRVO Lens : pilotage, relation client, RH, administration et Transphère.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ToolBox CRVO",
    statusBarStyle: "default",
  },
  other: {
    "codex-preview": "development",
    "mobile-web-app-capable": "yes",
  },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/pwa-icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>
    <PwaRegister />
    <KioskFetchBridge />
    <ActivityColorBinder />
    <FriendlyLoadingPatch />
    <ToolboxShell />
    <DataTrustGuard />
    <DailyAnimationOneClick />
    <TransphereAccessManager />
    <WorktimeAnnualizationPanel />
    <AtelierPublicScreen />
    {children}
  </body></html>;
}
