import type { Metadata } from "next";
import "@fontsource/exo/300.css";
import "@fontsource/exo/400.css";
import "@fontsource/exo/600.css";
import "@fontsource/exo/700.css";
import "@fontsource/exo/800.css";
import "@fontsource/exo/800-italic.css";
import "./globals.css";
import "./production-fixes.css";
import GlobalNavDrawer from "./global-nav-drawer";
import HomeSideMenu from "./home-side-menu";
import DataTrustGuard from "./data-trust-guard";
import AuthNav from "./auth-nav";
import ActivityColorBinder from "./activity-color-binder";
import KioskFetchBridge from "./kiosk-fetch-bridge";

export const metadata: Metadata = {
  title: "KPI CRVO",
  description: "Plateforme de pilotage opérationnel et de visualisation des données du CRVO.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>
    <KioskFetchBridge />
    <ActivityColorBinder />
    <GlobalNavDrawer />
    <HomeSideMenu />
    <DataTrustGuard />
    <AuthNav />
    {children}
  </body></html>;
}
