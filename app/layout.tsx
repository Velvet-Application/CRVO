import type { Metadata } from "next";
import "@fontsource/exo/300.css";
import "@fontsource/exo/400.css";
import "@fontsource/exo/600.css";
import "@fontsource/exo/700.css";
import "@fontsource/exo/800.css";
import "@fontsource/exo/800-italic.css";
import "./globals.css";
import "./dashboard-additions.css";
import "./sector-colors.css";
import "./finance-source-portal.css";
import "./finance-trend-panel.css";
import "./bottleneck-live-panel.css";
import UploadArchiveGuard from "./upload-archive-guard";
import ObjectivesDailyPatch from "./objectives-daily-patch";
import FinanceSourcePortal from "./finance-source-portal";
import FinanceTrendPanel from "./finance-trend-panel";
import PilotageNav from "./pilotage-nav";
import GlobalNavDrawer from "./global-nav-drawer";
import FtpTerminologyPatch from "./ftp-terminology-patch";
import PeriodDefaultPatch from "./period-default-patch";
import BottleneckLivePanel from "./bottleneck-live-panel";
import AuthNav from "./auth-nav";
import DashboardClientScopePatch from "./dashboard-client-scope-patch";
import EmailSourcePatch from "./email-source-patch";

export const metadata: Metadata = {
  title: "KPI CRVO",
  description: "Plateforme de pilotage opérationnel et de visualisation des données du CRVO.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>
    <UploadArchiveGuard />
    <ObjectivesDailyPatch />
    <FinanceSourcePortal />
    <FinanceTrendPanel />
    <PilotageNav />
    <GlobalNavDrawer />
    <FtpTerminologyPatch />
    <PeriodDefaultPatch />
    <BottleneckLivePanel />
    <AuthNav />
    <DashboardClientScopePatch />
    <EmailSourcePatch />
    {children}
  </body></html>;
}
