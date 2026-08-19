"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const BASE_WIDTH = 1920;
const BASE_HEIGHT = 1080;

export default function AtelierPublicScreen() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/atelier") return;

    const body = document.body;
    body.classList.add("atelier-public-kiosk");

    const fit = () => {
      const scale = Math.min(window.innerWidth / BASE_WIDTH, window.innerHeight / BASE_HEIGHT);
      body.style.setProperty("--atelier-kiosk-scale", String(Math.max(scale, 0.1)));
    };

    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);

    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      body.classList.remove("atelier-public-kiosk");
      body.style.removeProperty("--atelier-kiosk-scale");
    };
  }, [pathname]);

  return <style>{`
    body.atelier-public-kiosk {
      margin: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      min-height: 100vh !important;
      overflow: hidden !important;
      background: #e8f0f5 !important;
    }

    body.atelier-public-kiosk main[class*="atelier_screen"] {
      box-sizing: border-box !important;
      position: fixed !important;
      left: 50% !important;
      top: 50% !important;
      width: 1920px !important;
      height: 1080px !important;
      min-height: 1080px !important;
      max-width: none !important;
      max-height: none !important;
      overflow: hidden !important;
      transform: translate(-50%, -50%) scale(var(--atelier-kiosk-scale, 1)) !important;
      transform-origin: center center !important;
    }

    body.atelier-public-kiosk .gn2-trigger,
    body.atelier-public-kiosk .gn2-backdrop,
    body.atelier-public-kiosk .gn2-drawer,
    body.atelier-public-kiosk .crvo-auth-nav,
    body.atelier-public-kiosk .env-switcher,
    body.atelier-public-kiosk .crvo-trust-ticker,
    body.atelier-public-kiosk .global-book-launch,
    body.atelier-public-kiosk .transphere-access-launcher {
      display: none !important;
    }

    @media (min-width: 2560px) and (min-height: 1400px) {
      body.atelier-public-kiosk main[class*="atelier_screen"] {
        image-rendering: auto;
        text-rendering: geometricPrecision;
      }
    }
  `}</style>;
}
