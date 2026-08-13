import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CRVO Direction",
  description: "Écran direction du CRVO Lens : production, facturation et vieillissement du parc.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CRVO Direction",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/crvo-logo.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
  },
};

export default function DirectionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
