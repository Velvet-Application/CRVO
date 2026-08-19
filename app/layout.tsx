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
import GlobalNavDrawer from "./global-nav-drawer-v2";
import HomeSideMenu from "./home-side-menu-v2";
import DataTrustGuard from "./data-trust-guard";
import AuthNav from "./auth-nav";
import ActivityColorBinder from "./activity-color-binder";
import KioskFetchBridge from "./kiosk-fetch-bridge";
import PwaRegister from "./pwa-register";
import DailyAnimationLauncher from "./daily-animation-launcher";

export const metadata: Metadata = {
  title: "KPI CRVO",
  applicationName: "KPI CRVO Lens",
  description: "Plateforme de pilotage opérationnel et de visualisation des données du CRVO.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "KPI CRVO",
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
    <GlobalNavDrawer />
    <HomeSideMenu />
    <DataTrustGuard />
    <AuthNav />
    <DailyAnimationLauncher />
    {children}
  </body></html>;
}
