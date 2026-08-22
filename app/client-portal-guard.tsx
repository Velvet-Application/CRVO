"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ClientPortalGuard() {
  const pathname = usePathname();
  const clientPath = pathname.startsWith("/espace-client");

  useEffect(() => {
    document.body.classList.toggle("client-portal-mode", clientPath);
    return () => document.body.classList.remove("client-portal-mode");
  }, [clientPath]);

  useEffect(() => {
    if (clientPath || pathname === "/login" || pathname.startsWith("/qualite/client/") || pathname.startsWith("/q/")) return;
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled || !payload?.user?.clientPortal) return;
        location.replace("/espace-client");
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [clientPath, pathname]);

  if (!clientPath) return null;
  return <style>{`
    body.client-portal-mode > header,
    body.client-portal-mode > a[href="/messagerie"],
    body.client-portal-mode > .crvo-notification-toast { display:none!important; }
    body.client-portal-mode { margin:0; background:#eef5f9; }
  `}</style>;
}
