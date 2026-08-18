"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./direction.module.css";
import tv from "./direction-tv.module.css";
import agingUi from "./direction-aging.module.css";

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
type LiveFlow = {
  date:string;
  received:number;
  preparationRemaining:number;
  qualityRemaining:number;
  photoRemaining:number;
  exits:number;
  stock:number;
  parkModifiedAt?:string|null;
};
type DashboardPayload = {
  connected?:boolean;
  snapshot?:Snapshot;
  snapshots?:Snapshot[];
  liveFlow?:LiveFlow|null;
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
type PendingInvoices = {
  workloadDate?:string|null;
  parkDate?:string|null;
  parkModifiedAt?:string|null;
  invoiceCutoff?:string|null;
  count?:number|null;
  revenue?:number|null;
  overdueCount?:number|null;
  overdueRevenue?:number|null;
  recentCount?:number|null;
  recentRevenue?:number|null;
  budgetWeightPct?:number|null;
  currentRevenueWeightPct?:number|null;
  revenueAfterCatchup?:number|null;
};
type FinancePayload = { snapshot?:FinanceSnapshot|null; snapshots?:FinanceSnapshot[]; pendingInvoices?:PendingInvoices|null };
type Objective = {
  sectorKey:string;
  sectorLabel:string;
  dailyTarget:number;
  minThreshold:number|null;
  maxThreshold:number|null;
};
type ObjectivesPayload = {
  objectives?:Objective[];
  sortieDailyTargets?:Record<string,number>;
  connected?:boolean;
};

const fallbackTargets:Record<string,number> = {
  Expertise:90,
  "Mécanique":85,
  DSP:48,
  Carrosserie:63,
  "Préparation":90,
  "Qualité":90,
  "Sortie usine":92,
};

const sectorKeys:Record<string,string> = {
  Expertise:"expertise",
  "Mécanique":"mecanique",
  DSP:"dsp",
  Carrosserie:"carrosserie",
  "Préparation":"preparation",
  "Qualité":"qualite",
  "Sortie usine":"sortie_usine",
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
function parisToday() {
  const parts = new Intl.DateTimeFormat("fr-CA", { timeZone:"Europe/Paris", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date());
  const get = (type:string) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function compactDate(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"short", timeZone:"Europe/Paris" }).format(new Date(`${value}T12:00:00+02:00`));
}
function fullDate(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday:"long", day:"2-digit", month:"long", year:"numeric", timeZone:"Europe/Paris" }).format(new Date(`${value}T12:00:00+02:00`));
}
function financeDate(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday:"long", day:"2-digit", month:"long", timeZone:"Europe/Paris" }).format(new Date(`${value}T12:00:00+02:00`));
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
function targetFor(name:string, date:string, payload?:ObjectivesPayload) {
  const key = sectorKeys[name];
  const monthlyTarget = payload?.objectives?.find((item) => item.sectorKey === key)?.dailyTarget;
  if (name === "Sortie usine") {
    const exact = payload?.sortieDailyTargets?.[date];
    return Number.isFinite(Number(exact)) ? Number(exact) : 0;
  }
  return monthlyTarget ?? fallbackTargets[name] ?? 0;
}

function FinanceChart({ rows, budget, projection }:{ rows:FinanceSnapshot[]; budget:number; projection:number }) {
  const sorted = [...rows].sort((a,b) => a.date.localeCompare(b.date));
  const latest = sorted.at(-1);
  if (!latest || budget <= 0) return <div className={`${styles.chartEmpty} ${tv.chartEmpty}`}>Données de facturation ou budget en attente.</div>;
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
  return <svg className={`${styles.financeSvg} ${tv.financeSvg}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Facturation cumulée, projection et budget">
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
  const [objectivesByMonth, setObjectivesByMonth] = useState<Record<string,ObjectivesPayload>>({});
  const [screenRefresh, setScreenRefresh] = useState<string>("");
  const [error, setError] = useState("");

  async function loadLive() {
    try {
      const response = await fetch(`/api/dashboard?history=1&_=${Date.now()}`, { cache:"no-store" });
      if (!response.ok) throw new Error("Production live indisponible");
      const payload = await response.json() as DashboardPayload;
      const rows = payload.snapshots?.length ? payload.snapshots : payload.snapshot ? [payload.snapshot] : [];
      const latest = rows.at(-1) ?? payload.snapshot ?? null;
      const previous = latest ? [...rows].reverse().find((row) => row.date < latest.date) ?? null : null;
      const months = [...new Set([latest?.date.slice(0,7), previous?.date.slice(0,7)].filter(Boolean) as string[])];
      const objectivePairs = await Promise.all(months.map(async (month) => {
        try {
          const objectiveResponse = await fetch(`/api/objectives?month=${month}&_=${Date.now()}`, { cache:"no-store", headers:{"Cache-Control":"no-cache"} });
          if (!objectiveResponse.ok) throw new Error(`Objectifs ${objectiveResponse.status}`);
          const objectivePayload = await objectiveResponse.json() as ObjectivesPayload;
          return [month, objectivePayload] as const;
        } catch {
          try {
            const fallbackResponse = await fetch(`/api/kiosk/direction?resource=objectives&month=${month}&_=${Date.now()}`, { cache:"no-store", headers:{"Cache-Control":"no-cache"} });
            if (!fallbackResponse.ok) throw new Error(`Kiosk objectifs ${fallbackResponse.status}`);
            return [month, await fallbackResponse.json() as ObjectivesPayload] as const;
          } catch {
            return [month, {}] as const;
          }
        }
      }));
      setDashboard(payload);
      if (objectivePairs.length) setObjectivesByMonth((current) => ({ ...current, ...Object.fromEntries(objectivePairs) }));
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
    const financeTimer = window.setInterval(() => void loadFinance(), 2*60*1000);
    const refreshAll = () => { void loadLive(); void loadFinance(); };
    const onVisible = () => { if (document.visibilityState === "visible") refreshAll(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshAll);
    return () => { window.clearInterval(liveTimer); window.clearInterval(financeTimer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", refreshAll); };
  }, []);

  const snapshots = dashboard?.snapshots?.length ? dashboard.snapshots : dashboard?.snapshot ? [dashboard.snapshot] : [];
  const live = snapshots.at(-1) ?? dashboard?.snapshot ?? null;
  const yesterday = live ? [...snapshots].reverse().find(row => row.date < live.date) ?? null : null;
  const dayBeforeYesterday = yesterday ? [...snapshots].reverse().find(row => row.date < yesterday.date) ?? null : null;
  const factoryTime = hour(dashboard?.liveFreshness?.factoryModifiedAt ?? dashboard?.liveFreshness?.sourceModifiedAt);
  const parkTime = hour(dashboard?.liveFreshness?.parkModifiedAt ?? dashboard?.liveFreshness?.sourceModifiedAt);

  const today = parisToday();
  const currentMonth = today.slice(0,7);
  const financeRows = useMemo(() => (finance?.snapshots ?? []).filter(row => row.date.slice(0,7) === currentMonth && row.date <= today), [finance, currentMonth, today]);
  const financeLatest = financeRows.length ? [...financeRows].sort((a,b) => a.date.localeCompare(b.date)).at(-1)! : finance?.snapshot && finance.snapshot.date <= today ? finance.snapshot : null;
  const cumulativeRevenue = financeLatest ? num(financeLatest.metrics.revenue_cumulative) : 0;
  const budget = financeLatest ? num(financeLatest.metrics.revenue_cumulative_target) : 0;
  const businessDays = financeLatest ? workingDaysInMonth(financeLatest.date) : [];
  const elapsed = financeLatest ? businessDays.filter(day => day <= financeLatest.date).length : 0;
  const projection = elapsed > 0 ? cumulativeRevenue / elapsed * businessDays.length : 0;
  const projectionPct = budget > 0 ? Math.round(projection / budget * 100) : 0;
  const budgetGap = budget > 0 ? projection-budget : 0;
  const pendingInvoices = finance?.pendingInvoices ?? null;
  const pendingCount = num(pendingInvoices?.count);
  const pendingRevenue = num(pendingInvoices?.revenue);
  const overdueCount = num(pendingInvoices?.overdueCount);
  const overdueRevenue = num(pendingInvoices?.overdueRevenue);
  const pendingBudgetWeight = num(pendingInvoices?.budgetWeightPct);

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

  const liveObjectives = objectivesByMonth[live.date.slice(0,7)];
  const yesterdayObjectives = yesterday ? objectivesByMonth[yesterday.date.slice(0,7)] : undefined;
  const liveExitTarget = targetFor("Sortie usine", live.date, liveObjectives);
  const yesterdayExitTarget = yesterday ? targetFor("Sortie usine", yesterday.date, yesterdayObjectives) : 0;
  const currentFlow = dashboard?.liveFlow?.date === live.date ? dashboard.liveFlow : null;
  const todayOperations = [
    { key:"received", label:"Véhicules reçus", value:currentFlow?.received ?? live.entries, source:"FTP TOTAUX", detail:"réceptions de la journée" },
    { key:"prep", label:"Prépa restant", value:currentFlow?.preparationRemaining ?? 0, source:"FTP PARC USINE", detail:"en attente / en cours Prépa" },
    { key:"quality", label:"Qualité restant", value:currentFlow?.qualityRemaining ?? 0, source:"FTP PARC USINE", detail:"en attente / en cours Qualité" },
    { key:"photo", label:"Photo restant", value:currentFlow?.photoRemaining ?? 0, source:"FTP PARC USINE", detail:"en attente / en cours Photo" },
    { key:"exits", label:"Sorties usine", value:currentFlow?.exits ?? live.exits, source:"FTP TOTAUX", detail:liveExitTarget>0?`objectif ${liveExitTarget}`:"objectif journalier indisponible" },
  ];

  return <main className={`${styles.page} ${tv.page}`}>
    <header className={`${styles.header} ${tv.header}`}>
      <div className={`${styles.brand} ${tv.brand}`}><img src="/crvo-logo.png" alt="CRVO"/><div><span>DIRECTION · CRVO LENS</span><h1>TABLEAU DE BORD</h1></div></div>
      <div className={`${styles.liveStatus} ${tv.liveStatus}`}><i/><div><strong>FTP LIVE</strong><span>Production {factoryTime} · Parc {parkTime}</span></div></div>
    </header>

    <section className={`${styles.topGrid} ${tv.topGrid}`}>
      <article className={`${styles.yesterdayCard} ${tv.panel} ${tv.yesterdayCard}`}>
        <div className={`${styles.yesterdayHero} ${tv.yesterdayHero}`}>
          <div><span>CLÔTURE DE LA VEILLE</span><h2>Production du {yesterday ? fullDate(yesterday.date) : "—"}</h2><i/></div>
          {yesterday && <b>{yesterday.exits}<small> sorties</small></b>}
        </div>
        {yesterday ? <div className={`${styles.yesterdayBody} ${tv.yesterdayBody}`}>
          <div className={`${styles.yesterdaySummary} ${tv.yesterdaySummary}`}>
            <div><em>EN</em><span>Entrées</span><strong>{yesterday.entries}</strong><small>véhicules reçus</small></div>
            <div><em>SO</em><span>Sorties</span><strong>{yesterday.exits}</strong><small className={yesterdayExitTarget>0 && yesterday.exits >= yesterdayExitTarget ? styles.goodText : styles.badText}>{yesterdayExitTarget>0 ? `${yesterday.exits >= yesterdayExitTarget ? "+" : ""}${yesterday.exits-yesterdayExitTarget} vs objectif ${yesterdayExitTarget}` : "objectif journalier indisponible"}</small></div>
            <div><em>ST</em><span>Stock fin de journée</span><strong>{yesterday.stock}</strong><small>{dayBeforeYesterday ? `${yesterday.stock-dayBeforeYesterday.stock > 0 ? "+" : ""}${yesterday.stock-dayBeforeYesterday.stock} vs veille` : "stock usine"}</small></div>
          </div>
          <div className={`${styles.sectorHead} ${tv.sectorHead}`}><strong>PAR SECTEUR</strong><span>réalisé / objectif journalier</span></div>
          <div className={`${styles.prodStrip} ${tv.prodStrip}`}>{yesterday.production.map((item) => {
            const target = targetFor(item.name, yesterday.date, yesterdayObjectives);
            const pct = target ? Math.round(item.value/target*100) : 0;
            const delta = target ? item.value-target : 0;
            return <div key={item.name}>
              <span>{item.name}</span>
              <div><strong>{item.value}</strong><small>/ {target || "—"}</small></div>
              <i><b style={{width:`${Math.min(Math.max(pct,0),100)}%`}}/></i>
              <em>{target ? `${pct}%` : "—"}</em>
              <small className={delta >= 0 ? styles.goodText : styles.badText}>{target ? `${delta >= 0 ? "+" : ""}${delta}` : "objectif manquant"}</small>
            </div>;
          })}</div>
        </div> : <div className={styles.empty}>Clôture de la veille indisponible.</div>}
      </article>

      <article className={`${styles.financeCard} ${tv.panel} ${tv.financeCard}`}>
        <div className={`${styles.sectionHead} ${tv.sectionHead}`}><div><span>FACTURATION · MOIS EN COURS</span><h2>CA réel · projection · budget · reste à facturer</h2></div>{financeLatest && <small>Arrêté au {financeDate(financeLatest.date)}</small>}</div>
        <div className={`${styles.financeNumbers} ${tv.financeNumbers}`}>
          <div><span>CA À DATE</span><strong>{shortEuro(cumulativeRevenue)}</strong><small>{financeLatest ? `clôturé au ${financeDate(financeLatest.date)}` : "données en attente"}</small></div>
          <div className={projectionPct >= 100 ? styles.positive : styles.negative}><span>PROJECTION FIN DE MOIS</span><strong>{shortEuro(projection)}</strong><small>{budget > 0 ? `${projectionPct}% du budget` : "budget non configuré"}</small></div>
          <div className={`${tv.budgetCard} ${budget > 0 && budgetGap >= 0 ? styles.positive : styles.negative}`}><span>BUDGET MENSUEL</span><strong>{budget > 0 ? shortEuro(budget) : "—"}</strong><small>{budget > 0 ? `${budgetGap >= 0 ? "+" : ""}${shortEuro(budgetGap)} projeté vs budget` : "à configurer"}</small></div>
          <div className={tv.pendingCard}><span>FACTURES RESTANTES</span><strong>{pendingInvoices ? `${pendingCount} OR` : "—"}</strong><small>{pendingInvoices ? `${shortEuro(pendingRevenue)} · ${pendingBudgetWeight.toLocaleString("fr-FR", { maximumFractionDigits:1 })}% du budget · dont ${overdueCount} en retard (${shortEuro(overdueRevenue)})` : "comparaison OR encours / parc FTP en attente"}</small></div>
        </div>
        <FinanceChart rows={financeRows} budget={budget} projection={projection}/>
      </article>
    </section>

    <section className={`${styles.livePanel} ${tv.livePanel}`}>
      <div className={`${styles.liveHero} ${tv.liveHero}`}>
        <div><span>PRODUCTION DU JOUR · RÉALISÉ À {factoryTime}</span><h2>{live.exits}<small>/ {liveExitTarget || "—"}</small></h2><p>sorties usine · {liveExitTarget>0?`objectif du jour ${liveExitTarget}`:"objectif journalier indisponible"} · {fullDate(live.date)}</p></div>
        <div className={`${styles.liveHeroRight} ${tv.liveHeroRight}`}><span>Véhicules reçus</span><strong>{live.entries}</strong><span>Stock usine</span><strong>{live.stock}</strong></div>
      </div>
      <div className={`${styles.flowSourceBar} ${tv.flowSourceBar}`}><span>FTP TOTAUX</span><i/><span>FTP PARC USINE · ÉTAT À {parkTime}</span></div>
      <div className={`${styles.todayFlow} ${tv.todayFlow}`}>{todayOperations.map(item => <div key={item.key} className={`${styles.flowCard} ${styles[`flow_${item.key}`] ?? ""} ${tv.flowCard}`}>
        <div className={`${styles.flowIcon} ${tv.flowIcon}`}>{item.key === "received" ? "↘" : item.key === "exits" ? "↗" : item.key === "prep" ? "P" : item.key === "quality" ? "Q" : "PH"}</div>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
        <small>{item.detail}</small>
        <em>{item.source}</em>
      </div>)}</div>
    </section>

    <section className={`${styles.stockPanel} ${tv.stockPanel} ${agingUi.stockPanelWeighted}`}>
      <div className={`${styles.stockLead} ${tv.stockLead}`}><span>VIEILLISSEMENT DU PARC · ÉTAT À {parkTime}</span><div><h2>{stock}</h2><p>véhicules en stock usine</p></div></div>
      <div className={`${styles.agingCards} ${tv.agingCards} ${agingUi.weightedAging}`} role="img" aria-label={`Répartition du parc par ancienneté sur ${stock} véhicules`}>
        {aging.map(item => {
          const share = stock ? item.value/stock*100 : 0;
          return <div key={item.label} className={`${item.cls} ${share > 0 && share < 12 ? agingUi.compactSegment : ""}`} style={{flexBasis:`${share}%`}} title={`${item.label}: ${item.value} véhicules (${Math.round(share)}% du parc)`}>
            <span>{item.label}</span><strong>{item.value}</strong><small>{Math.round(share)}% du parc</small>
          </div>;
        })}
      </div>
      <div className={`${styles.stockSignal} ${tv.stockSignal}`}><span>PARC &gt; 15 J</span><strong>{live.over15}</strong><i/><span>PARC &gt; 20 J</span><strong>{live.over20}</strong></div>
    </section>

    <footer className={`${styles.footer} ${tv.footer}`}><span>CRVO Lens · écran direction</span><span>Écran {screenRefresh || "—"} · objectif du jour {liveExitTarget || "—"} · CA {financeLatest ? compactDate(financeLatest.date) : "—"} · production FTP {factoryTime} · parc FTP {parkTime}</span></footer>
  </main>;
}
