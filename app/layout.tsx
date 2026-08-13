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
import "./sql-source-portal.css";
import "./bottleneck-live-panel.css";
import UploadArchiveGuard from "./upload-archive-guard";
import ObjectivesDailyPatch from "./objectives-daily-patch";
import FinanceSourcePortal from "./finance-source-portal";
import FinanceTrendPanel from "./finance-trend-panel";
import PilotageNav from "./pilotage-nav";
import SqlSourcePortal from "./sql-source-portal";
import FtpTerminologyPatch from "./ftp-terminology-patch";
import PeriodDefaultPatch from "./period-default-patch";
import BottleneckLivePanel from "./bottleneck-live-panel";

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
    <SqlSourcePortal />
    <FinanceTrendPanel />
    <PilotageNav />
    <FtpTerminologyPatch />
    <PeriodDefaultPatch />
    <BottleneckLivePanel />
    {children}
    <a className="global-book-launch" href="/book">BOOK D&apos;ANIMATION PDF</a>
    <style>{`
      .global-book-launch {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 90;
        display: none;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 12px;
        background: #004f9f;
        color: #fff;
        text-decoration: none;
        font-family: Exo, Arial, sans-serif;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .03em;
        box-shadow: 0 12px 28px rgba(0,79,159,.24);
        border: 1px solid rgba(255,255,255,.18);
      }
      body:has(#nav-today.active) .global-book-launch { display: inline-flex; }
      .global-book-launch:hover { background: #0068b5; transform: translateY(-1px); }
      @media (max-width: 760px) {
        .global-book-launch { right: 14px; bottom: 76px; min-height: 40px; padding: 0 13px; font-size: 10px; }
      }
      @media print { .global-book-launch { display: none !important; } }
    `}</style>
  </body></html>;
}
