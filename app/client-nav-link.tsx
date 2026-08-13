"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ClientNavLink() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const locate = () => {
      const nav = document.querySelector<HTMLElement>(".sidebar nav");
      if (!nav) { setHost(null); return; }
      let root = document.getElementById("client-nav-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "client-nav-root";
        nav.appendChild(root);
      }
      setHost(root);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList:true, subtree:true });
    return () => observer.disconnect();
  }, []);

  if (!host || !host.isConnected) return null;
  return createPortal(<a className="client-nav-tab" href="/dashboard-client"><span className="client-nav-icon">▦</span><span>Dashboard client</span><i/></a>, host);
}
