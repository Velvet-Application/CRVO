"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type View = "today" | "yesterday" | "bottlenecks" | "walking" | "finance" | "objectives" | "sources";
type IconName = "today" | "yesterday" | "bottleneck" | "walking" | "finance" | "target" | "source" | "calendar" | "refresh" | "menu" | "close" | "check" | "warning" | "car" | "upload";

type Production = { name: string; value: number; tone: string };
type Snapshot = {
  date: string;
  label: string;
  source: string;
  entries: number;
  exits: number;
  stock: number;
  over15: number;
  over20: number;
  production: Production[];
};

type Objective = {
  month?: string;
  sectorKey: string;
  sectorLabel: string;
  dailyTarget: number;
  minThreshold: number | null;
  maxThreshold: number | null;
};

type FinancialSnapshot = {
  date: string;
  source: string;
  filename: string;
  metrics: Record<string, number | string | null>;
  importedAt?: string;
};

type OldCase = { sector: string; registration: string; order: string; status: string; client: string; days: number };
type Bottleneck = { name: string; actual: number; fallbackMax: number; cadence: number; workDays: number; series: number[]; color: string };

type ImportInitPayload = { batchId?: string; signedUrl?: string; duplicate?: boolean; authRequired?: boolean; error?: string };
type ImportFinalizePayload = { metrics?: number; authRequired?: boolean; error?: string };
type ImportAuthPayload = { authenticated?: boolean; method?: "chatgpt" | "cloudflare-access" | "access-code" | null; error?: string };

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

const fallbackTargets: Record<string, number> = {
  Expertise: 90,
  Mécanique: 85,
  DSP: 48,
  Carrosserie: 63,
  Préparation: 90,
  Qualité: 90,
  "Sortie usine": 92,
};

const sectorKeys: Record<string, string> = {
  Expertise: "expertise",
  Chiffrage: "chiffrage",
  "Contrôle technique": "controle_technique",
  CT: "controle_technique",
  DSP: "dsp",
  Jantes: "jantes",
  Mécanique: "mecanique",
  Carrosserie: "carrosserie",
  "Parc travaux": "parc_travaux",
  Préparation: "preparation",
  Qualité: "qualite",
  "Sortie usine": "sortie_usine",
};

const objectiveSectors = [
  ["expertise", "Expertise", 90, null, 160],
  ["chiffrage", "Chiffrage", 50, null, 25],
  ["controle_technique", "Contrôle technique", 50, null, 70],
  ["dsp", "DSP", 48, null, 50],
  ["jantes", "Jantes", 35, null, 60],
  ["mecanique", "Mécanique", 85, null, 160],
  ["carrosserie", "Carrosserie", 63, null, 100],
  ["parc_travaux", "Parc travaux", 80, null, 300],
  ["preparation", "Préparation", 90, null, 150],
  ["qualite", "Qualité", 90, null, null],
  ["sortie_usine", "Sortie usine", 92, null, null],
] as const;

const views: Array<{ id: View; label: string; short: string; icon: IconName }> = [
  { id: "today", label: "Performance du jour", short: "Aujourd’hui", icon: "today" },
  { id: "yesterday", label: "Dashboard de la veille", short: "Synthèse", icon: "yesterday" },
  { id: "bottlenecks", label: "Goulots & encours", short: "Goulots", icon: "bottleneck" },
  { id: "walking", label: "Walking DEAD", short: "Walking DEAD", icon: "walking" },
  { id: "finance", label: "Chiffre d’affaires", short: "CA", icon: "finance" },
  { id: "objectives", label: "Objectifs & seuils", short: "Objectifs", icon: "target" },
  { id: "sources", label: "Sources & connexion", short: "Sources", icon: "source" },
];

const rollingDates = ["07 juil", "08", "09", "10", "13", "15", "16", "17", "20", "21", "22", "23", "24", "27", "28", "29", "30", "31", "03 août", "04", "05", "06", "07 août"];

const bottlenecks: Bottleneck[] = [
  { name: "Expertise", actual: 194, fallbackMax: 160, cadence: 80, workDays: 2.43, color: "#eb5b56", series: [80,74,55,33,83,86,93,132,140,133,143,131,133,150,181,177,245,260,233,205,203,190,194] },
  { name: "Chiffrage", actual: 32, fallbackMax: 25, cadence: 50, workDays: 0.64, color: "#ee7a70", series: [26,26,25,20,16,19,13,16,17,17,18,18,15,13,11,12,9,9,15,24,19,23,32] },
  { name: "Contrôle technique", actual: 140, fallbackMax: 70, cadence: 50, workDays: 2.8, color: "#b12d36", series: [143,152,147,160,163,164,133,131,111,112,125,115,120,104,107,106,110,123,125,132,145,132,140] },
  { name: "DSP", actual: 162, fallbackMax: 50, cadence: 30, workDays: 5.4, color: "#009edb", series: [56,76,80,81,70,73,76,89,84,95,125,133,149,167,192,207,204,188,170,159,134,141,162] },
  { name: "Jantes", actual: 159, fallbackMax: 60, cadence: 35, workDays: 4.54, color: "#47b9b4", series: [82,91,99,108,95,101,110,113,103,103,111,109,112,119,121,125,108,114,111,122,129,141,159] },
  { name: "Mécanique", actual: 262, fallbackMax: 160, cadence: 80, workDays: 3.27, color: "#278b65", series: [123,146,175,209,236,224,260,260,247,274,285,287,295,299,307,314,307,305,284,262,251,266,262] },
  { name: "Carrosserie", actual: 280, fallbackMax: 100, cadence: 50, workDays: 5.6, color: "#004f9f", series: [250,257,256,268,270,269,281,281,258,256,249,255,249,268,269,272,255,259,251,264,236,259,280] },
  { name: "Parc travaux", actual: 394, fallbackMax: 300, cadence: 80, workDays: 4.93, color: "#344b62", series: [261,289,299,332,364,348,372,374,365,392,397,407,416,437,458,464,440,443,418,393,366,389,394] },
  { name: "Préparation", actual: 11, fallbackMax: 150, cadence: 80, workDays: 0.14, color: "#8d5ec7", series: [18,13,15,5,3,1,3,10,8,15,8,2,3,4,2,2,2,3,11] },
];

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
    yesterday: <><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v5m8-5v5M3 10h18"/></>,
    bottleneck: <><path d="M4 4h16l-5 7v7l-6 3V11Z"/><path d="M8 7h8"/></>,
    walking: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2M7 4l-2-2m12 2 2-2"/></>,
    finance: <><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/><path d="m4 7 6-3 6 4 5-5"/><path d="M12 3v18"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    source: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3"/><path d="M21 20v-5h-5"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v4m0 3h.01"/></>,
    car: <><path d="m5 11 2-5h10l2 5"/><path d="M3 12h18v6H3zM6 18v2m12-2v2M6.5 14h.01m11 0h.01"/></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

function monthKey(date: string) { return date.slice(0, 7); }
function displayDate(date: string) { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function euro(value: unknown) { const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "—"; }
function number(value: unknown, decimals = 0) { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString("fr-FR", { maximumFractionDigits: decimals }) : "—"; }

function SectionTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <header className="section-title"><div><span>{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>;
}

function Freshness({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  return <div className="freshness"><span className={connected ? "live-dot" : "book-dot"}/><div><strong>{connected ? "Supabase connecté" : "Book chargé"}</strong><small>Données arrêtées au {snapshot.label} · historique et filtres actifs dès qu’un book est importé</small></div><span className="freshness-tag">SOURCE RÉELLE</span></div>;
}

function DateRangeFilter({ start, end, min, max, onStart, onEnd, label = "Période analysée" }: { start: string; end: string; min: string; max: string; onStart: (value: string) => void; onEnd: (value: string) => void; label?: string }) {
  return <div className="period-filter"><span>{label}</span><label>Du <input type="date" min={min} max={end || max} value={start} onChange={(event) => onStart(event.target.value)}/></label><label>au <input type="date" min={start || min} max={max} value={end} onChange={(event) => onEnd(event.target.value)}/></label></div>;
}

function useDashboardData() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([seedSnapshot]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard?history=1", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { snapshots?: Snapshot[]; snapshot?: Snapshot; connected?: boolean }) => {
        const rows = payload.snapshots?.length ? payload.snapshots : payload.snapshot ? [payload.snapshot] : [seedSnapshot];
        setSnapshots([...rows].sort((a,b) => a.date.localeCompare(b.date)));
        setConnected(Boolean(payload.connected));
      }).catch(() => undefined);
    const timer = window.setInterval(() => {
      fetch(`/api/dashboard?history=1&_=${Date.now()}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((payload: { snapshots?: Snapshot[]; snapshot?: Snapshot; connected?: boolean }) => {
          const rows = payload.snapshots?.length ? payload.snapshots : payload.snapshot ? [payload.snapshot] : [];
          if (rows.length) { setSnapshots([...rows].sort((a,b) => a.date.localeCompare(b.date))); setConnected(Boolean(payload.connected)); }
        }).catch(() => undefined);
    }, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  return { snapshots, connected };
}

function useObjectives(month: string) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/objectives?month=${month}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: { objectives?: Objective[] }) => setObjectives(payload.objectives ?? []))
      .catch(() => setObjectives([])).finally(() => setLoading(false));
    return () => controller.abort();
  }, [month]);
  const map = useMemo(() => Object.fromEntries(objectives.map((item) => [item.sectorKey, item])), [objectives]);
  return { objectives, setObjectives, objectiveMap: map as Record<string, Objective>, loading };
}

function targetFor(name: string, objectiveMap: Record<string, Objective>) {
  const item = objectiveMap[sectorKeys[name]];
  return item?.dailyTarget ?? fallbackTargets[name] ?? 0;
}

function TodayView({ snapshots, connected, objectiveMap }: { snapshots: Snapshot[]; connected: boolean; objectiveMap: Record<string, Objective> }) {
  const snapshot = snapshots.at(-1) ?? seedSnapshot;
  const previous = snapshots.length > 1 ? snapshots.at(-2) : null;
  const stockGap = previous ? snapshot.stock - previous.stock : 0;
  const minDate = snapshots[0]?.date ?? snapshot.date;
  const maxDate = snapshot.date;
  const monthStart = `${maxDate.slice(0, 7)}-01`;
  const [start, setStart] = useState(monthStart);
  const [end, setEnd] = useState(maxDate);
  useEffect(() => {
    setStart((value) => !value || value === seedSnapshot.date ? monthStart : value);
    setEnd((value) => !value || value === seedSnapshot.date || value < maxDate ? maxDate : value);
  }, [maxDate, monthStart]);
  const period = useMemo(() => snapshots.filter((item) => item.date >= start && item.date <= end), [snapshots, start, end]);
  const days = Math.max(period.length, 1);
  const cumulative = snapshot.production.map((item) => ({
    name: item.name,
    tone: item.tone,
    actual: period.reduce((sum, day) => sum + (day.production.find((prod) => prod.name === item.name)?.value ?? 0), 0),
    target: targetFor(item.name, objectiveMap) * days,
  }));
  return <div className="view-page">
    <Freshness snapshot={snapshot} connected={connected}/>
    <section className="day-hero">
      <div className="day-hero-copy"><span>PILOTAGE QUOTIDIEN</span><h2>Performance<br/>du jour</h2><p>Résultat opérationnel du dernier book, comparé aux objectifs configurés pour le mois.</p></div>
      <div className="day-hero-stats">
        <div><span>Entrées</span><strong>{snapshot.entries}</strong><small>VOP</small></div>
        <div><span>Sorties</span><strong>{snapshot.exits}</strong><small>objectif {targetFor("Sortie usine", objectiveMap)}</small></div>
        <div className={stockGap <= 0 ? "good" : "bad"}><span>Écart de stock</span><strong>{previous ? `${stockGap > 0 ? "+" : ""}${stockGap}` : "—"}</strong><small>{previous ? "vs veille" : "1re journée"}</small></div>
      </div>
      <div className="hero-watermark">J</div>
    </section>

    <section className="performance-board">
      <div className="board-ribbon"><div><span>INDICATEURS DU JOUR VS OBJECTIF</span><strong>Production VOP par activité</strong></div><div><Icon name="calendar" size={17}/>{snapshot.label}</div></div>
      <div className="performance-scroll"><div className="performance-grid">
        {snapshot.production.map((item) => {
          const target = targetFor(item.name, objectiveMap);
          const gap = item.value - target;
          const ratio = target ? item.value / target : 0;
          return <article className={`performance-column tone-${item.tone}`} key={item.name}>
            <h3>{item.name}</h3>
            <div className="performance-main"><span>RÉSULTAT JOUR</span><strong>{item.value}</strong><small>objectif {target}</small></div>
            <div className="performance-progress"><i style={{ width: `${Math.min(ratio * 100, 100)}%` }}/></div>
            <div className={`performance-gap ${gap >= 0 ? "positive" : "negative"}`}><span>Écart</span><strong>{gap > 0 ? "+" : ""}{gap}</strong></div>
          </article>;
        })}
      </div></div>
    </section>

    <section className="performance-board cumulative-board">
      <div className="board-ribbon range-ribbon"><div><span>CUMUL SUR LA PÉRIODE</span><strong>{period.length} journée{period.length > 1 ? "s" : ""} importée{period.length > 1 ? "s" : ""}</strong></div><DateRangeFilter start={start} end={end} min={minDate} max={maxDate} onStart={setStart} onEnd={setEnd}/></div>
      <div className="performance-scroll"><div className="performance-grid">
        {cumulative.map((item) => {
          const gap = item.actual - item.target;
          const ratio = item.target ? item.actual / item.target : 0;
          return <article className={`performance-column tone-${item.tone}`} key={item.name}>
            <h3>{item.name}</h3>
            <div className="performance-main"><span>RÉSULTAT PÉRIODE</span><strong>{item.actual}</strong><small>objectif {item.target}</small></div>
            <div className="performance-progress"><i style={{ width: `${Math.min(ratio * 100, 100)}%` }}/></div>
            <div className={`performance-gap ${gap >= 0 ? "positive" : "negative"}`}><span>Écart période</span><strong>{gap > 0 ? "+" : ""}{gap}</strong></div>
          </article>;
        })}
      </div></div>
    </section>
  </div>;
}

function SummaryView({ snapshots, connected, objectiveMap }: { snapshots: Snapshot[]; connected: boolean; objectiveMap: Record<string, Objective> }) {
  const latest = snapshots.at(-1) ?? seedSnapshot;
  const minDate = snapshots[0]?.date ?? latest.date;
  const maxDate = latest.date;
  const defaultStart = snapshots.length > 1 ? snapshots[Math.max(0, snapshots.length - 2)].date : latest.date;
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(maxDate);
  const period = useMemo(() => snapshots.filter((item) => item.date >= start && item.date <= end), [snapshots, start, end]);
  const last = period.at(-1) ?? latest;
  const days = Math.max(period.length, 1);
  const entries = period.reduce((sum, item) => sum + item.entries, 0);
  const exits = period.reduce((sum, item) => sum + item.exits, 0);
  const exitTarget = targetFor("Sortie usine", objectiveMap) * days;
  const recent = Math.max(last.stock - last.over15, 0);
  const between = Math.max(last.over15 - last.over20, 0);
  const aggregatedProduction = last.production.map((prod) => ({ ...prod, value: period.reduce((sum, day) => sum + (day.production.find((item) => item.name === prod.name)?.value ?? 0), 0) }));
  const maxProd = Math.max(...aggregatedProduction.map((item) => item.value), 1);
  return <div className="view-page">
    <Freshness snapshot={last} connected={connected}/>
    <SectionTitle eyebrow="SYNTHÈSE OPÉRATIONNELLE" title="La période en un écran" description="Même lecture que la veille, avec objectifs et sélection d’une ou plusieurs journées." action={<DateRangeFilter start={start} end={end} min={minDate} max={maxDate} onStart={setStart} onEnd={setEnd} label="Filtre"/>}/>
    <section className="headline-kpis">
      <article className="headline-kpi"><span>ENTRÉES VOP</span><strong>{entries}</strong><small>{days} jour{days > 1 ? "s" : ""}</small></article>
      <article className={`headline-kpi ${exits >= exitTarget ? "success" : "alert"}`}><span>SORTIES VOP</span><strong>{exits}</strong><small>objectif période {exitTarget}</small></article>
      <article className="headline-kpi featured"><span>STOCK USINE</span><strong>{last.stock.toLocaleString("fr-FR")}</strong><small>dernier jour sélectionné</small></article>
      <article className="headline-kpi alert"><span>STOCK +20 JOURS</span><strong>{last.over20}</strong><small>{Math.round(last.over20 / Math.max(last.stock, 1) * 100)}% du parc</small></article>
    </section>
    <section className="summary-grid">
      <article className="report-panel production-summary">
        <SectionTitle eyebrow="PRODUCTION" title="Réalisé vs objectif période"/>
        <div className="production-list">{aggregatedProduction.map((item) => { const target = targetFor(item.name, objectiveMap) * days; return <div key={item.name}><span>{item.name}</span><div><i className={`tone-${item.tone}`} style={{ width: `${item.value / maxProd * 100}%` }}/></div><strong>{item.value}<small>/ {target}</small></strong></div>; })}</div>
      </article>
      <article className="report-panel aging-summary">
        <SectionTitle eyebrow="PARC USINE" title="Ancienneté du stock"/>
        <div className="aging-content"><div className="aging-donut" style={{ "--recent": `${recent / Math.max(last.stock,1) * 360}deg`, "--between": `${(recent + between) / Math.max(last.stock,1) * 360}deg` } as React.CSSProperties}><div><strong>{last.stock.toLocaleString("fr-FR")}</strong><span>VÉHICULES</span></div></div><div className="aging-legend"><div><i className="recent"/><span>0–15 jours</span><strong>{recent}</strong></div><div><i className="mid"/><span>16–20 jours</span><strong>{between}</strong></div><div><i className="old"/><span>+20 jours</span><strong>{last.over20}</strong></div></div></div>
      </article>
      <article className="report-panel flow-summary">
        <SectionTitle eyebrow="FLUX" title="Entrées versus sorties" action={<strong className={exits >= entries ? "good-number" : "bad-number"}>{exits - entries > 0 ? "+" : ""}{exits - entries}</strong>}/>
        <div className="flow-bars"><div><span>Entrées</span><strong>{entries}</strong><i style={{ width: `${Math.min(entries / Math.max(entries, exits, 1) * 100, 100)}%` }}/></div><div><span>Sorties</span><strong>{exits}</strong><i style={{ width: `${Math.min(exits / Math.max(entries, exits, 1) * 100, 100)}%` }}/></div></div>
        <p>Objectif de sorties sur la période : <strong>{exitTarget}</strong>.</p>
      </article>
      <article className="report-panel watch-summary">
        <SectionTitle eyebrow="POINT DE VIGILANCE" title="Vieillissement du parc"/>
        <div className="watch-number"><strong>{last.over15}</strong><span>véhicules à plus de 15 jours</span></div>
        <div className="watch-scale"><i style={{ width: `${last.over15 / Math.max(last.stock,1) * 100}%` }}/></div>
        <p>{Math.round(last.over15 / Math.max(last.stock,1) * 100)}% du stock du dernier jour sélectionné exige un suivi renforcé.</p>
      </article>
    </section>
  </div>;
}

function TrendChart({ item, max }: { item: Bottleneck; max: number }) {
  const width = 760, height = 260, left = 42, right = 20, top = 22, bottom = 42;
  const usableW = width - left - right, usableH = height - top - bottom;
  const maxValue = Math.max(...item.series, max) * 1.12;
  const points = item.series.map((value, index) => ({ x: left + index / (item.series.length - 1) * usableW, y: top + (maxValue - value) / maxValue * usableH }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.x},${top + usableH} L${points[0].x},${top + usableH} Z`;
  const thresholdY = top + (maxValue - max) / maxValue * usableH;
  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Évolution de l’encours ${item.name}`}>
    <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={item.color} stopOpacity=".26"/><stop offset="1" stopColor={item.color} stopOpacity=".015"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map((tick) => { const y = top + usableH * tick; return <g key={tick}><line x1={left} x2={width-right} y1={y} y2={y} className="grid-line"/><text x={left-9} y={y+4} textAnchor="end">{Math.round(maxValue * (1-tick))}</text></g>; })}
    <line x1={left} x2={width-right} y1={thresholdY} y2={thresholdY} className="threshold-line"/><text x={width-right} y={thresholdY-7} textAnchor="end" className="threshold-label">SEUIL MAX {max}</text>
    <path d={area} fill="url(#areaFill)"/><path d={line} fill="none" stroke={item.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <text x={left} y={height-12}>{rollingDates[0]}</text><text x={left+usableW/2} y={height-12} textAnchor="middle">{rollingDates[Math.floor(rollingDates.length/2)]}</text><text x={width-right} y={height-12} textAnchor="end">{rollingDates.at(-1)}</text>
  </svg></div>;
}

function BottlenecksView({ snapshot, connected, objectiveMap }: { snapshot: Snapshot; connected: boolean; objectiveMap: Record<string, Objective> }) {
  const [selected, setSelected] = useState("Carrosserie");
  const item = bottlenecks.find((entry) => entry.name === selected) ?? bottlenecks[0];
  const maxFor = (entry: Bottleneck) => objectiveMap[sectorKeys[entry.name]]?.maxThreshold ?? entry.fallbackMax;
  const max = maxFor(item);
  const start = item.series[0];
  const change = Math.round((item.actual - start) / start * 100);
  const critical = bottlenecks.filter((entry) => entry.actual > maxFor(entry)).length;
  return <div className="view-page"><Freshness snapshot={snapshot} connected={connected}/><SectionTitle eyebrow="GOULOTS D’ÉTRANGLEMENT" title="Encours par secteur · 30 jours glissants" description="Les seuils maximum sont repris automatiquement de l’onglet Objectifs & seuils." action={<div className="critical-badge"><span>{critical}</span> secteurs au-dessus du seuil</div>}/>
    <section className="bottleneck-layout"><article className="report-panel main-trend"><div className="trend-heading"><div><span>SECTEUR SÉLECTIONNÉ</span><h3>{item.name}</h3></div><div className="trend-values"><div><span>ENCOURS</span><strong>{item.actual}</strong></div><div><span>ÉVOLUTION</span><strong className={change > 0 ? "negative-text" : "positive-text"}>{change > 0 ? "+" : ""}{change}%</strong></div><div><span>JOURS DE STOCK</span><strong>{item.workDays.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</strong></div></div></div><TrendChart item={item} max={max}/><div className="chart-note"><span style={{ background: item.color }}/><strong>Encours réel</strong><i/>Seuil maximum configuré · série historique du book</div></article><aside className="report-panel bottleneck-priority"><SectionTitle eyebrow="PRIORITÉ" title="Charge à résorber"/><strong>{Math.max(item.actual - max, 0)}</strong><span>véhicules au-dessus du seuil</span><div><small>Cadence secteur</small><b>{item.cadence} / jour</b></div><p>{item.actual > max ? `À cadence constante, le secteur porte ${item.workDays.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} jours de travail en stock.` : "Le secteur reste sous son seuil maximum."}</p></aside></section>
    <section className="bottleneck-cards">{bottlenecks.map((entry) => { const threshold = maxFor(entry); const ratio = entry.actual / threshold; const delta = Math.round((entry.actual-entry.series[0])/entry.series[0]*100); return <button key={entry.name} className={`${selected === entry.name ? "active" : ""} ${ratio > 1.5 ? "danger" : ratio > 1 ? "warning" : "healthy"}`} onClick={() => setSelected(entry.name)}><span className="sector-color" style={{ background: entry.color }}/><div className="sector-card-head"><strong>{entry.name}</strong><span>{ratio > 1.5 ? "CRITIQUE" : ratio > 1 ? "À SURVEILLER" : "MAÎTRISÉ"}</span></div><div className="sector-card-value"><strong>{entry.actual}</strong><span>/ max {threshold}</span></div><div className="sector-card-track"><i style={{ width: `${Math.min(ratio * 100, 100)}%`, background: entry.color }}/></div><div className="sector-card-foot"><span>{entry.workDays.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} j de stock</span><b className={delta > 0 ? "up" : "down"}>{delta > 0 ? "+" : ""}{delta}%</b></div></button>; })}</section>
  </div>;
}

function WalkingDeadView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const [sector, setSector] = useState("Tous");
  const sectors = ["Tous", ...Array.from(new Set(oldestCases.map((item) => item.sector)))];
  const filtered = useMemo(() => oldestCases.filter((item) => sector === "Tous" || item.sector === sector).sort((a,b) => b.days-a.days).slice(0, sector === "Tous" ? 18 : 10), [sector]);
  const oldest = filtered[0];
  return <div className="view-page"><Freshness snapshot={snapshot} connected={connected}/><SectionTitle eyebrow="WALKING DEAD" title="Les dossiers qui ne doivent plus dormir" description="Les plus vieux dossiers par secteur d’activité, classés selon le nombre de jours passés sur leur statut actuel."/>
    <section className="oldest-overview"><article className="oldest-callout"><div><span>PLUS ANCIEN · {sector.toUpperCase()}</span><strong>{oldest?.days.toLocaleString("fr-FR")}<small> jours</small></strong><p>{oldest?.registration} · OR {oldest?.order}</p></div><Icon name="car" size={52}/></article><article><span>DOSSIERS AFFICHÉS</span><strong>{filtered.length}</strong><small>priorités opérationnelles</small></article><article><span>SEUIL D’ALERTE</span><strong>20<small> jours</small></strong><small>priorité renforcée au-delà</small></article></section>
    <div className="sector-filter" role="tablist">{sectors.map((name) => <button role="tab" aria-selected={sector === name} className={sector === name ? "active" : ""} onClick={() => setSector(name)} key={name}>{name}</button>)}</div>
    <section className="report-panel oldest-table-panel"><div className="table-heading"><div><span>WALKING DEAD</span><h3>{sector === "Tous" ? "Priorités tous secteurs" : `Priorités · ${sector}`}</h3></div><small>Jours sur statut · ordre décroissant</small></div><div className="table-scroll"><table className="oldest-table"><thead><tr><th>Rang</th><th>Secteur</th><th>Immatriculation</th><th>OR</th><th>Dernier statut</th><th>Client</th><th>Jours</th></tr></thead><tbody>{filtered.map((entry,index) => <tr key={`${entry.order}-${entry.sector}`}><td><span className={`rank rank-${Math.min(index+1,4)}`}>{index+1}</span></td><td><span className="sector-pill">{entry.sector}</span></td><td><strong>{entry.registration}</strong></td><td>{entry.order}</td><td>{entry.status}</td><td>{entry.client}</td><td><strong className={entry.days > 40 ? "age-critical" : entry.days > 20 ? "age-warning" : "age-normal"}>{entry.days.toLocaleString("fr-FR")}</strong></td></tr>)}</tbody></table></div></section>
  </div>;
}

function useProtectedAccess() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { fetch("/api/import-book/auth", { cache: "no-store" }).then((r) => r.json() as Promise<ImportAuthPayload>).then((p) => setAuthorized(Boolean(p.authenticated))).catch(() => setAuthorized(false)); }, []);
  async function unlock() {
    setMessage("Vérification…");
    const response = await fetch("/api/import-book/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode: code }) });
    const payload = await response.json() as ImportAuthPayload;
    if (!response.ok || !payload.authenticated) { setAuthorized(false); setMessage(payload.error || "Code refusé."); return false; }
    setAuthorized(true); setCode(""); setMessage("Accès protégé déverrouillé."); return true;
  }
  return { authorized, code, setCode, message, setMessage, unlock };
}

function AccessUnlock({ access }: { access: ReturnType<typeof useProtectedAccess> }) {
  if (access.authorized !== false) return null;
  return <div className="import-unlock compact-unlock"><div><span>ACCÈS PROTÉGÉ</span><strong>Déverrouiller les modifications</strong><small>Le même accès sécurisé que pour l’import des books.</small></div><div className="import-unlock-form"><input type="password" value={access.code} onChange={(event) => access.setCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && access.code) void access.unlock(); }} placeholder="Code d’accès"/><button onClick={() => void access.unlock()} disabled={!access.code}>Déverrouiller</button></div>{access.message && <p className="import-auth-message">{access.message}</p>}</div>;
}

function ObjectivesView({ month }: { month: string }) {
  const [selectedMonth, setSelectedMonth] = useState(month);
  const { objectives, setObjectives, loading } = useObjectives(selectedMonth);
  const access = useProtectedAccess();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const rows = useMemo(() => objectiveSectors.map(([sectorKey, sectorLabel, dailyTarget, minThreshold, maxThreshold]) => objectives.find((item) => item.sectorKey === sectorKey) ?? { sectorKey, sectorLabel, dailyTarget, minThreshold, maxThreshold }), [objectives]);
  function update(key: string, field: "dailyTarget" | "minThreshold" | "maxThreshold", value: string) {
    const numeric = value === "" ? null : Math.max(0, Number(value) || 0);
    setObjectives(rows.map((item) => item.sectorKey === key ? { ...item, [field]: field === "dailyTarget" ? numeric ?? 0 : numeric } : item));
  }
  async function save() {
    if (!access.authorized) { setStatus("Déverrouille d’abord les modifications."); return; }
    setSaving(true); setStatus("Enregistrement…");
    try {
      const response = await fetch("/api/objectives", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: selectedMonth, objectives: rows }) });
      const payload = await response.json() as { saved?: number; error?: string; authRequired?: boolean };
      if (!response.ok) throw new Error(payload.error || "Enregistrement impossible.");
      setStatus(`${payload.saved ?? rows.length} objectifs et seuils enregistrés. Les autres pages les utilisent immédiatement.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Erreur d’enregistrement."); }
    finally { setSaving(false); }
  }
  return <div className="view-page"><SectionTitle eyebrow="PARAMÉTRAGE INDUSTRIEL" title="Objectifs & seuils" description="Définis les objectifs journaliers de chaque mois et les seuils mini/maxi utilisés dans Performance, Synthèse et Goulots." action={<div className="month-picker"><label>Mois<input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}/></label></div>}/><AccessUnlock access={access}/>
    <section className="report-panel objectives-panel"><div className="table-heading"><div><span>RÉFÉRENTIEL DU MOIS</span><h3>{new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(`${selectedMonth}-01T12:00:00`))}</h3></div><button className="primary-action" onClick={() => void save()} disabled={saving || loading || access.authorized !== true}>{saving ? "Enregistrement…" : "Enregistrer les objectifs"}</button></div><div className="table-scroll"><table className="objective-table"><thead><tr><th>Activité</th><th>Objectif journalier</th><th>Seuil mini encours</th><th>Seuil maxi encours</th><th>Utilisation</th></tr></thead><tbody>{rows.map((item) => <tr key={item.sectorKey}><td><strong>{item.sectorLabel}</strong></td><td><input type="number" min="0" value={item.dailyTarget} onChange={(event) => update(item.sectorKey, "dailyTarget", event.target.value)}/></td><td><input type="number" min="0" value={item.minThreshold ?? ""} placeholder="—" onChange={(event) => update(item.sectorKey, "minThreshold", event.target.value)}/></td><td><input type="number" min="0" value={item.maxThreshold ?? ""} placeholder="—" onChange={(event) => update(item.sectorKey, "maxThreshold", event.target.value)}/></td><td><span className="usage-pill">{item.maxThreshold != null ? "Production + Goulots" : "Production"}</span></td></tr>)}</tbody></table></div>{status && <div className="settings-feedback">{status}</div>}</section>
  </div>;
}

async function sha256(buffer: ArrayBuffer) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
function detectDate(filename: string) { const iso = filename.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`; const fr = filename.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/); if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`; return new Date().toISOString().slice(0,10); }

async function scanFinanceBook(file: File) {
  const XLSX = await import("@e965/xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const metrics: Record<string, number | string | null> = {};
  const matches: Array<{ label: string; value: number }> = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || typeof cell.v !== "string") continue;
        const label = normalize(cell.v);
        if (!label) continue;
        let value: number | null = null;
        for (let offset = 1; offset <= 5 && value == null; offset += 1) {
          const candidate = sheet[XLSX.utils.encode_cell({ r, c: c + offset })];
          const numeric = Number(candidate?.v);
          if (Number.isFinite(numeric)) value = numeric;
        }
        if (value == null) continue;
        matches.push({ label, value });
      }
    }
  }
  const find = (...patterns: RegExp[]) => matches.find((item) => patterns.some((pattern) => pattern.test(item.label)))?.value;
  metrics.revenue_day = find(/ca jour/, /chiffre d affaires jour/, /chiffre d affaires du jour/) ?? null;
  metrics.revenue_day_target = find(/objectif ca jour/, /objectif.*chiffre d affaires.*jour/) ?? null;
  metrics.revenue_cumulative = find(/ca cumule/, /chiffre d affaires cumule/) ?? null;
  metrics.revenue_cumulative_target = find(/objectif ca cumule/, /objectif.*chiffre d affaires.*cumule/, /objectif ca$/) ?? null;
  metrics.fre_per_vo = find(/fre.*(vo|vop)/, /frais.*(vo|vop)/, /frais unitaires/) ?? null;
  metrics.mo_per_vop = find(/mo.*(vo|vop)/, /heures.*(vo|vop)/) ?? null;
  metrics.revenue_per_vop = find(/ca.*(vo|vop)/, /chiffre d affaires.*(vo|vop)/) ?? null;
  metrics.labor_hours = find(/heures mo/, /main d oeuvre.*heures/) ?? null;
  metrics.vop = find(/realise vop/, /volume.*vop/, /volumes vo/) ?? null;
  metrics.source_matches = matches.length;
  return { buffer, metrics, snapshotAt: detectDate(file.name) };
}

function FinanceView() {
  const access = useProtectedAccess();
  const [snapshots, setSnapshots] = useState<FinancialSnapshot[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  async function refresh() { const response = await fetch("/api/finance?history=1", { cache: "no-store" }); if (response.ok) { const payload = await response.json() as { snapshots?: FinancialSnapshot[] }; const rows = payload.snapshots ?? []; setSnapshots(rows); setSelectedDate((current) => current || rows[0]?.date || ""); } }
  useEffect(() => { void refresh(); }, []);
  const current = snapshots.find((item) => item.date === selectedDate) ?? snapshots[0] ?? null;
  const m = current?.metrics ?? {};
  async function upload() {
    if (!file || !access.authorized) { setStatus("Déverrouille l’accès et sélectionne un fichier financier."); return; }
    setUploading(true); setStatus("Lecture du book financier et recherche des indicateurs…");
    try {
      const parsed = await scanFinanceBook(file);
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshotAt: parsed.snapshotAt, filename: file.name, byteSize: file.size, sha256: await sha256(parsed.buffer), metrics: parsed.metrics }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Import financier impossible.");
      setStatus("Import financier enregistré. Les indicateurs reconnus sont maintenant disponibles."); setFile(null); await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Erreur pendant l’import financier."); }
    finally { setUploading(false); }
  }
  const dayRevenue = Number(m.revenue_day); const dayTarget = Number(m.revenue_day_target); const cumulativeRevenue = Number(m.revenue_cumulative); const cumulativeTarget = Number(m.revenue_cumulative_target);
  return <div className="view-page"><SectionTitle eyebrow="PERFORMANCE FINANCIÈRE" title="Chiffre d’affaires" description="Import financier indépendant du SFTP opérationnel. Le lecteur recherche automatiquement CA, objectifs, FRE/VO, MO/VOP et ratios du book." action={snapshots.length ? <select className="finance-date-select" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{snapshots.map((item) => <option key={item.date} value={item.date}>{displayDate(item.date)}</option>)}</select> : undefined}/><AccessUnlock access={access}/>
    <section className="finance-kpis">
      <article className="finance-hero-card"><span>CA DU JOUR</span><strong>{euro(m.revenue_day)}</strong><small>objectif {euro(m.revenue_day_target)}</small>{Number.isFinite(dayRevenue) && Number.isFinite(dayTarget) && <b className={dayRevenue >= dayTarget ? "finance-positive" : "finance-negative"}>{euro(dayRevenue - dayTarget)} d’écart</b>}</article>
      <article><span>CA CUMULÉ</span><strong>{euro(m.revenue_cumulative)}</strong><small>objectif {euro(m.revenue_cumulative_target)}</small>{Number.isFinite(cumulativeRevenue) && Number.isFinite(cumulativeTarget) && <b className={cumulativeRevenue >= cumulativeTarget ? "finance-positive" : "finance-negative"}>{euro(cumulativeRevenue - cumulativeTarget)} d’écart</b>}</article>
      <article><span>FRE / VO</span><strong>{euro(m.fre_per_vo)}</strong><small>frais / véhicule</small></article>
      <article><span>MO / VOP</span><strong>{number(m.mo_per_vop, 2)}</strong><small>heures / VOP</small></article>
      <article><span>CA / VOP</span><strong>{euro(m.revenue_per_vop)}</strong><small>valorisation moyenne</small></article>
      <article><span>HEURES MO</span><strong>{number(m.labor_hours, 0)}</strong><small>cumul importé</small></article>
    </section>
    {!current && <div className="empty-finance"><Icon name="finance" size={34}/><div><strong>Aucun book financier importé</strong><span>Dépose ci-dessous le fichier financier CRVO. Les champs non présents restent volontairement vides : aucune donnée n’est inventée.</span></div></div>}
    <section className="book-uploader finance-uploader"><div className="upload-heading"><div className="upload-mark"><Icon name="upload" size={28}/></div><div><span>IMPORT FINANCIER SÉPARÉ</span><h3>Ajouter un book financier CRVO</h3><p>Ce flux est volontairement distinct du SFTP opérationnel. Il alimente uniquement la page Chiffre d’affaires.</p></div></div><label className={file ? "drop-zone selected" : "drop-zone"}><input type="file" accept=".xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setStatus(""); }}/><Icon name={file ? "check" : "upload"} size={24}/><strong>{file ? file.name : "Choisir le fichier financier"}</strong><small>Le mapping est basé sur les libellés trouvés dans les feuilles Excel.</small></label><div className="upload-actions"><button disabled={!file || access.authorized !== true || uploading} onClick={() => void upload()}>{uploading ? <Icon name="refresh" size={17}/> : <Icon name="upload" size={17}/>} {uploading ? "Analyse en cours…" : "Importer les données financières"}</button><div className={`upload-feedback ${status ? "done" : "idle"}`}><i/>{status || "FRE/VO, MO/VOP et CA sont pris uniquement s’ils sont explicitement trouvés dans le fichier."}</div></div></section>
  </div>;
}

function SourcesView({ snapshot, connected }: { snapshot: Snapshot; connected: boolean }) {
  const access = useProtectedAccess();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function readBook(selected: File) {
    const XLSX = await import("@e965/xlsx"); const buffer = await selected.arrayBuffer(); const hash = await sha256(buffer); const workbook = XLSX.read(buffer, { type: "array", sheets: ["Synthèse", "Tdb Production"] }); const summary = workbook.Sheets["Synthèse"]; const production = workbook.Sheets["Tdb Production"]; if (!summary || !production) throw new Error("Ce fichier ne contient pas les feuilles CRVO attendues."); const value = (sheet: typeof summary, cell: string) => { const parsed = Number(sheet[cell]?.v); if (!Number.isFinite(parsed)) throw new Error(`La donnée ${cell} est absente du book.`); return parsed; };
    const metrics = [
      { key: "entries_vop", label: "Entrées VOP", value: value(summary, "E4") + value(summary, "E5") }, { key: "exits_vop", label: "Sorties VOP", value: value(summary, "E6") }, { key: "factory_stock", label: "Stock usine", value: value(summary, "E8") }, { key: "stock_over_15d", label: "Stock de plus de 15 jours", value: value(summary, "E10") + value(summary, "E11") }, { key: "stock_over_20d", label: "Stock de plus de 20 jours", value: value(summary, "E12") + value(summary, "E13") }, { key: "production_expertise", label: "Production Expertise", value: value(production, "G6") }, { key: "production_mechanics", label: "Production Mécanique", value: value(production, "M6") }, { key: "production_dsp", label: "Production DSP", value: value(production, "S6") }, { key: "production_bodywork", label: "Production Carrosserie", value: value(production, "Y6") }, { key: "production_preparation", label: "Production Préparation", value: value(production, "AE6") }, { key: "production_quality", label: "Production Qualité", value: value(production, "AK6") }, { key: "production_factory_exit", label: "Production Sortie usine", value: value(production, "AQ6") },
    ]; return { buffer, hash, metrics, snapshotAt: detectDate(selected.name) };
  }
  async function uploadBook() {
    if (!file || status === "reading" || status === "uploading" || access.authorized !== true) return;
    try { setStatus("reading"); setMessage("Lecture et contrôle du book…"); const book = await readBook(file); setStatus("uploading"); setMessage("Archivage sécurisé de l’original…"); const initResponse = await fetch("/api/import-book/init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, byteSize: file.size, sha256: book.hash, snapshotAt: book.snapshotAt, contentType: file.type }) }); const init = await initResponse.json() as ImportInitPayload; if (!initResponse.ok) throw new Error(init.duplicate ? "Ce book est déjà présent dans l’historique." : init.error || "L’import n’a pas pu démarrer."); if (!init.signedUrl || !init.batchId) throw new Error("La préparation de l’import est incomplète."); const uploadResponse = await fetch(init.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: file }); if (!uploadResponse.ok) throw new Error("Le transfert de l’original a été interrompu."); const finalizeResponse = await fetch("/api/import-book/finalize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: init.batchId, metrics: book.metrics }) }); const finalized = await finalizeResponse.json() as ImportFinalizePayload; if (!finalizeResponse.ok) throw new Error(finalized.error || "La validation du book a échoué."); setStatus("done"); setMessage(`Book du ${displayDate(book.snapshotAt)} intégré : ${finalized.metrics ?? book.metrics.length} indicateurs enregistrés.`); window.setTimeout(() => window.location.reload(), 900); }
    catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Une erreur est survenue."); }
  }
  return <div className="view-page"><Freshness snapshot={snapshot} connected={connected}/><SectionTitle eyebrow="DATA HUB" title="Sources & actualisation" description="Le book opérationnel et le book financier suivent désormais deux flux d’import séparés."/><AccessUnlock access={access}/><section className="book-uploader"><div className="upload-heading"><div className="upload-mark"><Icon name="upload" size={28}/></div><div><span>IMPORT OPÉRATIONNEL</span><h3>Ajouter un book CRVO</h3><p>Chaque journée est archivée et ajoutée à l’historique sans écraser les précédentes.</p></div></div><label className={file ? "drop-zone selected" : "drop-zone"}><input type="file" accept=".xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setStatus("idle"); setMessage(""); }}/><Icon name={file ? "check" : "upload"} size={24}/><strong>{file ? file.name : "Glisser-déposer ou choisir un fichier"}</strong><small>{file ? `${(file.size / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo · prêt à contrôler` : "Formats acceptés : XLSX ou XLS"}</small></label><div className="upload-actions"><button disabled={!file || access.authorized !== true || status === "reading" || status === "uploading"} onClick={() => void uploadBook()}>{status === "reading" || status === "uploading" ? <Icon name="refresh" size={17}/> : <Icon name="upload" size={17}/>} {status === "reading" ? "Contrôle en cours…" : status === "uploading" ? "Import en cours…" : "Importer ce book"}</button><div className={`upload-feedback ${status}`}><i/>{message || "La date est détectée depuis le nom du fichier. Les doublons sont bloqués automatiquement."}</div></div></section><section className="source-cards"><article className="source-card active"><div className="source-icon"><Icon name="source"/></div><div><span>BASE DE DONNÉES</span><h3>Supabase KPI CRVO</h3><p>Historique des books opérationnels, objectifs et finance.</p></div><strong><i/>CONNECTÉ</strong></article><article className="source-card active"><div className="source-icon excel">XL</div><div><span>BOOK OPÉRATIONNEL</span><h3>SFTP / import manuel</h3><p>Performance, stock, encours, goulots et Walking DEAD.</p></div><strong><i/>ACTIF</strong></article><article className="source-card pending"><div className="source-icon"><Icon name="finance"/></div><div><span>BOOK FINANCIER</span><h3>Import séparé</h3><p>CA, objectifs financiers, FRE/VO, MO/VOP et ratios associés.</p></div><strong><i/>MANUEL</strong></article></section></div>;
}

export default function Dashboard() {
  const [view, setView] = useState<View>("today");
  const [menuOpen, setMenuOpen] = useState(false);
  const { snapshots, connected } = useDashboardData();
  const snapshot = snapshots.at(-1) ?? seedSnapshot;
  const { objectiveMap } = useObjectives(monthKey(snapshot.date));
  const current = views.find((item) => item.id === view) ?? views[0];
  function navigate(next: View) { setView(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <div className="app-shell"><aside className={menuOpen ? "sidebar open" : "sidebar"}><div className="sidebar-brand"><Image src="/crvo-logo.png" width={190} height={65} alt="CRVO - Votre potentiel VO au plus haut" priority unoptimized/></div><div className="sidebar-context"><span>REPORTING</span><strong>CRVO Lens</strong><small>Pilotage opérationnel</small></div><nav>{views.map((item) => <button id={`nav-${item.id}`} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon}/><span>{item.label}</span>{view === item.id && <i/>}</button>)}</nav><div className="sidebar-bottom"><span className={connected ? "live-dot" : "book-dot"}/><div><strong>{connected ? "Données connectées" : "Mode book Excel"}</strong><small>Dernier import · {snapshot.label}</small></div></div></aside>{menuOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)}/>}<main className="main-workspace"><header className="topbar"><button className="menu-button" aria-label="Ouvrir le menu" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? "close" : "menu"}/></button><div className="topbar-brand"><Image src="/crvo-logo.png" width={151} height={47} alt="CRVO - Votre potentiel VO au plus haut" priority unoptimized/></div><div className="topbar-title"><span>REPORTING CRVO LENS</span><h1>{current.label}</h1></div><div className="topbar-date"><Icon name="calendar"/><div><span>DERNIÈRE DONNÉE</span><strong>{snapshot.label}</strong></div></div></header>
      {view === "today" && <TodayView snapshots={snapshots} connected={connected} objectiveMap={objectiveMap}/>} 
      {view === "yesterday" && <SummaryView snapshots={snapshots} connected={connected} objectiveMap={objectiveMap}/>} 
      {view === "bottlenecks" && <BottlenecksView snapshot={snapshot} connected={connected} objectiveMap={objectiveMap}/>} 
      {view === "walking" && <WalkingDeadView snapshot={snapshot} connected={connected}/>} 
      {view === "finance" && <FinanceView/>} 
      {view === "objectives" && <ObjectivesView month={monthKey(snapshot.date)}/>} 
      {view === "sources" && <SourcesView snapshot={snapshot} connected={connected}/>} 
      <nav className="mobile-nav">{views.slice(0,5).map((item) => <button className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><Icon name={item.icon}/><span>{item.short}</span></button>)}</nav>
    </main></div>;
}
