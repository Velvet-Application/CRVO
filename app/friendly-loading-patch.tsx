"use client";

import { useEffect } from "react";

const TARGET = "Connexion aux sources réelles";

const carSvg = `
<svg viewBox="0 0 32 40" aria-hidden="true" focusable="false">
  <rect x="7" y="3" width="18" height="34" rx="7" fill="white" stroke="currentColor" stroke-width="2.4"/>
  <path d="M10 12.5h12l-1.8-5.2H11.8L10 12.5Z" fill="currentColor" opacity=".18"/>
  <path d="M10.5 25.5h11l-1.2 6.3h-8.6l-1.2-6.3Z" fill="currentColor" opacity=".14"/>
  <rect x="4.5" y="10" width="3.2" height="8" rx="1.5" fill="currentColor"/>
  <rect x="24.3" y="10" width="3.2" height="8" rx="1.5" fill="currentColor"/>
  <rect x="4.5" y="25" width="3.2" height="8" rx="1.5" fill="currentColor"/>
  <rect x="24.3" y="25" width="3.2" height="8" rx="1.5" fill="currentColor"/>
  <circle cx="11.5" cy="7" r="1.4" fill="#FEC82F"/>
  <circle cx="20.5" cy="7" r="1.4" fill="#FEC82F"/>
</svg>`;

export default function FriendlyLoadingPatch() {
  useEffect(() => {
    const decorate = () => {
      document.querySelectorAll<HTMLElement>("strong").forEach((title) => {
        if (title.textContent?.trim() !== TARGET) return;
        const host = title.closest<HTMLElement>("section");
        if (!host || host.dataset.crvoCarLoader === "1") return;

        host.dataset.crvoCarLoader = "1";
        host.setAttribute("role", "status");
        host.setAttribute("aria-live", "polite");
        host.setAttribute("aria-label", "Chargement du tableau de bord CRVO");
        host.innerHTML = `
          <div class="crvo-waiting">
            <div class="crvo-road" aria-hidden="true">
              <div class="crvo-orbit">
                <span class="crvo-car crvo-car-a">${carSvg}</span>
                <span class="crvo-car crvo-car-b">${carSvg}</span>
                <span class="crvo-car crvo-car-c">${carSvg}</span>
              </div>
              <div class="crvo-loader-center"><span>CRVO</span><i></i></div>
            </div>
            <div class="crvo-loader-label">Chargement<span class="crvo-loader-dots">…</span></div>
          </div>`;
      });
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <style>{`
    [data-crvo-car-loader="1"]{
      min-height:260px!important;
      display:grid!important;
      place-items:center!important;
      padding:42px 28px!important;
      overflow:hidden!important;
      background:linear-gradient(180deg,#ffffff 0%,#f8fbfd 100%)!important;
    }
    .crvo-waiting{display:grid;place-items:center;gap:17px;font-family:Exo,Arial,sans-serif}
    .crvo-road{position:relative;width:148px;height:148px;display:grid;place-items:center}
    .crvo-road:before,.crvo-road:after{content:"";position:absolute;border-radius:50%;pointer-events:none}
    .crvo-road:before{inset:9px;border:2px dashed rgba(0,79,159,.18);box-shadow:0 0 0 12px rgba(0,158,219,.035)}
    .crvo-road:after{inset:31px;border:1px solid rgba(0,158,219,.12)}
    .crvo-orbit{position:absolute;inset:0;animation:crvoCarsOrbit 3.8s linear infinite;will-change:transform}
    .crvo-car{position:absolute;width:25px;height:32px;color:#004f9f;filter:drop-shadow(0 5px 5px rgba(0,55,106,.12))}
    .crvo-car svg{display:block;width:100%;height:100%}
    .crvo-car-a{left:61.5px;top:-1px}
    .crvo-car-b{right:7px;bottom:18px;transform:rotate(120deg);color:#009edb}
    .crvo-car-c{left:7px;bottom:18px;transform:rotate(240deg);color:#004f9f}
    .crvo-loader-center{position:relative;z-index:2;width:58px;height:58px;display:grid;place-items:center;border-radius:50%;background:#fff;border:1px solid #dbe8ef;box-shadow:0 8px 24px rgba(22,64,91,.09)}
    .crvo-loader-center span{color:#004f9f;font:800 italic 12px Exo,Arial,sans-serif;letter-spacing:.03em}
    .crvo-loader-center i{position:absolute;left:18px;right:18px;bottom:13px;height:3px;border-radius:4px;background:#009edb}
    .crvo-loader-label{color:#004f9f;font:800 italic 13px Exo,Arial,sans-serif;letter-spacing:.035em}
    .crvo-loader-dots{display:inline-block;min-width:16px;color:#009edb;animation:crvoDots 1.15s ease-in-out infinite}
    @keyframes crvoCarsOrbit{to{transform:rotate(360deg)}}
    @keyframes crvoDots{0%,100%{opacity:.35;transform:translateX(0)}50%{opacity:1;transform:translateX(2px)}}
    @media(max-width:600px){[data-crvo-car-loader="1"]{min-height:220px!important}.crvo-road{width:132px;height:132px}.crvo-car-a{left:53.5px}.crvo-car{width:24px;height:31px}.crvo-car-b{right:4px;bottom:16px}.crvo-car-c{left:4px;bottom:16px}}
    @media(prefers-reduced-motion:reduce){.crvo-orbit{animation-duration:12s}.crvo-loader-dots{animation:none}}
    @media print{[data-crvo-car-loader="1"]{display:none!important}}
  `}</style>;
}
