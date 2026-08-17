"use client";

import { useLayoutEffect } from "react";

function rewrite(url: URL, pathname: string) {
  const source = url.pathname;
  let target = "";
  let resource = "";

  if (pathname === "/atelier") {
    target = "/api/kiosk/atelier";
    if (source === "/api/dashboard") resource = "dashboard";
    else if (source === "/api/objectives") resource = "objectives";
    else if (source === "/api/system-status") resource = "system-status";
  } else if (pathname === "/direction") {
    target = "/api/kiosk/direction";
    if (source === "/api/dashboard") resource = "dashboard";
    else if (source === "/api/objectives") resource = "objectives";
    // La finance Direction reste sur /api/finance : cette API authentifiée
    // utilise le même moteur certifié que le kiosk et évite une dépendance
    // au pont client pour un indicateur critique.
  }

  if (!target || !resource) return null;
  const rewritten = new URL(target, url.origin);
  for (const [key, value] of url.searchParams) rewritten.searchParams.append(key, value);
  rewritten.searchParams.set("resource", resource);
  return rewritten;
}

export default function KioskFetchBridge() {
  useLayoutEffect(() => {
    const pathname = window.location.pathname;
    if (pathname !== "/atelier" && pathname !== "/direction") return;

    document.body.classList.add("crvo-kiosk-mode");
    const nativeFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
      const source = new URL(raw, window.location.origin);
      if (source.origin !== window.location.origin) return nativeFetch(input, init);
      const target = rewrite(source, pathname);
      if (!target) return nativeFetch(input, init);
      if (input instanceof Request) return nativeFetch(new Request(target.toString(), input), init);
      return nativeFetch(target.toString(), init);
    }) as typeof window.fetch;

    return () => {
      document.body.classList.remove("crvo-kiosk-mode");
      window.fetch = nativeFetch;
    };
  }, []);
  return <style>{`
    body.crvo-kiosk-mode .gn-trigger,
    body.crvo-kiosk-mode .gn-backdrop,
    body.crvo-kiosk-mode .gn-drawer,
    body.crvo-kiosk-mode .crvo-auth-nav,
    body.crvo-kiosk-mode .hsm{display:none!important}
  `}</style>;
}
