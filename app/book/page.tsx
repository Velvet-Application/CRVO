"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import styles from "./book.module.css";

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

type HistoryPayload = {
  snapshot?: Snapshot;
  snapshots?: Snapshot[];
  connected?: boolean;
  backend?: string;
};

const fallbackSnapshot: Snapshot = {
  date: "2026-08-07",
  label: "07 août 2026",
  source: "Classeur Excel CRVO quotidien",
  entries: 78,
  exits: 86,
  stock: 1097,
  over15: 494,
  over20: 399,
  production: [
    { name: "Expertise", value: 80, tone: "blue" },
    { name: "Mécanique", value: 96, tone: "cyan" },
    { name: "DSP", value: 24, tone: "teal" },
    { name: "Carrosserie", value: 11, tone: "yellow" },
    { name: "Préparation", value: 89, tone: "blue" },
    { name: "Qualité", value: 88, tone: "cyan" },
    { name: "Sortie usine", value: 86, tone: "teal" },
  ],
};

const dailyTargets: Record<string, number> = {
  Expertise: 90,
  "Mécanique": 85,
  DSP: 48,
  Carrosserie: 63,
  "Préparation": 90,
  "Qualité": 90,
  "Sortie usine": 92,
};

const BLUE = "#004f9f";
const CYAN = "#009edb";
const RED = "#eb5b56";
const TEAL = "#47b9b4";

function shortDate(date: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function signed(value: number) {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function PageHeader({ eyebrow, title, snapshot, page }: { eyebrow: string; title: string; snapshot: Snapshot; page: number }) {
  return <>
    <div className={styles.pageHeader}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h2 className={styles.pageTitle}>{title}</h2>
        <div className={styles.pageTitleRule}/>
      </div>
      <div className={styles.headerMeta}>
        <strong>{snapshot.label}</strong>
        <span>CRVO Lens - Book d&apos;animation</span>
      </div>
    </div>
    <span className={styles.footerBrand}>CRVO LENS - PILOTAGE OPÉRATIONNEL</span>
    <span className={styles.pageNumber}>{page} / 6</span>
  </>;
}

function deltaClass(value: number, positiveIsGood = true) {
  const good = positiveIsGood ? value >= 0 : value <= 0;
  return `${styles.delta} ${good ? styles.good : styles.bad}`;
}

function Sparkline({ values, color = BLUE }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const width = 320;
  const height = 118;
  const pad = 9;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const points = values.map((value, index) => ({
    x: pad + (values.length === 1 ? 0 : index / (values.length - 1)) * (width - pad * 2),
    y: pad + (max - value) / range * (height - pad * 2),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.x ?? pad},${height - pad} L${points[0].x},${height - pad} Z`;
  return <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <defs>
      <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity=".24"/>
        <stop offset="1" stopColor={color} stopOpacity=".015"/>
      </linearGradient>
    </defs>
    <path d={area} fill={`url(#spark-${color.replace("#", "")})`}/>
    <path d={line} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx={points.at(-1)?.x} cy={points.at(-1)?.y} r="4.5" fill="#fff" stroke={color} strokeWidth="3"/>
  </svg>;
}

function StockHistoryChart({ trend }: { trend: Snapshot[] }) {
  if (!trend.length) return null;
  const width = 760;
  const height = 255;
  const left = 42;
  const right = 18;
  const top = 18;
  const bottom = 36;
  const values = trend.map((item) => item.stock);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const margin = Math.max((max - min) * .22, 25);
  const yMin = Math.max(0, min - margin);
  const yMax = max + margin;
  const range = Math.max(yMax - yMin, 1);
  const usableW = width - left - right;
  const usableH = height - top - bottom;
  const points = values.map((value, index) => ({
    x: left + (values.length === 1 ? 0 : index / (values.length - 1)) * usableW,
    y: top + (yMax - value) / range * usableH,
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points.at(-1)?.x ?? left},${top + usableH} L${points[0].x},${top + usableH} Z`;
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Évolution du stock usine">
    <defs>
      <linearGradient id="stockArea" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={CYAN} stopOpacity=".25"/>
        <stop offset="1" stopColor={CYAN} stopOpacity=".02"/>
      </linearGradient>
    </defs>
    {[0, .5, 1].map((tick) => {
      const y = top + usableH * tick;
      const label = Math.round(yMax - range * tick);
      return <g key={tick}>
        <line x1={left} x2={width - right} y1={y} y2={y} stroke="#e6eef3" strokeWidth="1"/>
        <text x={left - 8} y={y + 4} textAnchor="end" className={styles.chartText}>{label}</text>
      </g>;
    })}
    <path d={area} fill="url(#stockArea)"/>
    <path d={line} fill="none" stroke={BLUE} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    {points.map((point, index) => <g key={trend[index].date}>
      <circle cx={point.x} cy={point.y} r={index === points.length - 1 ? 4.5 : 3} fill="#fff" stroke={index === points.length - 1 ? CYAN : BLUE} strokeWidth="2.5"/>
      <text x={point.x} y={height - 9} textAnchor="middle" className={styles.chartText}>{shortDate(trend[index].date)}</text>
    </g>)}
  </svg>;
}

export default function BookPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard?history=1", { cache: "no-store" })
      .then((response) => response.json() as Promise<HistoryPayload>)
      .then((payload) => {
        if (cancelled) return;
        const items = payload.snapshots?.length ? payload.snapshots : payload.snapshot ? [payload.snapshot] : [fallbackSnapshot];
        const ordered = [...items].sort((a, b) => a.date.localeCompare(b.date));
        setSnapshots(ordered);
        setSelectedDate(ordered.at(-1)?.date ?? fallbackSnapshot.date);
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshots([fallbackSnapshot]);
        setSelectedDate(fallbackSnapshot.date);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const model = useMemo(() => {
    const safeSnapshots = snapshots.length ? snapshots : [fallbackSnapshot];
    const selectedIndex = Math.max(safeSnapshots.findIndex((item) => item.date === selectedDate), 0);
    const snapshot = safeSnapshots[selectedIndex] ?? safeSnapshots.at(-1) ?? fallbackSnapshot;
    const previous = selectedIndex > 0 ? safeSnapshots[selectedIndex - 1] : null;
    const trend = safeSnapshots.slice(Math.max(0, selectedIndex - 6), selectedIndex + 1);
    const recentSlots: Array<Snapshot | null> = Array(Math.max(0, 7 - trend.length)).fill(null).concat(trend);
    const netFlow = snapshot.exits - snapshot.entries;
    const stockDelta = previous ? snapshot.stock - previous.stock : 0;
    const over20Delta = previous ? snapshot.over20 - previous.over20 : 0;
    const oldRate = snapshot.stock ? snapshot.over20 / snapshot.stock : 0;
    const mid = Math.max(snapshot.over15 - snapshot.over20, 0);
    const recent = Math.max(snapshot.stock - snapshot.over15, 0);
    const production = snapshot.production.map((item) => {
      const target = dailyTargets[item.name] ?? 1;
      return { ...item, target, ratio: target ? item.value / target : 0, gap: item.value - target };
    }).sort((a, b) => a.ratio - b.ratio);
    const worst = production[0];
    const secondWorst = production[1] ?? worst;
    const best = [...production].sort((a, b) => b.ratio - a.ratio)[0] ?? worst;
    const exitGap = snapshot.exits - 92;
    const signal = oldRate >= .38 || snapshot.exits < 75
      ? { title: "Journée sous tension", text: "Le vieillissement et/ou le niveau de sorties imposent une animation très ciblée sur les blocages et les véhicules à finir." }
      : exitGap < 0 || worst.ratio < .72
        ? { title: "Accélération attendue", text: "Le niveau global reste pilotable, mais la journée doit être animée sur les secteurs qui empêchent la transformation du stock en sorties." }
        : { title: "Rythme à consolider", text: "La dynamique est correcte. L'animation doit maintenant sécuriser la tenue du rythme et éviter la reconstitution d'encours." };
    const opening = exitGap < 0
      ? `Aujourd'hui, notre enjeu est simple : transformer davantage d'encours en sorties et concentrer l'effort sur ${worst.name}.`
      : `Le niveau de sorties est au rendez-vous. Notre enjeu est de tenir le rythme tout en réduisant le stock ancien et en sécurisant ${worst.name}.`;

    return { snapshot, previous, trend, recentSlots, netFlow, stockDelta, over20Delta, oldRate, mid, recent, production, worst, secondWorst, best, exitGap, signal, opening };
  }, [snapshots, selectedDate]);

  if (loading) return <div className={styles.loading}>Préparation du book d&apos;animation CRVO...</div>;

  const { snapshot, previous, trend, recentSlots, netFlow, stockDelta, over20Delta, oldRate, mid, recent, production, worst, secondWorst, best, exitGap, signal, opening } = model;
  const stockTrend = trend.map((item) => item.stock);
  const oldTrend = trend.map((item) => item.over20);
  const exitTrend = trend.map((item) => item.exits);
  const stockMove = stockTrend.length > 1 ? stockTrend.at(-1)! - stockTrend[0] : 0;
  const oldMove = oldTrend.length > 1 ? oldTrend.at(-1)! - oldTrend[0] : 0;
  const exitMove = exitTrend.length > 1 ? exitTrend.at(-1)! - exitTrend[0] : 0;

  return <main className={styles.shell}>
    <div className={styles.toolbar}>
      <div className={styles.toolbarLeft}>
        <a className={styles.backLink} href="/">← Retour au dashboard</a>
        <div className={styles.toolbarLabel}><strong>BOOK D&apos;ANIMATION</strong><span>6 pages A4 paysage - charte CRVO</span></div>
      </div>
      <div className={styles.toolbarRight}>
        <select className={styles.dateSelect} value={snapshot.date} onChange={(event) => setSelectedDate(event.target.value)} aria-label="Choisir la date du book">
          {snapshots.map((item) => <option value={item.date} key={item.date}>{item.label}</option>)}
        </select>
        <button className={styles.printButton} onClick={() => window.print()}>Exporter en PDF</button>
      </div>
    </div>

    <div className={styles.book}>
      <section className={`${styles.page} ${styles.cover}`}>
        <div className={styles.coverLeft}>
          <Image className={styles.coverLogo} src="/crvo-logo.png" width={240} height={82} alt="CRVO - Votre potentiel VO au plus haut" priority unoptimized/>
          <div>
            <span className={styles.coverEyebrow}>CRVO LENS - PILOTAGE QUOTIDIEN</span>
            <h1 className={styles.coverTitle}>Book d&apos;animation<span>Performance, flux et priorités terrain</span></h1>
            <div className={styles.cyanRule}/>
            <div className={styles.coverDate}>{snapshot.label}</div>
            <div className={styles.coverMeta}>Source : {snapshot.source}</div>
          </div>
        </div>
        <div className={styles.coverRight}>
          <div className={styles.coverSignal}>
            <span className={styles.signalTag}><i/> SIGNAL DU JOUR</span>
            <strong>{signal.title}</strong>
            <p>{signal.text}</p>
          </div>
          <div className={styles.coverKpis}>
            <div className={styles.coverKpi}><span>Entrées</span><strong>{snapshot.entries}</strong></div>
            <div className={styles.coverKpi}><span>Sorties</span><strong>{snapshot.exits}</strong></div>
            <div className={styles.coverKpi}><span>Stock usine</span><strong>{snapshot.stock.toLocaleString("fr-FR")}</strong></div>
            <div className={styles.coverKpi}><span>Stock +20 j</span><strong>{snapshot.over20}</strong></div>
          </div>
        </div>
      </section>

      <section className={styles.page}>
        <PageHeader eyebrow="01 - SYNTHÈSE" title="La journée en 4 chiffres" snapshot={snapshot} page={2}/>
        <div className={styles.kpiGrid}>
          <article className={`${styles.kpiCard} ${netFlow >= 0 ? styles.good : styles.warning}`}>
            <span className={styles.kpiLabel}>Entrées VOP</span>
            <div className={styles.kpiValue}><strong>{snapshot.entries}</strong><small>véhicules</small></div>
            <span className={deltaClass(previous ? snapshot.entries - previous.entries : 0, false)}>{previous ? `${signed(snapshot.entries - previous.entries)} vs veille` : "1re date disponible"}</span>
          </article>
          <article className={`${styles.kpiCard} ${snapshot.exits >= 92 ? styles.good : styles.warning}`}>
            <span className={styles.kpiLabel}>Sorties VOP</span>
            <div className={styles.kpiValue}><strong>{snapshot.exits}</strong><small>objectif 92</small></div>
            <span className={deltaClass(exitGap)}>{signed(exitGap)} vs objectif</span>
          </article>
          <article className={`${styles.kpiCard} ${stockDelta <= 0 ? styles.good : styles.warning}`}>
            <span className={styles.kpiLabel}>Stock usine</span>
            <div className={styles.kpiValue}><strong>{snapshot.stock.toLocaleString("fr-FR")}</strong><small>véhicules</small></div>
            <span className={deltaClass(stockDelta, false)}>{previous ? `${signed(stockDelta)} vs veille` : "base de référence"}</span>
          </article>
          <article className={`${styles.kpiCard} ${oldRate >= .38 ? styles.danger : styles.warning}`}>
            <span className={styles.kpiLabel}>Stock +20 jours</span>
            <div className={styles.kpiValue}><strong>{snapshot.over20}</strong><small>{Math.round(oldRate * 100)}% du parc</small></div>
            <span className={deltaClass(over20Delta, false)}>{previous ? `${signed(over20Delta)} vs veille` : "base de référence"}</span>
          </article>
        </div>
        <div className={styles.sectionGrid}>
          <article className={styles.panel}>
            <h3 className={styles.panelTitle}>Les 3 messages à faire passer</h3>
            <div className={styles.messageList}>
              <div className={styles.messageItem}><span className={styles.messageNumber}>1</span><div><strong>{exitGap >= 0 ? "Sécuriser la cadence de sortie" : "Reprendre du terrain sur les sorties"}</strong><p>{snapshot.exits} sorties réalisées pour une cible de 92. Le solde sorties - entrées est de {signed(netFlow)} véhicule{Math.abs(netFlow) > 1 ? "s" : ""}.</p></div></div>
              <div className={styles.messageItem}><span className={styles.messageNumber}>2</span><div><strong>Concentrer l&apos;animation sur {worst.name}</strong><p>{worst.value} réalisés pour une cible de {worst.target}, soit {Math.round(worst.ratio * 100)}% de l&apos;objectif. C&apos;est le premier point de blocage à traiter.</p></div></div>
              <div className={styles.messageItem}><span className={styles.messageNumber}>3</span><div><strong>Protéger le FIFO</strong><p>{snapshot.over20} véhicules dépassent 20 jours, soit {Math.round(oldRate * 100)}% du stock. La revue des plus vieux dossiers doit rester quotidienne.</p></div></div>
            </div>
          </article>
          <article className={`${styles.panel} ${styles.panelSoft}`}>
            <div className={styles.openingQuote}><span className={styles.quoteMark}>“</span><p>{opening}</p><span>Phrase d&apos;ouverture proposée pour le brief</span></div>
          </article>
        </div>
      </section>

      <section className={styles.page}>
        <PageHeader eyebrow="02 - PRODUCTION" title="Performance par secteur" snapshot={snapshot} page={3}/>
        <div className={styles.productionGrid}>
          {snapshot.production.map((item) => {
            const target = dailyTargets[item.name] ?? 1;
            const ratio = target ? item.value / target : 0;
            const gap = item.value - target;
            const isFocus = item.name === worst.name || item.name === secondWorst.name;
            return <article className={`${styles.productionCard} ${isFocus ? styles.focus : ""}`} key={item.name}>
              <h3>{item.name}</h3>
              <div className={styles.productionNumber}><strong>{item.value}</strong><span>/ cible {target}</span></div>
              <div className={styles.progress}><i style={{ width: `${Math.min(ratio * 100, 100)}%` }}/></div>
              <div className={styles.productionFoot}><span>{Math.round(ratio * 100)}% atteint</span><b className={gap < 0 ? styles.negative : styles.positive}>{signed(gap)}</b></div>
            </article>;
          })}
          <div className={styles.focusBand}>
            <div className={styles.focusCard}><span>FOCUS PRIORITAIRE</span><strong>{worst.name} - {worst.value}/{worst.target}</strong><p>{Math.max(worst.target - worst.value, 0)} véhicule{Math.max(worst.target - worst.value, 0) > 1 ? "s" : ""} à rattraper pour revenir à la cible du jour.</p></div>
            <div className={styles.focusCard}><span>SECOND POINT DE VIGILANCE</span><strong>{secondWorst.name}</strong><p>{Math.round(secondWorst.ratio * 100)}% de la cible atteinte. À relier immédiatement aux encours et aux blocages terrain.</p></div>
            <div className={styles.focusCard}><span>POINT D&apos;APPUI</span><strong>{best.name} - {Math.round(best.ratio * 100)}%</strong><p>Utiliser le secteur le plus performant comme référence de rythme et de méthode pendant l&apos;animation.</p></div>
          </div>
        </div>
      </section>

      <section className={styles.page}>
        <PageHeader eyebrow="03 - FLUX & STOCK" title="Transformer l'encours en sorties" snapshot={snapshot} page={4}/>
        <div className={styles.flowLayout}>
          <article className={styles.chartPanel}>
            <div className={styles.chartTitleRow}><h3>Évolution du stock usine</h3><span>{trend.length} journée{trend.length > 1 ? "s" : ""} disponible{trend.length > 1 ? "s" : ""}<br/>jusqu&apos;au {shortDate(snapshot.date)}</span></div>
            <div className={styles.chart}><StockHistoryChart trend={trend}/></div>
          </article>
          <div className={styles.flowSide}>
            <article className={styles.bigBalance}>
              <span>SOLDE DU JOUR - SORTIES MOINS ENTRÉES</span>
              <strong>{signed(netFlow)}</strong>
              <p>{netFlow >= 0 ? "Le flux contribue à réduire le stock sur la journée." : "Les entrées dépassent les sorties : le stock est mécaniquement sous pression."}</p>
            </article>
            <article className={styles.agingBox}>
              <h3>Ancienneté du parc</h3>
              <div className={styles.agingBar}>
                <i style={{ width: `${snapshot.stock ? recent / snapshot.stock * 100 : 0}%` }}/>
                <i style={{ width: `${snapshot.stock ? mid / snapshot.stock * 100 : 0}%` }}/>
                <i style={{ width: `${snapshot.stock ? snapshot.over20 / snapshot.stock * 100 : 0}%` }}/>
              </div>
              <div className={styles.agingLegend}>
                <div><span>0-15 jours</span><strong>{recent}</strong></div>
                <div><span>16-20 jours</span><strong>{mid}</strong></div>
                <div><span>+20 jours</span><strong>{snapshot.over20}</strong></div>
              </div>
            </article>
            <article className={styles.flowMessage}><span>MESSAGE TERRAIN</span><strong>{stockDelta <= 0 ? `Le stock baisse de ${Math.abs(stockDelta)} véhicule${Math.abs(stockDelta) > 1 ? "s" : ""} vs veille : tenir la cadence et accélérer sur les plus vieux.` : `Le stock progresse de ${stockDelta} véhicule${stockDelta > 1 ? "s" : ""} vs veille : les sorties doivent devenir la priorité commune de la journée.`}</strong></article>
          </div>
        </div>
      </section>

      <section className={styles.page}>
        <PageHeader eyebrow="04 - TENDANCES" title="Lire la dynamique, pas seulement le jour" snapshot={snapshot} page={5}/>
        <div className={styles.trendGrid}>
          <article className={styles.trendCard}>
            <div className={styles.trendCardHead}><span>STOCK USINE</span><strong>{snapshot.stock.toLocaleString("fr-FR")}</strong></div>
            <div className={styles.spark}><Sparkline values={stockTrend} color={BLUE}/></div>
            <p>Sur la période affichée, le stock évolue de {signed(stockMove)} véhicule{Math.abs(stockMove) > 1 ? "s" : ""}. {stockMove <= 0 ? "La trajectoire va dans le bon sens." : "La trajectoire nécessite davantage de transformation en sorties."}</p>
          </article>
          <article className={styles.trendCard}>
            <div className={styles.trendCardHead}><span>STOCK +20 JOURS</span><strong>{snapshot.over20}</strong></div>
            <div className={styles.spark}><Sparkline values={oldTrend} color={RED}/></div>
            <p>Le stock ancien évolue de {signed(oldMove)} sur la période. {oldMove <= 0 ? "La pression FIFO se réduit." : "Le vieillissement continue de progresser et doit être traité dossier par dossier."}</p>
          </article>
          <article className={styles.trendCard}>
            <div className={styles.trendCardHead}><span>SORTIES VOP</span><strong>{snapshot.exits}</strong></div>
            <div className={styles.spark}><Sparkline values={exitTrend} color={TEAL}/></div>
            <p>Les sorties évoluent de {signed(exitMove)} entre le début et la fin de la période. La cible quotidienne de référence reste 92 véhicules.</p>
          </article>
          <div className={styles.trendTable}>
            <div></div>{recentSlots.map((item, index) => <div className={styles.day} key={`day-${index}`}>{item ? shortDate(item.date) : "-"}</div>)}
            <div>Entrées</div>{recentSlots.map((item, index) => <div key={`in-${index}`}>{item?.entries ?? "-"}</div>)}
            <div>Sorties</div>{recentSlots.map((item, index) => <div key={`out-${index}`}>{item?.exits ?? "-"}</div>)}
            <div>Stock</div>{recentSlots.map((item, index) => <div key={`stock-${index}`}>{item?.stock ?? "-"}</div>)}
            <div>+20 jours</div>{recentSlots.map((item, index) => <div key={`old-${index}`}>{item?.over20 ?? "-"}</div>)}
          </div>
        </div>
      </section>

      <section className={styles.page}>
        <PageHeader eyebrow="05 - PLAN D'ANIMATION" title="Faire de la donnée une action" snapshot={snapshot} page={6}/>
        <div className={styles.planGrid}>
          <div className={styles.priorities}>
            <article className={styles.priority}>
              <div className={styles.priorityRank}>1</div>
              <div className={styles.priorityBody}><span>PRIORITÉ SECTEUR</span><strong>{worst.name} : revenir au rythme cible</strong><p>{worst.value} réalisés pour {worst.target} attendus. L&apos;animation doit partir des causes concrètes : encours, attente pièce, ressource, séquencement ou blocage qualité.</p></div>
              <div className={styles.priorityAction}><span>ACTION À OBTENIR</span><strong>1 blocage = 1 responsable = 1 heure de résolution</strong></div>
            </article>
            <article className={styles.priority}>
              <div className={styles.priorityRank}>2</div>
              <div className={styles.priorityBody}><span>PRIORITÉ FLUX</span><strong>{exitGap < 0 ? `Sécuriser ${Math.abs(exitGap)} sorties supplémentaires` : "Conserver la cadence au-dessus de la cible"}</strong><p>{snapshot.exits} sorties pour 92 attendues. Le brief doit rendre visible le nombre de véhicules réellement finissables aujourd&apos;hui.</p></div>
              <div className={styles.priorityAction}><span>ACTION À OBTENIR</span><strong>Nommer les véhicules qui doivent sortir avant la fin de poste</strong></div>
            </article>
            <article className={styles.priority}>
              <div className={styles.priorityRank}>3</div>
              <div className={styles.priorityBody}><span>PRIORITÉ FIFO</span><strong>Réduire les {snapshot.over20} véhicules à +20 jours</strong><p>{Math.round(oldRate * 100)}% du parc est au-delà de 20 jours. Chaque journée doit faire baisser le volume ancien, pas uniquement le stock global.</p></div>
              <div className={styles.priorityAction}><span>ACTION À OBTENIR</span><strong>Revue quotidienne des 10 plus vieux dossiers et décision de déblocage</strong></div>
            </article>
          </div>
          <aside className={styles.routine}>
            <h3>Rituel d&apos;animation</h3>
            <small>Format conseillé : 15 minutes, debout, orienté décision</small>
            <div className={styles.routineSteps}>
              <div className={styles.routineStep}><b>2 min</b><div><strong>Résultat</strong><span>Entrées, sorties, stock, +20 jours</span></div></div>
              <div className={styles.routineStep}><b>5 min</b><div><strong>Blocages</strong><span>Top 2 secteurs sous cible et encours associés</span></div></div>
              <div className={styles.routineStep}><b>5 min</b><div><strong>Décisions</strong><span>Responsable, action, heure de résolution</span></div></div>
              <div className={styles.routineStep}><b>3 min</b><div><strong>Engagement</strong><span>Véhicules à finir et objectif de sorties</span></div></div>
            </div>
            <div className={styles.commitment}><span>ENGAGEMENT DU JOUR</span><strong>{exitGap < 0 ? `Revenir au minimum à 92 sorties et débloquer en priorité ${worst.name}.` : `Tenir au moins 92 sorties et faire baisser simultanément le stock +20 jours.`}</strong></div>
          </aside>
        </div>
      </section>
    </div>
  </main>;
}
