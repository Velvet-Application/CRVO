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
import "./operational-source-portal.css";
import "./bottleneck-live-panel.css";
import "./walking-live-panel.css";
import "./data-freshness-guard.css";
import UploadArchiveGuard from "./upload-archive-guard";
import ObjectivesDailyPatch from "./objectives-daily-patch";
import FinanceSourcePortal from "./finance-source-portal";
import FinanceTrendPanel from "./finance-trend-panel";
import PilotageNav from "./pilotage-nav";
import SqlSourcePortal from "./sql-source-portal";
import OperationalSourcePortal from "./operational-source-portal";
import BottleneckLivePanel from "./bottleneck-live-panel";
import WalkingLivePanel from "./walking-live-panel";
import DataFreshnessGuard from "./data-freshness-guard";

export const metadata: Metadata = {
  title: "KPI CRVO",
  description: "Plateforme de pilotage opérationnel et de visualisation des données du CRVO.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

const clientFallbackSnapshots = [
  { date: "2026-08-03", label: "03 août 2026", source: "Book CRVO Lens - Journée du 03.08.2026.xlsx", entries: 50, exits: 87, stock: 1146, over15: 508, over20: 418, production: [{ name: "Expertise", value: 83, tone: "coral" }, { name: "Mécanique", value: 83, tone: "green" }, { name: "DSP", value: 25, tone: "cyan" }, { name: "Carrosserie", value: 13, tone: "red" }, { name: "Préparation", value: 85, tone: "purple" }, { name: "Qualité", value: 91, tone: "orange" }, { name: "Sortie usine", value: 87, tone: "blue" }] },
  { date: "2026-08-04", label: "04 août 2026", source: "Book CRVO Lens - Journée du 04.08.2026.xlsx", entries: 54, exits: 91, stock: 1139, over15: 476, over20: 392, production: [{ name: "Expertise", value: 86, tone: "coral" }, { name: "Mécanique", value: 91, tone: "green" }, { name: "DSP", value: 26, tone: "cyan" }, { name: "Carrosserie", value: 17, tone: "red" }, { name: "Préparation", value: 91, tone: "purple" }, { name: "Qualité", value: 91, tone: "orange" }, { name: "Sortie usine", value: 91, tone: "blue" }] },
  { date: "2026-08-05", label: "05 août 2026", source: "Book CRVO Lens - Journée du 05.08.2026.xlsx", entries: 79, exits: 84, stock: 1129, over15: 475, over20: 395, production: [{ name: "Expertise", value: 72, tone: "coral" }, { name: "Mécanique", value: 84, tone: "green" }, { name: "DSP", value: 32, tone: "cyan" }, { name: "Carrosserie", value: 18, tone: "red" }, { name: "Préparation", value: 84, tone: "purple" }, { name: "Qualité", value: 85, tone: "orange" }, { name: "Sortie usine", value: 84, tone: "blue" }] },
  { date: "2026-08-06", label: "06 août 2026", source: "Book CRVO Lens - Journée du 06.08.2026.xlsx", entries: 47, exits: 96, stock: 1094, over15: 474, over20: 402, production: [{ name: "Expertise", value: 77, tone: "coral" }, { name: "Mécanique", value: 95, tone: "green" }, { name: "DSP", value: 22, tone: "cyan" }, { name: "Carrosserie", value: 12, tone: "red" }, { name: "Préparation", value: 92, tone: "purple" }, { name: "Qualité", value: 91, tone: "orange" }, { name: "Sortie usine", value: 96, tone: "blue" }] },
  { date: "2026-08-07", label: "07 août 2026", source: "Book CRVO Lens - Journée du 07.08.2026.xlsx", entries: 78, exits: 86, stock: 1097, over15: 494, over20: 399, production: [{ name: "Expertise", value: 80, tone: "coral" }, { name: "Mécanique", value: 96, tone: "green" }, { name: "DSP", value: 24, tone: "cyan" }, { name: "Carrosserie", value: 11, tone: "red" }, { name: "Préparation", value: 89, tone: "purple" }, { name: "Qualité", value: 88, tone: "orange" }, { name: "Sortie usine", value: 86, tone: "blue" }] },
  { date: "2026-08-10", label: "10 août 2026", source: "Book CRVO Lens - Journée du 10.08.2026.xlsx", entries: 62, exits: 92, stock: 1092, over15: 467, over20: 391, production: [{ name: "Expertise", value: 76, tone: "coral" }, { name: "Mécanique", value: 77, tone: "green" }, { name: "DSP", value: 28, tone: "cyan" }, { name: "Carrosserie", value: 5, tone: "red" }, { name: "Préparation", value: 87, tone: "purple" }, { name: "Qualité", value: 93, tone: "orange" }, { name: "Sortie usine", value: 92, tone: "blue" }] },
  { date: "2026-08-11", label: "11 août 2026", source: "Book CRVO Lens - Journée du 11.08.2026.xlsx", entries: 42, exits: 108, stock: 1069, over15: 470, over20: 379, production: [{ name: "Expertise", value: 68, tone: "coral" }, { name: "Mécanique", value: 82, tone: "green" }, { name: "DSP", value: 31, tone: "cyan" }, { name: "Carrosserie", value: 14, tone: "red" }, { name: "Préparation", value: 87, tone: "purple" }, { name: "Qualité", value: 91, tone: "orange" }, { name: "Sortie usine", value: 108, tone: "blue" }] },
  { date: "2026-08-12", label: "12 août 2026", source: "Book CRVO Lens - Journée du 12.08.2026.xlsx", entries: 8, exits: 94, stock: 1064, over15: 477, over20: 382, production: [{ name: "Expertise", value: 65, tone: "coral" }, { name: "Mécanique", value: 75, tone: "green" }, { name: "DSP", value: 27, tone: "cyan" }, { name: "Carrosserie", value: 10, tone: "red" }, { name: "Préparation", value: 83, tone: "purple" }, { name: "Qualité", value: 87, tone: "orange" }, { name: "Sortie usine", value: 94, tone: "blue" }] },
];

const dashboardFallbackScript = `(() => {
  const snapshots = ${JSON.stringify(clientFallbackSnapshots)};
  const originalFetch = window.fetch.bind(window);
  const fallback = (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input && typeof input.url === 'string' ? input.url : '';
    if (!raw.includes('/api/dashboard')) return null;
    const url = new URL(raw, window.location.origin);
    const requestedDate = url.searchParams.get('date');
    const snapshot = requestedDate ? snapshots.find((row) => row.date === requestedDate) || snapshots[snapshots.length - 1] : snapshots[snapshots.length - 1];
    return {
      connected: false,
      backend: 'client-embedded-history',
      sourceMode: 'book',
      latestSource: snapshot.source,
      snapshot: { ...snapshot, sourceMode: 'book' },
      snapshots: url.searchParams.get('history') === '1' ? snapshots.map((row) => ({ ...row, sourceMode: 'book' })) : undefined,
    };
  };
  window.fetch = async (...args) => {
    const local = fallback(args[0]);
    try {
      const response = await originalFetch(...args);
      if (response.ok || !local) return response;
    } catch (error) {
      if (!local) throw error;
    }
    console.warn('[CRVO] API dashboard indisponible : dernier Book validé utilisé côté client.');
    return new Response(JSON.stringify(local), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-CRVO-Fallback': 'book-2026-08-12' } });
  };
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><head><script dangerouslySetInnerHTML={{ __html: dashboardFallbackScript }} /></head><body>
    <UploadArchiveGuard />
    <ObjectivesDailyPatch />
    <FinanceSourcePortal />
    <OperationalSourcePortal />
    <SqlSourcePortal />
    <FinanceTrendPanel />
    <BottleneckLivePanel />
    <WalkingLivePanel />
    <DataFreshnessGuard />
    <PilotageNav />
    {children}
    <a className="global-book-launch" href="/book">BOOK D&apos;ANIMATION PDF</a>
    <style>{`
      .global-book-launch {
        position: fixed;
        right: 22px;
        bottom: 22px;
        z-index: 90;
        display: inline-flex;
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
      .global-book-launch:hover { background: #0068b5; transform: translateY(-1px); }
      @media (max-width: 760px) {
        .global-book-launch { right: 14px; bottom: 76px; min-height: 40px; padding: 0 13px; font-size: 10px; }
      }
      @media print { .global-book-launch { display: none !important; } }
    `}</style>
  </body></html>;
}
