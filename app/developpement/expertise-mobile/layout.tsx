import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CRVO Expertise Mobile",
  applicationName: "CRVO Expertise Mobile",
  description: "Saisie mobile PWA des dossiers expertise CRVO.",
  manifest: "/expertise-mobile.webmanifest",
  themeColor: "#004f9f",
  appleWebApp: {
    capable: true,
    title: "CRVO Expertise",
    statusBarStyle: "default",
  },
};

export default function ExpertiseMobileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
