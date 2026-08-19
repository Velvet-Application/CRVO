"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Me = { user?: { role?: string } };

export default function EnvironmentSwitcher() {
  const pathname = usePathname();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let dead = false;
    async function read() {
      try { const response = await fetch("/api/auth/me", { cache: "no-store" }); const payload = await response.json().catch(() => ({})) as Me; if (!dead) setAdmin(response.ok && payload.user?.role === "admin"); }
      catch { if (!dead) setAdmin(false); }
    }
    void read();
    return () => { dead = true; };
  }, []);
  if (!admin || pathname === "/login") return null;
  const inTransphere = pathname.startsWith("/transphere");
  return <a className={`env-switcher ${inTransphere ? "to-crvo" : "to-transphere"}`} href={inTransphere ? "/" : "/transphere"} aria-label={inTransphere ? "Basculer vers CRVO" : "Basculer vers Transphère"}>
    <span className="env-icon">{inTransphere ? "C" : "T"}</span>
    <span><small>ENVIRONNEMENT</small><strong>{inTransphere ? "CRVO" : "TRANSPHÈRE"}</strong></span>
    <i>{inTransphere ? "←" : "→"}</i>
    <style>{`
      .env-switcher{position:fixed;z-index:220;left:16px;bottom:16px;width:218px;height:54px;padding:0 12px;display:grid;grid-template-columns:36px 1fr 18px;gap:10px;align-items:center;border-radius:15px;text-decoration:none!important;font-family:Exo,Arial,sans-serif;box-shadow:0 14px 30px rgba(0,41,80,.24);transition:.18s transform,.18s box-shadow}.env-switcher:hover{transform:translateY(-2px);box-shadow:0 17px 34px rgba(0,41,80,.30)}.env-switcher.to-transphere{background:linear-gradient(135deg,#0aa99f,#007e87);color:#fff}.env-switcher.to-crvo{background:linear-gradient(135deg,#0055a5,#003a78);color:#fff}.env-icon{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:rgba(255,255,255,.16);font-size:18px;font-weight:900;font-style:italic}.env-switcher small,.env-switcher strong{display:block}.env-switcher small{font-size:6px;letter-spacing:.14em;opacity:.72;font-weight:900}.env-switcher strong{margin-top:2px;font-size:12px;font-weight:900;font-style:italic}.env-switcher i{font-style:normal;font-size:17px;opacity:.8}@media(max-width:760px){.env-switcher{width:178px;height:48px;left:10px;bottom:10px;grid-template-columns:30px 1fr 14px}.env-icon{width:30px;height:30px}.env-switcher strong{font-size:10px}}@media print{.env-switcher{display:none!important}}
    `}</style>
  </a>;
}
