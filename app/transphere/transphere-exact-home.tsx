"use client";

import Link from "next/link";

export default function TransphereExactHome() {
  return (
    <main className="transphere-exact-home">
      <img
        src="/transphere-home-exact.png"
        alt="Accueil Transphère"
        draggable={false}
        className="transphere-exact-home__visual"
      />

      <Link
        href="/transphere/dashboard"
        aria-label="Ouvrir le Dashboard Transphère"
        title="Dashboard"
        className="transphere-exact-home__hotspot transphere-exact-home__hotspot--dashboard"
      />
      <Link
        href="/transphere/matrice"
        aria-label="Ouvrir la matrice décisionnelle transport"
        title="Matrice décisionnelle transport"
        className="transphere-exact-home__hotspot transphere-exact-home__hotspot--matrix"
      />
      <Link
        href="/transphere/parametre"
        aria-label="Ouvrir les paramètres Transphère"
        title="Paramètre"
        className="transphere-exact-home__hotspot transphere-exact-home__hotspot--settings"
      />

      <style>{`
        html:has(.transphere-exact-home),
        body:has(.transphere-exact-home) {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          height: 100% !important;
          overflow: hidden !important;
          background: #031a34 !important;
        }

        body:has(.transphere-exact-home) .gn2-trigger,
        body:has(.transphere-exact-home) .trust-guard,
        body:has(.transphere-exact-home) .daily-animation-root {
          display: none !important;
        }

        .transphere-exact-home {
          position: fixed;
          inset: 0;
          z-index: 9999;
          width: 100vw;
          height: 100vh;
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: #031a34;
        }

        .transphere-exact-home__visual {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          object-fit: fill;
          user-select: none;
          -webkit-user-drag: none;
          pointer-events: none;
        }

        .transphere-exact-home__hotspot {
          position: absolute;
          z-index: 2;
          display: block;
          background: transparent;
          text-decoration: none;
          border-radius: 2.2%;
        }

        .transphere-exact-home__hotspot--dashboard {
          left: 3.35%;
          top: 48.15%;
          width: 29.55%;
          height: 29.2%;
        }

        .transphere-exact-home__hotspot--matrix {
          left: 34.10%;
          top: 48.15%;
          width: 29.80%;
          height: 29.2%;
        }

        .transphere-exact-home__hotspot--settings {
          left: 65.13%;
          top: 48.15%;
          width: 29.55%;
          height: 29.2%;
        }

        .transphere-exact-home__hotspot:focus-visible {
          outline: 3px solid #10bfff;
          outline-offset: -3px;
        }
      `}</style>
    </main>
  );
}
