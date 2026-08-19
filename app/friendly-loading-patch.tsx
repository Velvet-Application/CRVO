"use client";

import { useEffect } from "react";

const TARGET = "Connexion aux sources réelles";

const carSvg = `
<svg viewBox="0 0 44 26" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="currentColor"/>
      <stop offset="1" stop-color="#003f80"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dff7ff" stop-opacity=".98"/>
      <stop offset="1" stop-color="#6ecfea" stop-opacity=".72"/>
    </linearGradient>
  </defs>
  <ellipse cx="22" cy="21.2" rx="15.5" ry="2.8" fill="#003d70" opacity=".12"/>
  <rect x="5.5" y="4.8" width="33" height="16.2" rx="7.2" fill="url(#body)" stroke="#fff" stroke-width="1.15"/>
  <path d="M13 5.4 17.2 2.8h9.6L31 5.4Z" fill="currentColor" stroke="#fff" stroke-width=".85"/>
  <path d="M15.3 6.1h13.4l-2.1 5.1h-9.2Z" fill="url(#glass)" stroke="#fff" stroke-opacity=".82" stroke-width=".7"/>
  <path d="M16.8 12.1h10.4l1.2 6.1H15.6Z" fill="#eafaff" opacity=".24"/>
  <path d="M8.4 11.1h3.5M32.1 11.1h3.5" stroke="#c6f4ff" stroke-width="1.2" stroke-linecap="round"/>
  <rect x="2.7" y="7" width="4.2" height="4.3" rx="1.4" fill="#182e43"/>
  <rect x="37.1" y="7" width="4.2" height="4.3" rx="1.4" fill="#182e43"/>
  <rect x="2.7" y="15" width="4.2" height="4.3" rx="1.4" fill="#182e43"/>
  <rect x="37.1" y="15" width="4.2" height="4.3" rx="1.4" fill="#182e43"/>
  <circle cx="35.1" cy="8.1" r="1.3" fill="#FEC82F"/>
  <circle cx="35.1" cy="17.7" r="1.3" fill="#FEC82F"/>
  <circle cx="8.9" cy="8.1" r="1.05" fill="#eb5b56" opacity=".9"/>
  <circle cx="8.9" cy="17.7" r="1.05" fill="#eb5b56" opacity=".9"/>
  <path d="M20.2 4.8v16.1M27.8 4.8v16.1" stroke="#fff" stroke-opacity=".16" stroke-width=".65"/>
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
              <div class="crvo-lane"></div>
              <div class="crvo-orbit">
                <span class="crvo-slot crvo-slot-a"><span class="crvo-car crvo-car-a">${carSvg}</span></span>
                <span class="crvo-slot crvo-slot-b"><span class="crvo-car crvo-car-b">${carSvg}</span></span>
                <span class="crvo-slot crvo-slot-c"><span class="crvo-car crvo-car-c">${carSvg}</span></span>
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
      min-height:280px!important;
      display:grid!important;
      place-items:center!important;
      padding:44px 28px!important;
      overflow:hidden!important;
      background:radial-gradient(circle at 50% 42%,rgba(0,158,219,.055),transparent 42%),linear-gradient(180deg,#ffffff 0%,#f8fbfd 100%)!important;
    }
    .crvo-waiting{display:grid;place-items:center;gap:18px;font-family:Exo,Arial,sans-serif}
    .crvo-road{position:relative;width:174px;height:174px;display:grid;place-items:center}
    .crvo-road:before{content:"";position:absolute;inset:8px;border-radius:50%;border:18px solid #eef5f8;box-shadow:inset 0 0 0 1px rgba(0,79,159,.08),0 8px 26px rgba(24,66,92,.07)}
    .crvo-road:after{content:"";position:absolute;inset:27px;border-radius:50%;border:1px solid rgba(0,158,219,.14);pointer-events:none}
    .crvo-lane{position:absolute;inset:17px;border-radius:50%;border:2px dashed rgba(0,79,159,.19);animation:crvoLane 9s linear infinite}
    .crvo-orbit{position:absolute;inset:0;animation:crvoCarsOrbit 4.35s linear infinite;will-change:transform}
    .crvo-slot{position:absolute;inset:0;transform-origin:50% 50%}
    .crvo-slot-a{transform:rotate(0deg)}
    .crvo-slot-b{transform:rotate(120deg)}
    .crvo-slot-c{transform:rotate(240deg)}
    .crvo-car{position:absolute;left:65px;top:3px;width:44px;height:26px;transform:rotate(0deg);transform-origin:50% 50%;filter:drop-shadow(0 5px 5px rgba(0,55,106,.16));will-change:transform}
    .crvo-car svg{display:block;width:100%;height:100%;overflow:visible}
    .crvo-car-a{color:#004f9f}
    .crvo-car-b{color:#009edb}
    .crvo-car-c{color:#47b9b4}
    .crvo-loader-center{position:relative;z-index:2;width:66px;height:66px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(180deg,#fff,#f9fcfe);border:1px solid #dbe8ef;box-shadow:0 10px 28px rgba(22,64,91,.1)}
    .crvo-loader-center span{color:#004f9f;font:800 italic 13px Exo,Arial,sans-serif;letter-spacing:.04em}
    .crvo-loader-center i{position:absolute;left:20px;right:20px;bottom:15px;height:3px;border-radius:4px;background:#009edb}
    .crvo-loader-label{color:#004f9f;font:800 italic 13px Exo,Arial,sans-serif;letter-spacing:.035em}
    .crvo-loader-dots{display:inline-block;min-width:16px;color:#009edb;animation:crvoDots 1.15s ease-in-out infinite}
    @keyframes crvoCarsOrbit{to{transform:rotate(360deg)}}
    @keyframes crvoLane{to{transform:rotate(-360deg)}}
    @keyframes crvoDots{0%,100%{opacity:.35;transform:translateX(0)}50%{opacity:1;transform:translateX(2px)}}
    @media(max-width:600px){[data-crvo-car-loader="1"]{min-height:235px!important}.crvo-road{width:154px;height:154px}.crvo-car{left:56px;top:2px;width:42px;height:25px}.crvo-loader-center{width:60px;height:60px}}
    @media(prefers-reduced-motion:reduce){.crvo-orbit{animation-duration:13s}.crvo-lane{animation-duration:24s}.crvo-loader-dots{animation:none}}
    @media print{[data-crvo-car-loader="1"]{display:none!important}}
  `}</style>;
}
