"use client";

import { useEffect, useMemo, useState } from "react";
import { type TransphereSummary, type TransphereTrend } from "./transphere-report";
import styles from "./transphere-dashboard.module.css";

type Payload = TransphereSummary & { connected?: boolean; generatedBy?: string; username?: string; error?: string };

function fmt(value: unknown, digits = 0) { const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n) : "—"; }
function signed(value: unknown, suffix = "") { const n = Number(value); return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${fmt(n)}${suffix}` : "—"; }
function dateLabel(value?: string | null) { if (!value) return "—"; const d = new Date(`${value}T12:00:00Z`); return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d); }
function shortDate(value: string) { const d = new Date(`${value}T12:00:00Z`); return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(d); }

function TrajectoryChart({ trend }: { trend: TransphereTrend[] }) {
  const w = 900, h = 280, padX = 42, padY = 28;
  const max = Math.max(1, ...trend.flatMap((r) => [r.cumulative, r.cumulativeObjective]));
  const points = (key: "cumulative" | "cumulativeObjective") => trend.map((row, i) => `${padX + (w - padX * 2) * i / Math.max(1, trend.length - 1)},${h - padY - (h - padY * 2) * row[key] / max}`).join(" ");
  return <svg className={styles.chart} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Trajectoire mensuelle Transphère">
    {[0,1,2,3,4].map((i) => <line key={i} x1={padX} y1={padY + (h - padY * 2) * i / 4} x2={w-padX} y2={padY + (h - padY * 2) * i / 4} stroke="#e4edf2" strokeWidth="1"/>)}
    <polyline points={points("cumulativeObjective")} fill="none" stroke="#fec82f" strokeWidth="5" strokeDasharray="10 8" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points={points("cumulative")} fill="none" stroke="#0055a5" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    {trend.map((row, i) => { const x = padX + (w - padX * 2) * i / Math.max(1, trend.length - 1); const y = h - padY - (h - padY * 2) * row.cumulative / max; return <circle key={row.date} cx={x} cy={y} r="4" fill="#0aa99f"/>; })}
    <text x={padX} y={h-5} fill="#6c8499" fontSize="11">{trend[0] ? shortDate(trend[0].date) : ""}</text>
    <text x={w/2} y={h-5} fill="#6c8499" fontSize="11" textAnchor="middle">{trend[Math.floor((trend.length-1)/2)] ? shortDate(trend[Math.floor((trend.length-1)/2)].date) : ""}</text>
    <text x={w-padX} y={h-5} fill="#6c8499" fontSize="11" textAnchor="end">{trend.at(-1) ? shortDate(trend.at(-1)!.date) : ""}</text>
  </svg>;
}

export default function TransphereDashboard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { const response = await fetch(`/api/transphere/dashboard?_=${Date.now()}`, { cache: "no-store" }); const payload = await response.json().catch(() => ({})) as Payload; if (!response.ok || payload.connected === false) throw new Error(payload.error || "Dashboard Transphère indisponible."); setData(payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Dashboard Transphère indisponible."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const readout = useMemo(() => {
    if (!data) return "";
    if (data.monthToDate.delta >= 0) return `La trajectoire est en avance de ${fmt(data.monthToDate.delta)} transports. ${data.day.delta >= 0 ? `La journée du ${dateLabel(data.reportDate)} renforce cette avance avec ${signed(data.day.delta, " véhicule")}.` : `La journée est sous sa cible de ${fmt(Math.abs(data.day.delta))} véhicules, mais l'avance cumulée reste solide.`}`;
    return `La trajectoire accuse un retard de ${fmt(Math.abs(data.monthToDate.delta))} transports. Il faut sécuriser les rotations et la disponibilité chauffeurs pour reprendre l'objectif.`;
  }, [data]);

  if (loading && !data) return <main className={styles.page}><div className={styles.loading}>Chargement du cockpit Transphère…</div></main>;
  if (!data) return <main className={styles.page}><div className={styles.error}>{error || "Aucune donnée Transphère."}</div></main>;

  const d = data.day, m = data.monthToDate;
  return <main className={`${styles.page} transphere-shell`}>
    <div className={styles.shell}>
      <div style={{marginBottom:14}}><a href="/transphere" style={{fontWeight:800,color:"#0055a5",textDecoration:"none"}}>← Accueil Transphère</a></div>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logoBox} role="img" aria-label="Transphère" />
          <div><small>ENVIRONNEMENT TRANSPHÈRE</small><h1>Pilotage Transphère</h1><p>Navettes CRVO · flux entrées/sorties · temps de service · consommation</p></div>
        </div>
        <div><div className={styles.actions}><button onClick={() => void load()} disabled={loading}>{loading ? "Actualisation…" : "Actualiser"}</button></div><div className={styles.source}>Arrêté au {dateLabel(data.reportDate)} · {data.sourceFile || "Book Transphère"}</div></div>
      </header>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.heroGrid}>
        <article className={styles.heroCard}><small>TRANSPORTS CUMULÉS · MOIS EN COURS</small><div className={styles.heroTop}><div className={styles.heroValue}>{fmt(m.total)}</div><div className={styles.heroObjective}><span>OBJECTIF À DATE</span><b>{fmt(m.objectiveAtDate)}</b><span>{fmt(m.achievementAtDate,1)} % de réalisation</span></div></div><div className={styles.progress}><i style={{ width: `${Math.min(100, m.monthlyProgress ?? 0)}%` }}/></div><div className={styles.heroMeta}><span>Écart cumulé <b>{signed(m.delta)}</b></span><span>Entrées <b>{fmt(m.entries)}</b></span><span>Sorties <b>{fmt(m.exits)}</b></span><span>Moyenne <b>{fmt(m.averageDaily,1)}/j</b></span></div></article>
        <article className={styles.objectiveCard}><small>🎯 OBJECTIF MENSUEL</small><strong>{fmt(m.monthlyTarget)} transports</strong><p>{fmt(m.monthlyProgress,1)} % déjà réalisé · reste {fmt(m.remainingToTarget)} transports</p><div className={styles.objectiveStats}><div><span>JOURS RÉALISÉS</span><b>{fmt(m.workedDays)}</b></div><div><span>AVANCE / RETARD</span><b>{signed(m.delta)}</b></div></div></article>
      </section>

      <section className={styles.kpis}>
        <article className={styles.kpi} style={{ "--accent": "#0055a5" } as React.CSSProperties}><span>VÉHICULES CONVOYÉS · VEILLE</span><strong>{fmt(d.total)}</strong><small>objectif {fmt(d.objective)} · {signed(d.delta)} · {fmt(d.achievement,1)} %</small></article>
        <article className={styles.kpi} style={{ "--accent": "#0aa99f" } as React.CSSProperties}><span>ENTRÉES CRVO</span><strong>{fmt(d.entries)}</strong><small>PdV → CRVO</small></article>
        <article className={styles.kpi} style={{ "--accent": "#00a7d7" } as React.CSSProperties}><span>SORTIES CRVO</span><strong>{fmt(d.exits)}</strong><small>CRVO → PdV</small></article>
        <article className={styles.kpi} style={{ "--accent": "#003a78" } as React.CSSProperties}><span>TEMPS DE SERVICE</span><strong>{fmt(d.serviceHours,1)} h</strong><small>{fmt(m.serviceHours,1)} h cumulées sur le mois</small></article>
        <article className={styles.kpi} style={{ "--accent": "#fec82f" } as React.CSSProperties}><span>CONSOMMATION</span><strong>{fmt(d.fuelLPer100,1)}</strong><small>L/100 km · moyenne mois {fmt(m.averageFuelLPer100,1)}</small></article>
      </section>

      <section className={styles.content}>
        <article className={styles.panel}><div className={styles.panelHead}><div><small>01 · TRAJECTOIRE</small><h2>Réalisé vs objectif cumulé</h2></div><div className={styles.legend}><span><i style={{background:"#0055a5"}}/>Réalisé</span><span><i style={{background:"#fec82f"}}/>Objectif</span></div></div><TrajectoryChart trend={data.trend}/><div className={styles.dailyTable}>{data.trend.slice(-7).map((row) => <div className={styles.dailyRow} key={row.date}><b>{shortDate(row.date)}</b><span>IN <b>{fmt(row.entries)}</b></span><span>OUT <b>{fmt(row.exits)}</b></span><span>Total <b>{fmt(row.total)}</b></span><span className={row.total >= row.objective ? styles.good : styles.bad}>{fmt(row.total/Math.max(1,row.objective)*100)} %</span></div>)}</div></article>
        <aside className={styles.panel}><div className={styles.panelHead}><div><small>02 · LECTURE MANAGER</small><h2>Animation du jour</h2></div></div><div className={styles.readCard}><strong>{m.delta >= 0 ? "Dynamique positive" : "Trajectoire à reprendre"}</strong><p>{readout}</p></div><div className={styles.miniStats}><div><span>MOYENNE JOUR</span><b>{fmt(m.averageDaily,1)} transports</b></div><div><span>RÉALISATION À DATE</span><b>{fmt(m.achievementAtDate,1)} %</b></div><div><span>HEURES CUMULÉES</span><b>{fmt(m.serviceHours,1)} h</b></div><div><span>CONSO MOYENNE</span><b>{fmt(m.averageFuelLPer100,1)} L/100</b></div></div></aside>
      </section>
    </div>
    <style>{`body:has(.transphere-shell) .gn2-trigger,body:has(.transphere-shell) .trust-guard,body:has(.transphere-shell) .daily-animation-root{display:none!important}`}</style>
  </main>;
}
