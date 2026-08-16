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
import DataTrustGuard from "./data-trust-guard";
import AuthNav from "./auth-nav";

export const metadata: Metadata = {
  title: "KPI CRVO",
  description: "Plateforme de pilotage opérationnel et de visualisation des données du CRVO.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>
    <GlobalNavDrawer />
    <DataTrustGuard />
    <AuthNav />
    {children}
  </body></html>;
}
