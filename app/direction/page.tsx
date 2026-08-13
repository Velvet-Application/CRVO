"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./direction.module.css";

type Production = { name:string; value:number; tone:string };
type Snapshot = {
  date:string;
  label:string;
  source:string;
  entries:number;
  exits:number;
  stock:number;
  over15:number;
  over20:number;
  production:Production[];
};
type DashboardPayload = {
  connected?:boolean;
  snapshot?:Snapshot;
  snapshots?:Snapshot[];
  liveFreshness?: {
    sourceModifiedAt?:string|null;
    factoryModifiedAt?:string|null;
    parkModifiedAt?:string|null;
  } | null;
};
type FinanceSnapshot = {
  date:string;
  source:string;
  metrics:Record<string,number|string|null>;
};
type FinancePayload = { snapshot?:FinanceSnapshot|null; snapshots?:FinanceSnapshot[] };

const targets:Record<string,number> = {
  Expertise:90,
  "Mécanique":85,
  DSP:48,
  Carrosserie:63,
  "Préparation":90,
  "Qualité":90,
  "Sortie usine":92,
};

function num(value:unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function euro(value:number) { return new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR", maximumFractionDigits:0 }).format(value); }
function shortEuro(value:number) {
  if (Math.abs(value) >= 1_000_000) return `${(value/1_000_000).toLocaleString("fr-FR", { maximumFractionDigits:2 })} M€`;
  if (Math.abs(value) >= 1_000) return `${(value/1_000).toLocaleString("fr-FR", { maximumFractionDigits:0 })} k€`;
  return euro(value);
}
function hour(value?:string|null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour:"2-digit", minute:"2-digit", timeZone:"Europe/Paris" }).format(date);
}
function compactDate(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"short", timeZone:"Europe/Paris" }).format(new Date(`${value}T12:00:00+02:00`));
}
function fullDate(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday:"long", day:"2-digit", month:"long", year:"numeric", timeZone:"Europe/Paris" }).format(new Date(`${value}T12:00:00+02:00`));
}
function workingDaysInMonth(dateIso:string) {
  const [y,m] = dateIso.slice(0,7).split("-").map(Number);
  const out:string[] = [];
  const cursor = new Date(Date.UTC(y,m-1,1));
  while (cursor.getUTCMonth() === m-1) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0,10));
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return out;
}

function FinanceChart({ rows, budget, projection }:{ rows:FinanceSnapshot[]; budget:number; projection:number }) {
  const sorted = [...rows].sort((a,b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  if (!latest || budget <= 0) return <div className={styles.chartEmpty}>Données de facturation en attente.</div>;
  const monthDays = workingDaysInMonth(latest.date);
  const width = 1000, height = 270, left = 36, right = 24, top = 18, bottom = 32;
  const plotW = width-left-right, plotH = height-top-bottom;
  const maxY = Math.max(budget, projection, ...sorted.map(r => num(r.metrics.revenue_cumulative))) * 1.08;
  const xForDate = (date:string) => {
    const index = Math.max(monthDays.findIndex(d => d >= date),0);
    return left + (index / Math.max(monthDays.length-1,1)) * plotW;
  };
  const y = (value:number) => top + plotH - (value / Math.max(maxY,1))*plotH;
  const actual = sorted.filter(r => r.date.slice(0,7) === latest.date.slice(0,7)).map(r => `${xForDate(r.date)},${y(num(r.metrics.revenue_cumulative))}`).join(" ");
  const lastActualX = xForDate(latest.date);
  const lastActualY = y(num(latest.metrics.revenue_cumulative));
  const endX = left+plotW;
  const projectionY = y(projection);
  const budgetY = y(budget);
  return <svg className={styles.financeSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Facturation cumulée, projection et budget">
    {[0.25,0.5,0.75,1].map((ratio) => <line key={ratio} x1={left} x2={endX} y1={top+plotH*(1-ratio)} y2={top+plotH*(1-ratio)} className={styles.gridLine}/>) }
    <line x1={left} x2={endX} y1={budgetY} y2={budgetY} className={styles.budgetLine}/>
    <text x={endX-4} y={Math.max(budgetY-7,12)} textAnchor="end" className={styles.budgetLabel}>BUDGET {shortEuro(budget)}</text>
    <polyline points={actual} className={styles.actualLine}/>
    <line x1={lastActualX} y1={lastActualY} x2={endX} y2={projectionY} className={styles.projectionLine}/>
    <circle cx={lastActualX} cy={lastActualY} r="6" className={styles.actualDot}/>
    <circle cx={endX} cy={projectionY} r="6" className={styles.projectionDot}/>
    <text x={left} y={height-8} className={styles.axisText}>{compactDate(monthDays[0])}</text>
    <text x={endX} y={height-8} textAnchor="end" className={styles.axisText}>{compactDate(monthDays.at(-1) || latest.date)}</text>
  </svg>;
}

export default function DirectionPage() {
  const [dashboard, setDashboard] = useState<DashboardPayload|null>(null);
  const [finance, setFinance] = useState<FinancePayload|null>(null);
  const [screenRefresh, setScreenRefresh] = useState<string>("");
  const [error, setError] = useState("");

  async function loadLive() {
    try {
      const response = await fetch(`/api/dashboard?history=1&_=${Date.now()}`, { cache:"no-store" });
      if (!response.ok) throw new Error("Production live indisponible");
      const payload = await response.json() as DashboardPayload;
      setDashboard(payload);
      setScreenRefresh(new Intl.DateTimeFormat("fr-FR", { hour:"2-digit", minute:"2-digit", timeZone:"Europe/Paris" }).format(new Date()));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Production live indisponible"); }
  }
  async function loadFinance() {
    try {
      const response = await fetch(`/api/finance?history=1&_=${Date.now()}`, { cache:"no-store" });
      if (!response.ok) return;
      setFinance(await response.json() as FinancePayload);
    } catch {}
  }

  useEffect(() => {
    void loadLive(); void loadFinance();
    const liveTimer = window.setInterval(() => void loadLive(), 60000);
    const financeTimer = window.setInterval(() => void loadFinance(), 15*60*1000);
    const onVisible = () => { if (document.visibilityState === "visible") void loadLive(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", loadLive);
    return () => { window.clearInterval(liveTimer); window.clearInterval(financeTimer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", loadLive); };
  }, []);

  const snapshots = dashboard?.snapshots?.length ? dashboard.snapshots : dashboard?.snapshot ? [dashboard.snapshot] : [];
  const live = snapshots.at(-1) ?? dashboard?.snapshot ?? null;
  const yesterday = live ? [...snapshots].reverse().find(row => row.date < live.date) ?? null : null;
  const factoryTime = hour(dashboard?.liveFreshness?.factoryModifiedAt ?? dashboard?.liveFreshness?.sourceModifiedAt);
  const parkTime = hour(dashboard?.liveFreshness?.parkModifiedAt ?? dashboard?.liveFreshness?.sourceModifiedAt);

  const financeRows = useMemo(() => (finance?.snapshots ?? []).filter(row => row.date.slice(0,7) === live?.date.slice(0,7)), [finance, live?.date]);
  const financeLatest = financeRows.length ? [...financeRows].sort((a,b) => a.date.localeCompare(b.date)).at(-1)! : finance?.snapshot ?? null;
  const cumulativeRevenue = financeLatest ? num(financeLatest.metrics.revenue_cumulative) : 0;
  const budget = financeLatest ? num(financeLatest.metrics.revenue_cumulative_target) : 0;
  const businessDays = financeLatest ? workingDaysInMonth(financeLatest.date) : [];
  const elapsed = financeLatest ? businessDays.filter(day => day <= financeLatest.date).length : 0;
  const projection = elapsed > 0 ? cumulativeRevenue / elapsed * businessDays.length : 0;
  const projectionPct = budget > 0 ? Math.round(projection / budget * 100) : 0;

  const stock = live?.stock ?? 0;
  const age0to15 = Math.max(stock - (live?.over15 ?? 0), 0);
  const age16to20 = Math.max((live?.over15 ?? 0) - (live?.over20 ?? 0), 0);
  const age21plus = Math.max(live?.over20 ?? 0, 0);
  const aging = [
    { label:"0-15 jours", value:age0to15, cls:styles.ageGood },
    { label:"16-20 jours", value:age16to20, cls:styles.ageWatch },
    { label:"21 jours et +", value:age21plus, cls:styles.ageRisk },
  ];

  if (!live) return <main className={styles.loading}><img src="/crvo-logo.png" alt="CRVO"/><strong>Connexion à l'écran direction…</strong><span>{error}</span></main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/crvo-logo.png" alt="CRVO"/><div><span>DIRECTION · CRVO LENS</span><h1>TABLEAU DE BORD</h1></div></div>
      <div className={styles.liveStatus}><i/><div><strong>FTP LIVE</strong><span>Production {factoryTime} · Parc {parkTime}</span></div></div>
    </header>

    <section className={styles.topGrid}>
      <article className={styles.yesterdayCard}>
        <div className={styles.sectionHead}><div><span>CLÔTURE DE LA VEILLE</span><h2>Production du {yesterday ? fullDate(yesterday.date) : "—"}</h2></div>{yesterday && <b>{yesterday.exits} sorties</b>}</div>
        {yesterday ? <>
          <div className={styles.yesterdaySummary}><div><span>Entrées</span><strong>{yesterday.entries}</strong></div><div><span>Sorties</span><strong>{yesterday.exits}</strong></div><div><span>Stock fin de journée</span><strong>{yesterday.stock}</strong></div></div>
          <div className={styles.prodStrip}>{yesterday.production.map(item => <div key={item.name}><span>{item.name}</span><strong>{item.value}</strong><small>/ {targets[item.name] ?? "—"}</small></div>)}</div>
        </> : <div className={styles.empty}>Clôture de la veille indisponible.</div>}
      </article>

      <article className={styles.financeCard}>
        <div className={styles.sectionHead}><div><span>FACTURATION · MOIS EN COURS</span><h2>Réalisé & projection vs budget</h2></div>{financeLatest && <small>arrêté au {compactDate(financeLatest.date)}</small>}</div>
        <div className={styles.financeNumbers}>
          <div><span>CA cumulé</span><strong>{shortEuro(cumulativeRevenue)}</strong></div>
          <div className={projectionPct >= 100 ? styles.positive : styles.negative}><span>Projection fin de mois</span><strong>{shortEuro(projection)}</strong><small>{projectionPct}% du budget</small></div>
        </div>
        <FinanceChart rows={financeRows} budget={budget} projection={projection}/>
      </article>
    </section>

    <section className={styles.livePanel}>
      <div className={styles.liveHero}>
        <div><span>PRODUCTION DU JOUR · RÉALISÉ À {factoryTime}</span><h2>{live.exits}<small>/ {targets["Sortie usine"]}</small></h2><p>{fullDate(live.date)}</p></div>
        <div className={styles.liveHeroRight}><span>Entrées</span><strong>{live.entries}</strong><span>Stock usine</span><strong>{live.stock}</strong></div>
      </div>
      <div className={styles.todayProd}>{live.production.map(item => {
        const target = targets[item.name] ?? 0;
        const pct = target ? Math.round(item.value/target*100) : 0;
        return <div key={item.name} className={styles.todayProdCard}><span>{item.name}</span><div><strong>{item.value}</strong><small>/ {target}</small></div><i><b style={{width:`${Math.min(pct,100)}%`}}/></i><em>{pct}%</em></div>;
      })}</div>
    </section>

    <section className={styles.stockPanel}>
      <div className={styles.stockLead}><span>VIEILLISSEMENT DU PARC · ÉTAT À {parkTime}</span><div><h2>{stock}</h2><p>véhicules en stock usine</p></div></div>
      <div className={styles.agingBar}>{aging.map(item => <i key={item.label} className={item.cls} style={{width:`${stock ? item.value/stock*100 : 0}%`}} title={`${item.label}: ${item.value}`}/>)}</div>
      <div className={styles.agingCards}>{aging.map(item => <div key={item.label} className={item.cls}><span>{item.label}</span><strong>{item.value}</strong><small>{stock ? Math.round(item.value/stock*100) : 0}% du parc</small></div>)}</div>
      <div className={styles.stockSignal}><span>PARC &gt; 15 J</span><strong>{live.over15}</strong><i/><span>PARC &gt; 20 J</span><strong>{live.over20}</strong></div>
    </section>

    <footer className={styles.footer}><span>CRVO Lens · écran direction</span><span>Écran {screenRefresh || "—"} · production FTP {factoryTime} · parc FTP {parkTime}</span></footer>
  </main>;
}
