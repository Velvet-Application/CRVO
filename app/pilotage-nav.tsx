"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Hosts = {
  performance: HTMLElement;
  book: HTMLElement;
  middle: HTMLElement;
  settings: HTMLElement;
  settingsExtra: HTMLElement;
};

type GroupKey = "performance" | "book" | "cockpit" | "client" | "settings";
type OpenGroups = Record<GroupKey, boolean>;

const DEFAULT_OPEN: OpenGroups = {
  performance: false,
  book: false,
  cockpit: false,
  client: false,
  settings: false,
};

const STORAGE_KEY = "crvo-sidebar-groups-v2";

function makeSlot(nav: HTMLElement, id: string) {
  let slot = document.getElementById(id);
  if (!slot) {
    slot = document.createElement("div");
    slot.id = id;
  }
  if (slot.parentElement !== nav) nav.appendChild(slot);
  return slot;
}

function relabel(id: string, label: string) {
  const node = document.getElementById(id)?.querySelector("span");
  if (node && node.textContent !== label) node.textContent = label;
}

function setHidden(id: string, hidden: boolean) {
  const node = document.getElementById(id);
  if (node) node.hidden = hidden;
}

function activeGroup(path: string): GroupKey | null {
  if (path.startsWith("/cockpit-v2")) return "cockpit";
  if (path.startsWith("/dashboard-client")) return "client";
  if (/^\/(account|data-rh|atelier|direction)/.test(path)) return "settings";
  return null;
}

export default function PilotageNav() {
  const [hosts, setHosts] = useState<Hosts | null>(null);
  const [open, setOpen] = useState<OpenGroups>(DEFAULT_OPEN);

  useEffect(() => {
    const path = window.location.pathname;
    const active = activeGroup(path);
    if (active) {
      const next = { ...DEFAULT_OPEN, [active]: true };
      setOpen(next);
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return;
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setOpen(stored ? { ...DEFAULT_OPEN, ...JSON.parse(stored) } as OpenGroups : { ...DEFAULT_OPEN });
    } catch {
      setOpen(DEFAULT_OPEN);
    }
  }, []);

  useEffect(() => {
    const install = () => {
      const nav = document.querySelector<HTMLElement>(".sidebar nav");
      if (!nav) {
        setHosts(null);
        return;
      }

      document.getElementById("pilotage-nav-root")?.remove();
      nav.querySelectorAll("[data-pilotage-link],[data-intelligence-link],[data-client-link]").forEach((node) => node.remove());

      const today = document.getElementById("nav-today");
      const yesterday = document.getElementById("nav-yesterday");
      const finance = document.getElementById("nav-finance");
      const objectives = document.getElementById("nav-objectives");
      const sources = document.getElementById("nav-sources");
      if (!today || !yesterday || !finance || !objectives || !sources) return;

      relabel("nav-today", "Performance");
      relabel("nav-bottlenecks", "Goulot");
      relabel("nav-walking", "Walking DEAD");
      relabel("nav-finance", "Chiffre d'affaire");
      relabel("nav-objectives", "Objectif & seuil");
      relabel("nav-sources", "Source & Connexion");

      const performance = makeSlot(nav, "architecture-performance-label");
      if (performance.nextSibling !== today) nav.insertBefore(performance, today);

      const book = makeSlot(nav, "architecture-book-label");
      if (book.nextSibling !== yesterday) nav.insertBefore(book, yesterday);

      const middle = makeSlot(nav, "architecture-middle-root");
      if (finance.nextSibling !== middle) nav.insertBefore(middle, finance.nextSibling);

      const settings = makeSlot(nav, "architecture-settings-label");
      if (settings.nextSibling !== objectives) nav.insertBefore(settings, objectives);

      const settingsExtra = makeSlot(nav, "architecture-settings-extra");
      if (sources.nextSibling !== settingsExtra) nav.insertBefore(settingsExtra, sources.nextSibling);

      setHosts((current) => current?.performance === performance && current?.book === book && current?.middle === middle && current?.settings === settings && current?.settingsExtra === settingsExtra
        ? current
        : { performance, book, middle, settings, settingsExtra });
    };

    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHidden("nav-today", !open.performance);
    ["nav-yesterday", "nav-bottlenecks", "nav-walking", "nav-finance"].forEach((id) => setHidden(id, !open.book));
    ["nav-objectives", "nav-sources"].forEach((id) => setHidden(id, !open.settings));
  }, [open, hosts]);

  const toggle = (group: GroupKey) => {
    setOpen((current) => {
      const next = current[group] ? { ...DEFAULT_OPEN } : { ...DEFAULT_OPEN, [group]: true };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const groupHeading = (group: GroupKey, label: string, spaced = false) => (
    <button
      type="button"
      className={`architecture-group-heading${spaced ? " architecture-heading-spaced" : ""}`}
      aria-expanded={open[group]}
      onClick={() => toggle(group)}
      title={open[group] ? `Replier ${label}` : `Déplier ${label}`}
    >
      <span>{label}</span><i className={open[group] ? "is-open" : ""}>›</i>
    </button>
  );

  const link = (href: string, label: string, icon: string) => (
    <a className="architecture-link" href={href}>
      <span className="architecture-icon">{icon}</span><span>{label}</span><i />
    </a>
  );

  return <>
    {hosts && hosts.performance.isConnected ? createPortal(groupHeading("performance", "PERFORMANCE"), hosts.performance) : null}
    {hosts && hosts.book.isConnected ? createPortal(groupHeading("book", "BOOK"), hosts.book) : null}
    {hosts && hosts.middle.isConnected ? createPortal(<>
      {groupHeading("cockpit", "CRVO COCKPIT V2", true)}
      <div className={`architecture-collapse${open.cockpit ? " is-open" : ""}`}>
        <div className="architecture-links">
          {link("/cockpit-v2?section=pilotage", "Pilotage du jour", "↗")}
          {link("/cockpit-v2?section=synthese", "Synthèse managériale", "Σ")}
          {link("/cockpit-v2?section=decision", "Aide à la décision", "◆")}
          {link("/cockpit-v2?section=prevision", "Prévision fin de journée", "◒")}
          {link("/cockpit-v2/carrosserie", "Focus carrosserie", "C")}
        </div>
      </div>
      {groupHeading("client", "DASHBOARD CLIENT", true)}
      <div className={`architecture-collapse${open.client ? " is-open" : ""}`}>
        <div className="architecture-links">
          {link("/dashboard-client?scope=reseau", "Réseau", "R")}
          {link("/dashboard-client?scope=bmw-mini", "BMW / MINI", "B")}
        </div>
      </div>
    </>, hosts.middle) : null}
    {hosts && hosts.settings.isConnected ? createPortal(groupHeading("settings", "PARAMÈTRE", true), hosts.settings) : null}
    {hosts && hosts.settingsExtra.isConnected ? createPortal(
      <div className={`architecture-collapse architecture-settings-collapse${open.settings ? " is-open" : ""}`}>
        <div className="architecture-links architecture-settings-links">
          {link("/account", "Accès", "A")}
          {link("/data-rh", "Data RH", "RH")}
          {link("/atelier", "Ecran ATELIER", "AT")}
          {link("/direction", "Ecran DIRECTION", "DI")}
        </div>
      </div>, hosts.settingsExtra) : null}
    <style>{`
      .sidebar nav .architecture-group-heading{
        width:calc(100% - 20px);margin:15px 10px 7px;padding:7px 3px;border:0;background:transparent;color:rgba(255,255,255,.58);display:flex;align-items:center;justify-content:space-between;gap:8px;font:inherit;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;text-align:left;
      }
      .sidebar nav .architecture-group-heading:hover{color:#fff}
      .sidebar nav .architecture-heading-spaced{margin-top:19px}
      .sidebar nav .architecture-group-heading>i{width:20px;height:20px;display:grid;place-items:center;border-radius:7px;font-style:normal;font-size:18px;line-height:1;color:#009edb;background:rgba(0,158,219,.08);transform:rotate(0deg);transition:transform .18s ease,background .18s ease}
      .sidebar nav .architecture-group-heading:hover>i{background:rgba(0,158,219,.18)}
      .sidebar nav .architecture-group-heading>i.is-open{transform:rotate(90deg)}
      .sidebar nav .architecture-collapse{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .2s ease,opacity .18s ease}
      .sidebar nav .architecture-collapse.is-open{grid-template-rows:1fr;opacity:1}
      .sidebar nav .architecture-collapse>.architecture-links{min-height:0;overflow:hidden}
      .sidebar nav .architecture-links{display:grid;gap:5px}
      .sidebar nav .architecture-link{
        min-height:42px;padding:0 13px;display:grid;grid-template-columns:23px 1fr 6px;align-items:center;gap:11px;border:0;border-radius:10px;color:rgba(255,255,255,.90)!important;background:rgba(0,158,219,.11);text-decoration:none!important;transition:.18s ease;box-shadow:inset 0 0 0 1px rgba(133,221,255,.10);
      }
      .sidebar nav .architecture-link:hover{color:#fff!important;background:rgba(0,158,219,.23);box-shadow:inset 0 0 0 1px rgba(133,221,255,.26)}
      .sidebar nav .architecture-icon{width:23px;height:23px;display:grid;place-items:center;border-radius:7px;color:#fff;background:#004f9f;font-size:10px;line-height:1;font-weight:800}
      .sidebar nav .architecture-link>span:nth-child(2){font-size:11px;font-weight:750;line-height:1.15}
      .sidebar nav .architecture-link>i{width:6px;height:6px;border-radius:50%;background:#009edb;opacity:.8}
      .sidebar nav .architecture-settings-links{margin-bottom:12px}
      #architecture-performance-label,#architecture-book-label,#architecture-middle-root,#architecture-settings-label,#architecture-settings-extra{display:contents}
      @media (max-width:760px){.sidebar nav .architecture-group-heading{margin-left:8px;width:calc(100% - 16px)}.sidebar nav .architecture-link{min-height:44px}}
    `}</style>
  </>;
}
