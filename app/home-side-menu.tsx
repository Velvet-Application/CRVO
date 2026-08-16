"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type GroupKey = "book" | "animation" | "cockpit" | "client" | "settings";
type Me = { role: "admin" | "user"; accessProfile?: string; pagePermissions?: string[] };

const CLOSED: Record<GroupKey, boolean> = { book: false, animation: false, cockpit: false, client: false, settings: false };

function rootHref(view: string) { return `/?nav=${encodeURIComponent(view)}`; }

export default function HomeSideMenu() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState<Record<GroupKey, boolean>>(CLOSED);
  const requested = search.get("nav") ?? "today";

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async r => r.ok ? r.json() : null)
      .then(payload => setMe(payload?.user ?? null))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (["yesterday", "bottlenecks", "walking", "finance"].includes(requested)) setOpen({ ...CLOSED, book: true });
    else if (["objectives", "sources"].includes(requested)) setOpen({ ...CLOSED, settings: true });
  }, [requested]);

  const admin = me?.role === "admin";
  const allowed = (key: string) => Boolean(me && (admin || me.pagePermissions?.includes("*") || me.pagePermissions?.includes(key)));
  const animationVisible = allowed("productivity") || allowed("monthly_animation") || admin;
  const cockpitVisible = allowed("cockpit") || allowed("bodyshop") || allowed("intelligence");
  const clientVisible = allowed("client_dashboard");
  const profile = useMemo(() => admin ? "ADMIN" : "ACCÈS MÉTIER", [admin]);

  if (pathname !== "/" || !me) return null;

  const toggle = (key: GroupKey) => setOpen(current => current[key] ? { ...CLOSED } : { ...CLOSED, [key]: true });
  const direct = (href: string, label: string, active = false, restricted = false) => (
    <a className={`hsm-link${active ? " active" : ""}`} href={href}>
      <span className="hsm-dot"/><span>{label}</span>{restricted && <small>ADMIN</small>}<i>›</i>
    </a>
  );
  const group = (key: GroupKey, label: string, children: React.ReactNode) => (
    <section className="hsm-group">
      <button type="button" onClick={() => toggle(key)} aria-expanded={open[key]}>
        <span>{label}</span><i className={open[key] ? "open" : ""}>›</i>
      </button>
      <div className={`hsm-collapse${open[key] ? " open" : ""}`}><div>{children}</div></div>
    </section>
  );

  return <aside className="hsm" aria-label="Navigation principale KPI CRVO">
    <div className="hsm-brand"><Image src="/crvo-logo.png" alt="CRVO" width={190} height={59} priority unoptimized/></div>
    <div className="hsm-context"><span>KPI CRVO</span><strong>Pilotage Lens</strong><small>Données opérationnelles & direction</small></div>
    <nav>
      {allowed("reporting") && direct(rootHref("today"), "Performance du jour", requested === "today")}

      {allowed("book") && group("book", "BOOK", <>
        {direct(rootHref("yesterday"), "Dashboard", requested === "yesterday")}
        {direct(rootHref("bottlenecks"), "Goulot", requested === "bottlenecks")}
        {direct(rootHref("walking"), "Walking Dead", requested === "walking")}
        {direct(rootHref("finance"), "Chiffre d'affaire", requested === "finance")}
      </>)}

      {animationVisible && group("animation", "Animation du centre", <>
        {allowed("productivity") && direct("/performance/productivite", "Productivité")}
        {allowed("monthly_animation") && direct("/animation-mensuelle", "Variable")}
        {admin && direct("/animation-mensuelle/acces", "Accès Workflow", false, true)}
        {admin && direct("/animation-mensuelle/payplan", "Payplan", false, true)}
      </>)}

      {cockpitVisible && group("cockpit", "Cockpit V2", <>
        {allowed("cockpit") && direct("/cockpit-v2?section=pilotage", "Pilotage du jour")}
        {allowed("cockpit") && direct("/cockpit-v2?section=synthese", "Synthèse manager")}
        {allowed("cockpit") && direct("/cockpit-v2?section=decision", "Aide à la décision")}
        {allowed("cockpit") && direct("/cockpit-v2?section=prevision", "Prévision fin de journée")}
        {allowed("bodyshop") && direct("/cockpit-v2/carrosserie", "Focus carrosserie")}
        {allowed("intelligence") && direct("/intelligence", "Analyse")}
      </>)}

      {clientVisible && group("client", "Dashboard client", <>
        {direct("/dashboard-client?scope=reseau", "Réseau EFF & EFB")}
        {direct("/dashboard-client?scope=bmw-mini", "BMW / MINI")}
      </>)}

      {group("settings", "Paramètre", <>
        {allowed("settings") && direct(rootHref("objectives"), "Objectif & seuil", requested === "objectives")}
        {allowed("settings") && direct(rootHref("sources"), "Source & Connexion", requested === "sources")}
        {direct("/account", "Accès")}
        {allowed("data_rh") && direct("/data-rh", "Data RH")}
      </>)}

      {admin && <div className="hsm-admin">
        {direct("/atelier", "Ecran ATELIER", false, true)}
        {direct("/direction", "Ecran DIRECTION", false, true)}
      </div>}
    </nav>
    <footer><span>SESSION SÉCURISÉE</span><strong>{profile}</strong></footer>
    <style>{`
      .hsm{position:fixed;z-index:90;inset:0 auto 0 0;width:250px;height:100vh;display:flex;flex-direction:column;padding:18px 14px;color:#fff;background:linear-gradient(165deg,#0059aa 0%,#004586 58%,#00366b 100%);box-shadow:10px 0 28px rgba(0,43,83,.10);font-family:Exo,Arial,sans-serif;overflow:hidden}.hsm::after{content:"";position:absolute;right:-1px;bottom:0;width:120px;height:180px;border-radius:120px 0 0 0;background:rgba(0,158,219,.14);pointer-events:none}.hsm-brand{position:relative;z-index:1;min-height:82px;padding:10px 12px;display:grid;place-items:center;border-radius:14px;background:#fff}.hsm-brand img{display:block;width:190px;height:auto}.hsm-context{position:relative;z-index:1;padding:24px 13px 18px;border-bottom:1px solid rgba(255,255,255,.16)}.hsm-context span{display:block;color:#85ddff;font-size:9px;font-weight:800;font-style:italic;letter-spacing:.14em}.hsm-context strong{display:block;margin-top:5px;font-size:21px;font-weight:800;font-style:italic}.hsm-context small{display:block;margin-top:4px;color:rgba(255,255,255,.62);font-size:9px}.hsm nav{position:relative;z-index:1;flex:1;margin-top:12px;padding:0 2px 16px;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.22) transparent}.hsm-link{min-height:42px;margin:3px 0;padding:0 10px;display:grid;grid-template-columns:5px 1fr auto 10px;align-items:center;gap:9px;border:1px solid transparent;border-radius:9px;color:rgba(255,255,255,.86)!important;text-decoration:none!important;font-size:10px;font-weight:700;transition:.16s ease}.hsm-link:hover{background:rgba(255,255,255,.07);color:#fff!important}.hsm-link.active{background:#fff;color:#004f9f!important;box-shadow:0 8px 18px rgba(0,26,57,.16)}.hsm-dot{width:5px;height:5px;border-radius:50%;background:#009edb}.hsm-link small{padding:3px 5px;border-radius:5px;background:rgba(254,200,47,.14);color:#ffe17b;font-size:6px;font-weight:800;letter-spacing:.07em}.hsm-link.active small{color:#8f6e00;background:#fff4c8}.hsm-link i{font-style:normal;font-size:15px;color:#85dcfc}.hsm-link.active i{color:#009edb}.hsm-group{margin-top:10px}.hsm-group>button{width:100%;min-height:38px;padding:0 8px;display:flex;align-items:center;justify-content:space-between;border:0;background:transparent;color:rgba(255,255,255,.62);font:800 9px Exo,Arial,sans-serif;letter-spacing:.105em;text-transform:uppercase;text-align:left}.hsm-group>button i{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:rgba(0,158,219,.10);color:#85dcfc;font-style:normal;font-size:17px;transition:transform .18s}.hsm-group>button i.open{transform:rotate(90deg)}.hsm-collapse{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .18s ease,opacity .18s ease}.hsm-collapse.open{grid-template-rows:1fr;opacity:1}.hsm-collapse>div{min-height:0;overflow:hidden}.hsm-admin{margin-top:16px;padding-top:13px;border-top:1px solid rgba(255,255,255,.14)}.hsm footer{position:relative;z-index:1;padding:11px 12px 4px;border-top:1px solid rgba(255,255,255,.12)}.hsm footer span,.hsm footer strong{display:block}.hsm footer span{color:#85dcfc;font-size:6px;font-weight:800;letter-spacing:.13em}.hsm footer strong{margin-top:3px;font-size:9px}body:has(.hsm) .app-shell>.sidebar{visibility:hidden!important}body:has(.hsm) .gn-trigger{display:none!important}@media(max-width:760px){.hsm{width:250px;transform:translateX(-100%);pointer-events:none}body:has(.hsm) .app-shell>.sidebar{visibility:visible!important}body:has(.hsm) .gn-trigger{display:grid!important}}
    `}</style>
  </aside>;
}
