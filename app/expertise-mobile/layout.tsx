import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "CRVO Expertise Mobile",
  description: "Saisie mobile des dossiers expertise CRVO.",
  manifest: "/expertise-mobile.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CRVO Expertise",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#004f9f",
};

export default function ExpertiseMobileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
