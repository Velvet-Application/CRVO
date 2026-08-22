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
    body.client-portal-mode { margin:0; background:#eef5f9; overflow-x:hidden; }

    /* Client portal containment: CSS grid tracks must be allowed to shrink below
       the min-content width of long vehicle names, otherwise cards can escape the
       panel on desktop/high-DPI screens. */
    body.client-portal-mode [class*="vehiclePreview"],
    body.client-portal-mode [class*="vehicleList"] {
      min-width:0!important;
      max-width:100%!important;
      width:100%!important;
    }
    body.client-portal-mode [class*="vehicleCard"] {
      min-width:0!important;
      max-width:100%!important;
      width:100%!important;
      overflow:hidden!important;
      box-sizing:border-box!important;
    }
    body.client-portal-mode [class*="vehicleTop"],
    body.client-portal-mode [class*="vehicleTop"] > div {
      min-width:0!important;
      max-width:100%!important;
    }
    body.client-portal-mode [class*="vehicleTop"] > div { overflow:hidden; }
    body.client-portal-mode [class*="vehicleTop"] em {
      max-width:46%;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }

    @media (min-width:1051px) {
      body.client-portal-mode [class*="vehiclePreview"] { grid-template-columns:repeat(4,minmax(0,1fr))!important; }
      body.client-portal-mode [class*="vehicleList"] { grid-template-columns:repeat(3,minmax(0,1fr))!important; }
      body.client-portal-mode [class*="panel"] {
        min-width:0!important;
        width:calc(100% - 32px)!important;
        max-width:1320px!important;
        box-sizing:border-box!important;
      }
    }
    @media (min-width:721px) and (max-width:1050px) {
      body.client-portal-mode [class*="vehiclePreview"],
      body.client-portal-mode [class*="vehicleList"] { grid-template-columns:repeat(2,minmax(0,1fr))!important; }
    }
    @media (max-width:720px) {
      body.client-portal-mode [class*="vehiclePreview"],
      body.client-portal-mode [class*="vehicleList"] { grid-template-columns:minmax(0,1fr)!important; }
    }
  `}</style>;
}
