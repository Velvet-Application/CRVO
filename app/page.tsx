"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type View = "today" | "yesterday" | "bottlenecks" | "oldest" | "sources";
type IconName = "today" | "yesterday" | "bottleneck" | "oldest" | "source" | "calendar" | "refresh" | "menu" | "close" | "arrow" | "check" | "warning" | "car" | "upload";

type Snapshot = {
  date: string;
  label: string;
  source: string;
  entries: number;
  exits: number;
  stock: number;
  over15: number;
  over20: number;
  production: Array<{ name: string; value: number; tone: string }>;
};

type DashboardPayload = {
  snapshot?: Snapshot;
  connected?: boolean;
  backend?: string;
};

type ImportInitPayload = {
  batchId?: string;
  signedUrl?: string;
  duplicate?: boolean;
  authRequired?: boolean;
  error?: string;
};

type ImportFinalizePayload = {
  metrics?: number;
  authRequired?: boolean;
  error?: string;
};

type ImportAuthPayload = {
  authenticated?: boolean;
  method?: "chatgpt" | "cloudflare-access" | "access-code" | null;
  error?: string;
};

const seedSnapshot: Snapshot = {
  date: "2026-08-07",
  label: "07 août 2026",
  source: "Book CRVO Lens - Journée du 07.08.2026.xlsx",
  entries: 78,
  exits: 86,
  stock: 1097,
  over15: 494,
  over20: 399,
  production: [
    { name: "Expertise", value: 80, tone: "coral" },
    { name: "Mécanique", value: 96, tone: "green" },
    { name: "DSP", value: 24, tone: "cyan" },
    { name: "Carrosserie", value: 11, tone: "red" },
    { name: "Préparation", value: 89, tone: "purple" },
    { name: "Qualité", value: 88, tone: "orange" },
    { name: "Sortie usine", value: 86, tone: "blue" },
  ],
};

const views: Array<{ id: View; label: string; short: string; icon: IconName }> = [
  { id: "today", label: "Performance du jour", short: "Aujourd’hui", icon: "today" },
  { id: "yesterday", label: "Dashboard de la veille", short: "Veille", icon: "yesterday" },
  { id: "bottlenecks", label: "Goulots & encours", short: "Goulots", icon: "bottleneck" },
  { id: "oldest", label: "Plus vieux dossiers", short: "Dossiers", icon: "oldest" },
  { id: "sources", label: "Sources & connexion", short: "Sources", icon: "source" },
];

const performanceTargets: Record<string, { daily: number; monthly: number; monthlyTarget: number }> = {
  Expertise: { daily: 90, monthly: 398, monthlyTarget: 449 },
  Mécanique: { daily: 85, monthly: 449, monthlyTarget: 424 },
  DSP: { daily: 48, monthly: 129, monthlyTarget: 240 },
  Carrosserie: { daily: 63, monthly: 71, monthlyTarget: 313 },
  Préparation: { daily: 90, monthly: 441, monthlyTarget: 448 },
  Qualité: { daily: 90, monthly: 446, monthlyTarget: 448 },
  "Sortie usine": { daily: 92, monthly: 444, monthlyTarget: 464 },
};

const rollingDates = ["07 juil", "08", "09", "10", "13", "15", "16", "17", "20", "21", "22", "23", "24", "27", "28", "29", "30", "31", "03 août", "04", "05", "06", "07 août"];

type Bottleneck = { name: string; actual: number; max: number; cadence: number; workDays: number; series: number[]; color: string };
const bottlenecks: Bottleneck[] = [
  { name: "Expertise", actual: 194, max: 160, cadence: 80, workDays: 2.43, color: "#eb5b56", series: [80,74,55,33,83,86,93,132,140,133,143,131,133,150,181,177,245,260,233,205,203,190,194] },
  { name: "Chiffrage", actual: 32, max: 25, cadence: 50, workDays: 0.64, color: "#ee7a70", series: [26,26,25,20,16,19,13,16,17,17,18,18,15,13,11,12,9,9,15,24,19,23,32] },
  { name: "Contrôle technique", actual: 140, max: 70, cadence: 50, workDays: 2.8, color: "#b12d36", series: [143,152,147,160,163,164,133,131,111,112,125,115,120,104,107,106,110,123,125,132,145,132,140] },
  { name: "DSP", actual: 162, max: 50, cadence: 30, workDays: 5.4, color: "#009edb", series: [56,76,80,81,70,73,76,89,84,95,125,133,149,167,192,207,204,188,170,159,134,141,162] },
  { name: "Jantes", actual: 159, max: 60, cadence: 35, workDays: 4.54, color: "#47b9b4", series: [82,91,99,108,95,101,110,113,103,103,111,109,112,119,121,125,108,114,111,122,129,141,159] },
  { name: "Mécanique", actual: 262, max: 160, cadence: 80, workDays: 3.27, color: "#278b65", series: [123,146,175,209,236,224,260,260,247,274,285,287,295,299,307,314,307,305,284,262,251,266,262] },
  { name: "Carrosserie", actual: 280, max: 100, cadence: 50, workDays: 5.6, color: "#004f9f", series: [250,257,256,268,270,269,281,281,258,256,249,255,249,268,269,272,255,259,251,264,236,259,280] },
  { name: "Parc travaux", actual: 394, max: 300, cadence: 80, workDays: 4.93, color: "#344b62", series: [261,289,299,332,364,348,372,374,365,392,397,407,416,437,458,464,440,443,418,393,366,389,394] },
  { name: "Préparation", actual: 11, max: 150, cadence: 80, workDays: 0.14, color: "#8d5ec7", series: [18,13,15,5,3,1,3,10,8,15,8,2,3,4,2,2,2,3,11] },
];

type OldCase = { sector: string; registration: string; order: string; status: string; client: string; days: number };
const oldestCases: OldCase[] = [
  { sector:"Expertise", registration:"UC527058", order:"2085519", status:"En attente de lavage rapide", client:"EMOCAR VISE", days:14.1 },
  { sector:"Expertise", registration:"NL019086", order:"2085517", status:"En attente de lavage rapide", client:"EMOCAR VISE", days:14.1 },
  { sector:"Expertise", registration:"GP489EN", order:"2085534", status:"En attente de lavage rapide", client:"KEOS METZ BY AUTOSPHERE", days:13.9 },
  { sector:"Expertise", registration:"MW504455", order:"2085756", status:"En attente de lavage rapide", client:"GAM-11 Groupe Autosphere Waremme", days:11 },
  { sector:"Expertise", registration:"GF249WH", order:"2085786", status:"En attente de lavage rapide", client:"KEOS HENIN BEAUMONT BY AUTOSPHERE", days:10.8 },
  { sector:"Chiffrage", registration:"GN305QR", order:"2085814", status:"Stocké sur parc d’attente chiffrage", client:"QUANTIUM REIMS BY AUTOSPHERE", days:9.2 },
  { sector:"Chiffrage", registration:"GC176DT", order:"2085465", status:"Stocké sur parc d’attente chiffrage", client:"NYXO RONCQ BY AUTOSPHERE", days:7.6 },
  { sector:"Chiffrage", registration:"GV290AV", order:"2085477", status:"Stocké sur parc d’attente chiffrage", client:"KEOS ENGLOS BY AUTOSPHERE", days:6.3 },
  { sector:"CT", registration:"GE185TR", order:"2085199", status:"Stocké sur parc d’attente (Départ CT)", client:"MOTORCAR MAUBEUGE BY AUTOSPHERE", days:20.2 },
  { sector:"CT", registration:"GJ507MS", order:"2085512", status:"Stocké sur parc d’attente (Départ CT)", client:"KEOS THIONVILLE BY AUTOSPHERE", days:14.1 },
  { sector:"CT", registration:"FX635YC", order:"2085593", status:"Stocké sur parc d’attente (Départ CT)", client:"NYXO LOMME BY AUTOSPHERE", days:12.7 },
  { sector:"DSP", registration:"JV022232", order:"2082631", status:"En attente de DSP", client:"GAM-14 Groupe Autosphere Huy", days:58 },
  { sector:"DSP", registration:"MU073117", order:"2081971", status:"En attente de DSP", client:"GAM-01 Groupe Autosphere Wandre", days:43.1 },
  { sector:"DSP", registration:"GF017YK", order:"2084549", status:"En attente de DSP", client:"KEOS TROYES BY AUTOSPHERE", days:27.1 },
  { sector:"Jantes", registration:"GR756KW", order:"2086054", status:"En attente de jantes", client:"BAYERN SECLIN BY AUTOSPHERE", days:1.1 },
  { sector:"Jantes", registration:"GP860QY", order:"2086000", status:"En attente de jantes", client:"KEOS CHALONS BY AUTOSPHERE", days:1.1 },
  { sector:"Jantes", registration:"HG183QS", order:"2085842", status:"En attente de jantes", client:"TECHSTAR BEAUVAIS BY AUTOSPHERE", days:1.1 },
  { sector:"Mécanique", registration:"EE748AS", order:"2081455", status:"Mécanique en cours", client:"KEOS SAINT AVOLD BY AUTOSPHERE", days:71.9 },
  { sector:"Mécanique", registration:"GN176XF", order:"2084613", status:"En attente de mécanique", client:"BAYERN SECLIN BY AUTOSPHERE", days:23 },
  { sector:"Mécanique", registration:"FM682RP", order:"2085190", status:"En attente de mécanique", client:"ABCIS BEAUVAIS BY AUTOSPHERE", days:11.2 },
  { sector:"Carrosserie", registration:"05U93932", order:"2081974", status:"En attente de carrosserie", client:"GAM-01 Groupe Autosphere Wandre", days:69.9 },
  { sector:"Carrosserie", registration:"66741547", order:"2079442", status:"En attente de carrosserie", client:"KEOS BRUSSELS SA", days:66.2 },
  { sector:"Carrosserie", registration:"GF144NZ", order:"2082200", status:"En attente de Fixline 3", client:"KEOS BETHUNE BY AUTOSPHERE", days:58.2 },
  { sector:"Carrosserie", registration:"GG313FP", order:"2081623", status:"En attente de carrosserie", client:"ABCIS BEAUVAIS BY AUTOSPHERE", days:57.5 },
  { sector:"Préparation", registration:"GN496LT", order:"2085227", status:"En attente de préparation", client:"KEOS CHALONS BY AUTOSPHERE", days:5.8 },
  { sector:"Préparation", registration:"GQ610XF", order:"2084915", status:"En attente de préparation", client:"KEOS WORMHOUT BY AUTOSPHERE", days:2.5 },
  { sector:"Préparation", registration:"GR497FV", order:"2085551", status:"En attente de préparation", client:"KEOS ARRAS BY AUTOSPHERE", days:2.5 },
  { sector:"Qualité", registration:"FF865AE", order:"2085598", status:"En attente de contrôle qualité", client:"KEOS LOMME BY AUTOSPHERE", days:1.5 },
  { sector:"Qualité", registration:"HG415NW", order:"2084250", status:"Travaux suite contrôle qualité", client:"BMW FRANCE Prestations", days:1.2 },
  { sector:"Qualité", registration:"HG568SV", order:"2084485", status:"En attente de contrôle qualité", client:"BMW FRANCE Prestations", days:1 },
  { sector:"Parc travaux", registration:"GT881VT", order:"2078117", status:"Stocké sur parc d’attente travaux", client:"KEOS LENS BY AUTOSPHERE", days:102.6 },
  { sector:"Parc travaux", registration:"GS665JJ", order:"2080687", status:"Stocké sur parc d’attente travaux", client:"KEOS CHALONS BY AUTOSPHERE", days:90.7 },
  { sector:"Parc travaux", registration:"HB946HN", order:"2080646", status:"Stocké sur parc d’attente travaux", client:"TOYOTA FRANCE", days:89.9 },
  { sector:"Parc travaux", registration:"GZ301QN", order:"2080593", status:"Stocké sur parc d’attente travaux", client:"TOYOTA FRANCE", days:88.6 },
  { sector:"Parc travaux", registration:"HE859JS", order:"2081057", status:"Stocké sur parc d’attente travaux", client:"INTENZ REIMS BY AUTOSPHERE", days:85.8 },
];

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    today: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/><path d="m4 6 6-3 6 5 5-5"/></>,
    yesterday: <><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v5m8-5v5M3 10h18M7 14h3m4 0h3m-10 3h3"/></>,
    bottleneck: <><path d="M4 4h16l-5 7v7l-6 3V11Z"/><path d="M8 7h8"/></>,
    oldest: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
    source: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3"/><path d="M21 20v-5h-5"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v4m0 3h.01"/></>,
    car: <><path d="m5 11 2-5h10l2 5"/><path d="M3 12h18v6H3zM6 18v2m12-2v2M6.5 14h.01m11 0h.01"/></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function useDashboard() {
  const [state, setState] = useState({ snapshot: seedSnapshot, connected: false, backend: "book-excel" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<DashboardPayload> : Promise.reject())
      .then((payload) => setState({ snapshot: payload.snapshot ?? seedSnapshot, connected: Boolean(payload.connected), backend: payload.backend ?? "book-excel" }))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return state;
}

function SectionTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <header className="section-title"><div><span>{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>;
}

function Freshness({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  return <div className="freshness"><span className={connected ? "live-dot" : "book-dot"}/><div><strong>{connected ? "Supabase connecté" : "Book chargé"}</strong><small>Données arrêtées au {snapshot.label} · prochaine actualisation après connexion SFTP</small></div><span className="freshness-tag">SOURCE RÉELLE</span></div>;
}

function TodayView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const net = snapshot.entries - snapshot.exits;
  return <div className="view-page">
    <Freshness snapshot={snapshot} connected={connected}/>
    <section className="day-hero">
      <div className="day-hero-copy"><span>PILOTAGE QUOTIDIEN</span><h2>Performance<br/>du jour</h2><p>Un coup d’œil suffit pour voir les ateliers en avance et ceux qui nécessitent une action immédiate.</p></div>
      <div className="day-hero-stats">
        <div><span>Entrées</span><strong>{snapshot.entries}</strong><small>VOP</small></div>
        <div><span>Sorties</span><strong>{snapshot.exits}</strong><small>VOP</small></div>
        <div className={net <= 0 ? "good" : "bad"}><span>Solde flux</span><strong>{net > 0 ? "+" : ""}{net}</strong><small>véhicules</small></div>
      </div>
      <div className="hero-watermark">J</div>
    </section>

    <section className="performance-board">
      <div className="board-ribbon"><div><span>AFFICHAGE PRODUCTION VOP</span><strong>Résultat du dernier jour importé</strong></div><div><Icon name="calendar" size={17}/>{snapshot.label}</div></div>
      <div className="performance-scroll"><div className="performance-grid">
        {snapshot.production.map((item) => {
          const target = performanceTargets[item.name];
          const gap = Math.round(item.value - target.daily);
          const ratio = item.value / target.daily;
          return <article className={`performance-column tone-${item.tone}`} key={item.name}>
            <h3>{item.name}</h3>
            <div className="performance-main"><span>RÉSULTAT</span><strong>{item.value}</strong><small>objectif {Math.round(target.daily)}</small></div>
            <div className="performance-progress"><i style={{ width: `${Math.min(ratio * 100, 100)}%` }}/></div>
            <div className={`performance-gap ${gap >= 0 ? "positive" : "negative"}`}><span>Écart jour</span><strong>{gap > 0 ? "+" : ""}{gap}</strong></div>
            <div className="performance-month"><span>Résultat mois</span><strong>{target.monthly}</strong><small>/ {target.monthlyTarget} cible</small></div>
          </article>;
        })}
      </div></div>
      <div className="board-insight"><Icon name="warning"/><div><strong>Priorité du jour : Carrosserie et DSP</strong><span>Les deux secteurs concentrent les écarts les plus importants à l’objectif journalier.</span></div><button onClick={() => document.getElementById("nav-bottlenecks")?.click()}>Voir les goulots <Icon name="arrow" size={16}/></button></div>
    </section>
  </div>;
}

function YesterdayView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const recent = snapshot.stock - snapshot.over15;
  const between = snapshot.over15 - snapshot.over20;
  const net = snapshot.entries - snapshot.exits;
  const maxProd = Math.max(...snapshot.production.map((item) => item.value));
  return <div className="view-page">
    <Freshness snapshot={snapshot} connected={connected}/>
    <SectionTitle eyebrow="SYNTHÈSE DE LA VEILLE" title="La journée en un écran" description="La lecture consolidée présentée dans le book, simplifiée pour le pilotage quotidien."/>
    <section className="headline-kpis">
      <article className="headline-kpi"><span>ENTRÉES VOP</span><strong>{snapshot.entries}</strong><small>71 EFF + 7 EXT</small></article>
      <article className="headline-kpi"><span>SORTIES VOP</span><strong>{snapshot.exits}</strong><small>objectif 92</small></article>
      <article className="headline-kpi featured"><span>STOCK USINE</span><strong>{snapshot.stock.toLocaleString("fr-FR")}</strong><small>véhicules</small></article>
      <article className="headline-kpi alert"><span>STOCK +20 JOURS</span><strong>{snapshot.over20}</strong><small>{Math.round(snapshot.over20 / snapshot.stock * 100)}% du parc</small></article>
    </section>
    <section className="summary-grid">
      <article className="report-panel production-summary">
        <SectionTitle eyebrow="PRODUCTION" title="Volume par secteur"/>
        <div className="production-list">{snapshot.production.map((item) => <div key={item.name}><span>{item.name}</span><div><i className={`tone-${item.tone}`} style={{ width: `${item.value / maxProd * 100}%` }}/></div><strong>{item.value}</strong></div>)}</div>
      </article>
      <article className="report-panel aging-summary">
        <SectionTitle eyebrow="PARC USINE" title="Ancienneté du stock"/>
        <div className="aging-content"><div className="aging-donut" style={{ "--recent": `${recent / snapshot.stock * 360}deg`, "--between": `${(recent + between) / snapshot.stock * 360}deg` } as React.CSSProperties}><div><strong>{snapshot.stock.toLocaleString("fr-FR")}</strong><span>VÉHICULES</span></div></div><div className="aging-legend"><div><i className="recent"/><span>0–15 jours</span><strong>{recent}</strong></div><div><i className="mid"/><span>16–20 jours</span><strong>{between}</strong></div><div><i className="old"/><span>+20 jours</span><strong>{snapshot.over20}</strong></div></div></div>
      </article>
      <article className="report-panel flow-summary">
        <SectionTitle eyebrow="FLUX" title="Entrées versus sorties" action={<strong className={net <= 0 ? "good-number" : "bad-number"}>{net > 0 ? "+" : ""}{net}</strong>}/>
        <div className="flow-bars"><div><span>Entrées</span><strong>{snapshot.entries}</strong><i style={{ width: `${snapshot.entries}%` }}/></div><div><span>Sorties</span><strong>{snapshot.exits}</strong><i style={{ width: `${snapshot.exits}%` }}/></div></div>
        <p>Le stock a diminué de <strong>{Math.abs(net)} véhicules</strong> sur la journée.</p>
      </article>
      <article className="report-panel watch-summary">
        <SectionTitle eyebrow="POINT DE VIGILANCE" title="Vieillissement du parc"/>
        <div className="watch-number"><strong>{snapshot.over15}</strong><span>véhicules à plus de 15 jours</span></div>
        <div className="watch-scale"><i style={{ width: `${snapshot.over15 / snapshot.stock * 100}%` }}/></div>
        <p>{Math.round(snapshot.over15 / snapshot.stock * 100)}% du stock usine exige un suivi renforcé.</p>
      </article>
    </section>
  </div>;
}

function TrendChart({ item }: { item: Bottleneck }) {
  const width = 760, height = 260, left = 42, right = 20, top = 22, bottom = 42;
  const usableW = width - left - right, usableH = height - top - bottom;
  const maxValue = Math.max(...item.series, item.max) * 1.12;
  const points = item.series.map((value, index) => ({ x: left + index / (item.series.length - 1) * usableW, y: top + (maxValue - value) / maxValue * usableH }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.x},${top + usableH} L${points[0].x},${top + usableH} Z`;
  const thresholdY = top + (maxValue - item.max) / maxValue * usableH;
  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Évolution de l’encours ${item.name} sur 30 jours glissants`}>
    <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={item.color} stopOpacity=".26"/><stop offset="1" stopColor={item.color} stopOpacity=".015"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map((tick) => { const y = top + usableH * tick; return <g key={tick}><line x1={left} x2={width-right} y1={y} y2={y} className="grid-line"/><text x={left-9} y={y+4} textAnchor="end">{Math.round(maxValue * (1-tick))}</text></g>; })}
    <line x1={left} x2={width-right} y1={thresholdY} y2={thresholdY} className="threshold-line"/><text x={width-right} y={thresholdY-7} textAnchor="end" className="threshold-label">SEUIL MAX {item.max}</text>
    <path d={area} fill="url(#areaFill)"/><path d={line} fill="none" stroke={item.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    {points.map((p, i) => (i === 0 || i === points.length-1 || i === Math.floor(points.length/2)) ? <circle key={i} cx={p.x} cy={p.y} r="4" fill="white" stroke={item.color} strokeWidth="3"/> : null)}
    <text x={left} y={height-12}>{rollingDates[0]}</text><text x={left+usableW/2} y={height-12} textAnchor="middle">{rollingDates[Math.floor(rollingDates.length/2)]}</text><text x={width-right} y={height-12} textAnchor="end">{rollingDates.at(-1)}</text>
  </svg></div>;
}

function BottlenecksView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const [selected, setSelected] = useState("Carrosserie");
  const item = bottlenecks.find((entry) => entry.name === selected) ?? bottlenecks[0];
  const start = item.series[0];
  const change = Math.round((item.actual - start) / start * 100);
  const critical = bottlenecks.filter((entry) => entry.actual > entry.max).length;
  return <div className="view-page">
    <Freshness snapshot={snapshot} connected={connected}/>
    <SectionTitle eyebrow="GOULOTS D’ÉTRANGLEMENT" title="Encours par secteur · 30 jours glissants" description="Les seuils, cadences et historiques sont repris du book CRVO. Cliquez sur un secteur pour détailler sa trajectoire." action={<div className="critical-badge"><span>{critical}</span> secteurs au-dessus du seuil</div>}/>
    <section className="bottleneck-layout">
      <article className="report-panel main-trend">
        <div className="trend-heading"><div><span>SECTEUR SÉLECTIONNÉ</span><h3>{item.name}</h3></div><div className="trend-values"><div><span>ENCOURS</span><strong>{item.actual}</strong></div><div><span>ÉVOLUTION</span><strong className={change > 0 ? "negative-text" : "positive-text"}>{change > 0 ? "+" : ""}{change}%</strong></div><div><span>JOURS DE STOCK</span><strong>{item.workDays.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</strong></div></div></div>
        <TrendChart item={item}/>
        <div className="chart-note"><span style={{ background: item.color }}/><strong>Encours réel</strong><i/>Seuil maximum du book · série du 07/07 au 07/08/2026</div>
      </article>
      <aside className="report-panel bottleneck-priority"><SectionTitle eyebrow="PRIORITÉ" title="Charge à résorber"/><strong>{Math.max(item.actual - item.max, 0)}</strong><span>véhicules au-dessus du seuil</span><div><small>Cadence secteur</small><b>{item.cadence} / jour</b></div><p>{item.actual > item.max ? `À cadence constante, le secteur porte ${item.workDays.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} jours de travail en stock.` : "Le secteur reste sous son seuil maximum."}</p></aside>
    </section>
    <section className="bottleneck-cards">{bottlenecks.map((entry) => {
      const ratio = entry.actual / entry.max;
      const first = entry.series[0];
      const delta = Math.round((entry.actual-first)/first*100);
      return <button key={entry.name} className={`${selected === entry.name ? "active" : ""} ${ratio > 1.5 ? "danger" : ratio > 1 ? "warning" : "healthy"}`} onClick={() => setSelected(entry.name)}>
        <span className="sector-color" style={{ background: entry.color }}/><div className="sector-card-head"><strong>{entry.name}</strong><span>{ratio > 1.5 ? "CRITIQUE" : ratio > 1 ? "À SURVEILLER" : "MAÎTRISÉ"}</span></div><div className="sector-card-value"><strong>{entry.actual}</strong><span>/ max {entry.max}</span></div><div className="sector-card-track"><i style={{ width: `${Math.min(ratio * 100, 100)}%`, background: entry.color }}/></div><div className="sector-card-foot"><span>{entry.workDays.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} j de stock</span><b className={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta}%</b></div>
      </button>;
    })}</section>
  </div>;
}

function OldestView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const [sector, setSector] = useState("Tous");
  const sectors = ["Tous", ...Array.from(new Set(oldestCases.map((item) => item.sector)))];
  const filtered = useMemo(() => oldestCases.filter((item) => sector === "Tous" || item.sector === sector).sort((a,b) => b.days-a.days).slice(0, sector === "Tous" ? 12 : 8), [sector]);
  const oldest = filtered[0];
  return <div className="view-page">
    <Freshness snapshot={snapshot} connected={connected}/>
    <SectionTitle eyebrow="FIFO & VIEILLISSEMENT" title="Les plus vieux dossiers par secteur" description="Classement selon le nombre de jours passés sur le statut actuel, pour orienter les actions de déblocage."/>
    <section className="oldest-overview">
      <article className="oldest-callout"><div><span>PLUS ANCIEN · {sector.toUpperCase()}</span><strong>{oldest?.days.toLocaleString("fr-FR")}<small> jours</small></strong><p>{oldest?.registration} · OR {oldest?.order}</p></div><Icon name="car" size={52}/></article>
      <article><span>DOSSIERS AFFICHÉS</span><strong>{filtered.length}</strong><small>extraits du classement FIFO</small></article>
      <article><span>SEUIL D’ALERTE</span><strong>20<small> jours</small></strong><small>priorité renforcée au-delà</small></article>
    </section>
    <div className="sector-filter" role="tablist" aria-label="Filtrer par secteur">{sectors.map((name) => <button role="tab" aria-selected={sector === name} className={sector === name ? "active" : ""} onClick={() => setSector(name)} key={name}>{name}</button>)}</div>
    <section className="report-panel oldest-table-panel">
      <div className="table-heading"><div><span>CLASSEMENT FIFO</span><h3>{sector === "Tous" ? "Priorités tous secteurs" : `Priorités · ${sector}`}</h3></div><small>Jour sur statut · ordre décroissant</small></div>
      <div className="table-scroll"><table className="oldest-table"><thead><tr><th>Rang</th><th>Secteur</th><th>Immatriculation</th><th>OR</th><th>Dernier statut</th><th>Client</th><th>Jours</th></tr></thead><tbody>{filtered.map((entry,index) => <tr key={`${entry.order}-${entry.sector}`}><td><span className={`rank rank-${Math.min(index+1,4)}`}>{index+1}</span></td><td><span className="sector-pill">{entry.sector}</span></td><td><strong>{entry.registration}</strong></td><td>{entry.order}</td><td>{entry.status}</td><td>{entry.client}</td><td><strong className={entry.days > 40 ? "age-critical" : entry.days > 20 ? "age-warning" : "age-normal"}>{entry.days.toLocaleString("fr-FR")}</strong></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}

function SourcesView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/import-book/auth", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<ImportAuthPayload>)
      .then((payload) => setAuthorized(Boolean(payload.authenticated)))
      .catch(() => setAuthorized(false));
    return () => controller.abort();
  }, []);

  async function unlockImport() {
    setAuthMessage("Vérification…");
    try {
      const response = await fetch("/api/import-book/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode }),
      });
      const payload = await response.json() as ImportAuthPayload;
      if (!response.ok || !payload.authenticated) {
        throw new Error(payload.error || "Le déverrouillage a échoué.");
      }
      setAuthorized(true);
      setAccessCode("");
      setAuthMessage("Import sécurisé déverrouillé sur cet appareil.");
    } catch (error) {
      setAuthorized(false);
      setAuthMessage(error instanceof Error ? error.message : "Le déverrouillage a échoué.");
    }
  }

  function detectDate(filename: string) {
    const iso = filename.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const french = filename.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/);
    if (french) return `${french[3]}-${french[2]}-${french[1]}`;
    return new Date().toISOString().slice(0, 10);
  }

  async function readBook(selected: File) {
    const XLSX = await import("@e965/xlsx");
    const buffer = await selected.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const workbook = XLSX.read(buffer, { type: "array", sheets: ["Synthèse", "Tdb Production"] });
    const summary = workbook.Sheets["Synthèse"];
    const production = workbook.Sheets["Tdb Production"];
    if (!summary || !production) throw new Error("Ce fichier ne contient pas les feuilles CRVO attendues.");
    const value = (sheet: typeof summary, cell: string) => {
      const parsed = Number(sheet[cell]?.v);
      if (!Number.isFinite(parsed)) throw new Error(`La donnée ${cell} est absente du book.`);
      return parsed;
    };
    const metrics = [
      { key: "entries_vop", label: "Entrées VOP", value: value(summary, "E4") + value(summary, "E5") },
      { key: "exits_vop", label: "Sorties VOP", value: value(summary, "E6") },
      { key: "factory_stock", label: "Stock usine", value: value(summary, "E8") },
      { key: "stock_over_15d", label: "Stock de plus de 15 jours", value: value(summary, "E10") + value(summary, "E11") },
      { key: "stock_over_20d", label: "Stock de plus de 20 jours", value: value(summary, "E12") + value(summary, "E13") },
      { key: "production_expertise", label: "Production Expertise", value: value(production, "G6") },
      { key: "production_mechanics", label: "Production Mécanique", value: value(production, "M6") },
      { key: "production_dsp", label: "Production DSP", value: value(production, "S6") },
      { key: "production_bodywork", label: "Production Carrosserie", value: value(production, "Y6") },
      { key: "production_preparation", label: "Production Préparation", value: value(production, "AE6") },
      { key: "production_quality", label: "Production Qualité", value: value(production, "AK6") },
      { key: "production_factory_exit", label: "Production Sortie usine", value: value(production, "AQ6") },
    ];
    return { buffer, hash, metrics, snapshotAt: detectDate(selected.name) };
  }

  async function uploadBook() {
    if (!file || status === "reading" || status === "uploading") return;
    try {
      setStatus("reading"); setMessage("Lecture et contrôle du book…");
      const book = await readBook(file);
      setStatus("uploading"); setMessage("Archivage sécurisé de l’original…");
      const initResponse = await fetch("/api/import-book/init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, byteSize: file.size, sha256: book.hash, snapshotAt: book.snapshotAt, contentType: file.type }) });
      const init = await initResponse.json() as ImportInitPayload;
      if (init.authRequired) setAuthorized(false);
      if (!initResponse.ok) throw new Error(init.duplicate ? "Ce book est déjà présent dans l’historique." : init.error || "L’import n’a pas pu démarrer.");
      if (!init.signedUrl || !init.batchId) throw new Error("La préparation de l’import est incomplète.");
      const formData = new FormData(); formData.append("cacheControl", "3600"); formData.append("", file);
      const uploadResponse = await fetch(init.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: formData });
      if (!uploadResponse.ok) throw new Error("Le transfert de l’original a été interrompu.");
      setMessage("Création de l’instantané du jour…");
      const finalizeResponse = await fetch("/api/import-book/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: init.batchId, metrics: book.metrics }) });
      const finalized = await finalizeResponse.json() as ImportFinalizePayload;
      if (finalized.authRequired) setAuthorized(false);
      if (!finalizeResponse.ok) throw new Error(finalized.error || "La validation du book a échoué.");
      if (typeof finalized.metrics !== "number") throw new Error("La validation du book n’a pas renvoyé son bilan.");
      setStatus("done"); setMessage(`Book du ${new Intl.DateTimeFormat("fr-FR").format(new Date(`${book.snapshotAt}T12:00:00`))} intégré : ${finalized.metrics} indicateurs enregistrés.`);
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (error) {
      setStatus("error"); setMessage(error instanceof Error ? error.message : "Une erreur est survenue.");
    }
  }

  return <div className="view-page">
    <Freshness snapshot={snapshot} connected={connected}/>
    <SectionTitle eyebrow="DATA HUB" title="Sources & actualisation" description="Le dashboard fonctionne déjà sur le book réel. La collecte automatique démarrera dès réception des paramètres IT."/>
    <section className="book-uploader">
      <div className="upload-heading"><div className="upload-mark"><Icon name="upload" size={28}/></div><div><span>IMPORT MANUEL</span><h3>Ajouter un book CRVO</h3><p>Dépose le fichier Excel du jour ou un book antérieur. Chaque journée est contrôlée, archivée et ajoutée à l’historique sans écraser les précédentes.</p></div></div>
      {authorized === false && <div className="import-unlock">
        <div><span>ACCÈS PROTÉGÉ</span><strong>Déverrouiller l’import</strong><small>Le code n’est demandé qu’une fois par appareil.</small></div>
        <div className="import-unlock-form"><input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && accessCode) void unlockImport(); }} placeholder="Code d’accès" autoComplete="current-password" aria-label="Code d’accès à l’import"/><button onClick={() => void unlockImport()} disabled={!accessCode}>Déverrouiller</button></div>
        {authMessage && <p className="import-auth-message">{authMessage}</p>}
      </div>}
      {authorized === true && <div className="import-authorized"><Icon name="check" size={17}/><span>{authMessage || "Import sécurisé actif"}</span></div>}
      <label className={file ? "drop-zone selected" : "drop-zone"}><input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setStatus("idle"); setMessage(""); }}/><Icon name={file ? "check" : "upload"} size={24}/><strong>{file ? file.name : "Glisser-déposer ou choisir un fichier"}</strong><small>{file ? `${(file.size / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo · prêt à contrôler` : "Formats acceptés : XLSX ou XLS · 250 Mo maximum"}</small></label>
      <div className="upload-actions"><button disabled={!file || authorized !== true || status === "reading" || status === "uploading"} onClick={uploadBook}>{status === "reading" || status === "uploading" ? <Icon name="refresh" size={17}/> : <Icon name="upload" size={17}/>} {status === "reading" ? "Contrôle en cours…" : status === "uploading" ? "Import en cours…" : authorized === null ? "Vérification de l’accès…" : authorized === false ? "Déverrouiller avant l’import" : "Importer ce book"}</button><div className={`upload-feedback ${status}`}><i/>{message || "La date est détectée depuis le nom du fichier. Les doublons sont bloqués automatiquement."}</div></div>
    </section>
    <section className="source-cards">
      <article className="source-card active"><div className="source-icon"><Icon name="source"/></div><div><span>BASE DE DONNÉES</span><h3>Supabase KPI CRVO</h3><p>Historique immuable, 12 indicateurs réels et règles de sécurité actives.</p></div><strong><i/>CONNECTÉ</strong></article>
      <article className="source-card active"><div className="source-icon excel">XL</div><div><span>SOURCE PROVISOIRE</span><h3>Book CRVO · 07/08/2026</h3><p>75 feuilles analysées, vues de production, goulots et FIFO intégrées.</p></div><strong><i/>CHARGÉ</strong></article>
      <article className="source-card pending"><div className="source-icon"><Icon name="refresh"/></div><div><span>COLLECTE AUTOMATIQUE</span><h3>Passerelle SFTP</h3><p>Lecture seule, déduplication SHA-256 et archivage des originaux.</p></div><strong><i/>ATTENTE IT</strong></article>
    </section>
    <section className="report-panel source-next"><SectionTitle eyebrow="PROCHAINE ÉTAPE" title="Brancher le flux quotidien"/><div className="source-steps"><div className="done"><b>1</b><span><strong>Cloudflare</strong><small>Application déployée</small></span><Icon name="check"/></div><div className="done"><b>2</b><span><strong>Supabase</strong><small>Base connectée et sécurisée</small></span><Icon name="check"/></div><div><b>3</b><span><strong>Informations IT</strong><small>Hôte, chemin et empreinte SFTP</small></span><span className="wait-tag">EN ATTENTE</span></div><div><b>4</b><span><strong>Mapping automatique</strong><small>Alimentation quotidienne de toutes les vues</small></span></div></div></section>
  </div>;
}

export default function Dashboard() {
  const [view, setView] = useState<View>("today");
  const [menuOpen, setMenuOpen] = useState(false);
  const { snapshot, connected } = useDashboard();
  const current = views.find((item) => item.id === view) ?? views[0];
  function navigate(next: View) { setView(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <div className="app-shell">
    <aside className={menuOpen ? "sidebar open" : "sidebar"}>
      <div className="sidebar-brand"><Image src="/crvo-logo.png" width={190} height={65} alt="CRVO - Votre potentiel VO au plus haut" priority unoptimized/></div>
      <div className="sidebar-context"><span>REPORTING</span><strong>CRVO Lens</strong><small>Pilotage opérationnel</small></div>
      <nav>{views.map((item) => <button id={`nav-${item.id}`} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon}/><span>{item.label}</span>{view === item.id && <i/>}</button>)}</nav>
      <div className="sidebar-bottom"><span className={connected ? "live-dot" : "book-dot"}/><div><strong>{connected ? "Données connectées" : "Mode book Excel"}</strong><small>Dernier import · {snapshot.label}</small></div></div>
    </aside>
    {menuOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)}/>} 
    <main className="main-workspace">
      <header className="topbar"><button className="menu-button" aria-label="Ouvrir le menu" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"}/></button><div className="topbar-brand"><Image src="/crvo-logo.png" width={151} height={47} alt="CRVO - Votre potentiel VO au plus haut" priority unoptimized/></div><div className="topbar-title"><span>REPORTING CRVO LENS</span><h1>{current.label}</h1></div><div className="topbar-date"><Icon name="calendar"/><div><span>DERNIÈRE DONNÉE</span><strong>{snapshot.label}</strong></div></div></header>
      {view === "today" && <TodayView snapshot={snapshot} connected={connected}/>} 
      {view === "yesterday" && <YesterdayView snapshot={snapshot} connected={connected}/>} 
      {view === "bottlenecks" && <BottlenecksView snapshot={snapshot} connected={connected}/>} 
      {view === "oldest" && <OldestView snapshot={snapshot} connected={connected}/>} 
      {view === "sources" && <SourcesView snapshot={snapshot} connected={connected}/>} 
      <nav className="mobile-nav">{views.slice(0,4).map((item) => <button className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon}/><span>{item.short}</span></button>)}</nav>
    </main>
  </div>;
}
