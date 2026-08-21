"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const PARTS = Array.from({ length: 11 }, (_, index) => `/transphere-home-exact/part-${String(index).padStart(2, "0")}.txt`);

function decodeBase64Image(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
}

export default function TransphereExactHome() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl = "";

    Promise.all(PARTS.map(async (part) => {
      const response = await fetch(part, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Asset Transphère indisponible: ${part}`);
      return response.text();
    }))
      .then((chunks) => {
        if (!active) return;
        objectUrl = decodeBase64Image(chunks.join(""));
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setSrc(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  return (
    <main className="transphere-exact-home" style={{ margin: 0, padding: 0, width: "100%", minHeight: "100vh", overflowX: "hidden", background: "#031a34" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1672 / 941", background: "#031a34" }}>
        {src ? (
          <img
            src={src}
            alt="Accueil Transphère"
            draggable={false}
            style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", objectFit: "fill", userSelect: "none" }}
          />
        ) : null}

        <Link href="/transphere/dashboard" aria-label="Ouvrir le Dashboard Transphère" title="Dashboard" style={{ position: "absolute", left: "3.35%", top: "48.15%", width: "29.55%", height: "29.2%", zIndex: 3, background: "transparent", textDecoration: "none" }} />
        <Link href="/transphere/matrice" aria-label="Ouvrir la matrice décisionnelle transport" title="Matrice décisionnelle transport" style={{ position: "absolute", left: "34.10%", top: "48.15%", width: "29.80%", height: "29.2%", zIndex: 3, background: "transparent", textDecoration: "none" }} />
        <Link href="/transphere/parametre" aria-label="Ouvrir les paramètres Transphère" title="Paramètre" style={{ position: "absolute", left: "65.13%", top: "48.15%", width: "29.55%", height: "29.2%", zIndex: 3, background: "transparent", textDecoration: "none" }} />
      </div>

      <style>{`
        html:has(.transphere-exact-home), body:has(.transphere-exact-home) { margin: 0 !important; padding: 0 !important; background: #031a34 !important; }
        body:has(.transphere-exact-home) .gn2-trigger,
        body:has(.transphere-exact-home) .trust-guard,
        body:has(.transphere-exact-home) .daily-animation-root { display: none !important; }
        .transphere-exact-home a:focus-visible { outline: 3px solid #10bfff; outline-offset: -3px; border-radius: 18px; }
      `}</style>
    </main>
  );
}
