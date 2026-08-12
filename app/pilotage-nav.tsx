"use client";

import { useEffect } from "react";

export default function PilotageNav() {
  useEffect(() => {
    const install = () => {
      const nav = document.querySelector<HTMLElement>(".sidebar nav");
      if (nav && !nav.querySelector("[data-pilotage-link]")) {
        const link = document.createElement("a");
        link.href = "/pilotage";
        link.dataset.pilotageLink = "1";
        link.className = "pilotage-nav-link";
        link.setAttribute("aria-label", "Ouvrir le pilotage du jour");
        link.innerHTML = `<span class="pilotage-nav-icon">↗</span><span class="pilotage-nav-label">Pilotage du jour</span><i></i>`;
        nav.insertBefore(link, nav.firstChild);
      }
    };
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <style>{`
    .sidebar nav .pilotage-nav-link{
      min-height:50px;
      padding:0 13px;
      display:grid;
      grid-template-columns:23px 1fr 6px;
      align-items:center;
      gap:11px;
      border:0;
      border-radius:10px;
      color:rgba(255,255,255,.92)!important;
      background:rgba(0,158,219,.18)!important;
      text-decoration:none!important;
      transition:.18s ease;
      box-shadow:inset 0 0 0 1px rgba(133,221,255,.16);
    }
    .sidebar nav .pilotage-nav-link:hover{
      color:#fff!important;
      background:rgba(0,158,219,.30)!important;
      box-shadow:inset 0 0 0 1px rgba(133,221,255,.32);
    }
    .sidebar nav .pilotage-nav-icon{
      width:23px;
      height:23px;
      display:grid;
      place-items:center;
      border-radius:7px;
      color:#fff!important;
      background:#009edb;
      font-size:13px;
      line-height:1;
      font-weight:800;
      box-shadow:0 4px 10px rgba(0,34,68,.18);
    }
    .sidebar nav .pilotage-nav-label{
      color:inherit!important;
      font-size:11px!important;
      font-weight:800!important;
      letter-spacing:0!important;
    }
    .sidebar nav .pilotage-nav-link>i{
      width:6px;
      height:6px;
      border-radius:50%;
      background:#85ddff;
      opacity:.9;
    }
  `}</style>;
}
