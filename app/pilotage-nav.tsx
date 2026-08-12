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
        link.innerHTML = `<span class="pilotage-nav-icon">↗</span><span>Pilotage du jour</span>`;
        nav.insertBefore(link, nav.firstChild);
      }
    };
    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <style>{`
    .pilotage-nav-link{min-height:48px;padding:0 17px;display:flex;align-items:center;gap:13px;color:#35596f;text-decoration:none;font-size:11px;font-weight:700;border-left:3px solid transparent;background:linear-gradient(90deg,rgba(0,158,219,.05),transparent);transition:.18s ease}
    .pilotage-nav-link:hover{color:#004f9f;background:#eef7fb;border-left-color:#009edb}
    .pilotage-nav-icon{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;color:#fff;background:linear-gradient(135deg,#004f9f,#009edb);font-size:14px;font-weight:800}
  `}</style>;
}
