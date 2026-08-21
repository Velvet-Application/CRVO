"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TransphereSummary, TransphereTrend } from "./transphere-report";

type Payload = TransphereSummary & { connected?: boolean; error?: string };
type MetricKey = "total" | "entries" | "exits" | "serviceHours" | "fuelLPer100";
type MetricIconType = "truck" | "in" | "out" | "clock" | "fuel";

const METRICS: Record<MetricKey, { label: string; short: string; unit: string; digits: number; accent: string; icon: MetricIconType }> = {
  total: { label: "Véhicules convoyés", short: "Transports", unit: "", digits: 0, accent: "#1187ff", icon: "truck" },
  entries: { label: "Entrées CRVO", short: "Entrées", unit: "", digits: 0, accent: "#0aa99f", icon: "in" },
  exits: { label: "Sorties CRVO", short: "Sorties", unit: "", digits: 0, accent: "#168dff", icon: "out" },
  serviceHours: { label: "Temps de service", short: "Temps de service", unit: " h", digits: 1, accent: "#9b64e8", icon: "clock" },
  fuelLPer100: { label: "Consommation", short: "Consommation", unit: " L/100", digits: 1, accent: "#28b875", icon: "fuel" },
};

function fmt(value: unknown, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n)
    : "—";
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);
}

function variation(current: unknown, previous: unknown) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

function MetricIcon({ type }: { type: MetricIconType }) {
  if (type === "truck") return <svg viewBox="0 0 48 48" fill="none"><path d="M7 15h22v17H7V15Zm22 7h7l6 7v3H29V22Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><circle cx="14" cy="34" r="4" stroke="currentColor" strokeWidth="2.5"/><circle cx="35" cy="34" r="4" stroke="currentColor" strokeWidth="2.5"/></svg>;
  if (type === "in") return <svg viewBox="0 0 48 48" fill="none"><path d="M10 31v7h28v-7M24 8v22m0 0-8-8m8 8 8-8" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (type === "out") return <svg viewBox="0 0 48 48" fill="none"><rect x="11" y="10" width="26" height="28" rx="5" stroke="currentColor" strokeWidth="2.5"/><path d="M24 31V16m0 0-7 7m7-7 7 7" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (type === "clock") return <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="2.7"/><path d="M24 15v10l7 5" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  return <svg viewBox="0 0 48 48" fill="none"><path d="M24 7c7 10 13 17 13 25a13 13 0 1 1-26 0c0-8 6-15 13-25Z" stroke="currentColor" strokeWidth="2.7"/><path d="M19 33c1.5 3 4 4 7 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}

function Sparkline({ values }: { values: number[] }) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return <div className="transphere-live-kpi__spark-empty" />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(1e-6, max - min);
  const points = clean.map((value, index) => `${(index / Math.max(1, clean.length - 1)) * 100},${32 - ((value - min) / range) * 25}`).join(" ");
  return <svg className="transphere-live-kpi__spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function trendValues(rows: TransphereTrend[], key: MetricKey) {
  return rows.slice(-10).map((row) => row[key] == null ? NaN : Number(row[key])).filter(Number.isFinite);
}

function LiveKpi({ metric, value, detail, rows, previous, active, onActivate }: {
  metric: MetricKey;
  value: number | null | undefined;
  detail: string;
  rows: TransphereTrend[];
  previous?: number | null;
  active: boolean;
  onActivate: () => void;
}) {
  const config = METRICS[metric];
  const change = variation(value, previous);
  return (
    <article
      className={`transphere-live-kpi${active ? " is-active" : ""}`}
      style={{ "--accent": config.accent } as CSSProperties}
      tabIndex={0}
      role="button"
      aria-label={`Afficher la tendance 10 jours : ${config.label}`}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onClick={onActivate}
    >
      <div className="transphere-live-kpi__icon"><MetricIcon type={config.icon} /></div>
      <div className="transphere-live-kpi__body">
        <span>{config.label}</span>
        <div className="transphere-live-kpi__value">{value == null ? "—" : fmt(value, config.digits)}{config.unit ? <small>{config.unit}</small> : null}</div>
        <small className="transphere-live-kpi__detail">{detail}</small>
      </div>
      <div className="transphere-live-kpi__trend">
        {change == null ? <small>10 jours réels</small> : <small>{change >= 0 ? "↗" : "↘"} {change > 0 ? "+" : ""}{fmt(change, 1)} % vs J-1</small>}
        <Sparkline values={trendValues(rows, metric)} />
      </div>
    </article>
  );
}

function TenDayChart({ rows, metric }: { rows: TransphereTrend[]; metric: MetricKey }) {
  const config = METRICS[metric];
  const windowRows = rows.slice(-10);
  const pointsData = windowRows.map((row, index) => ({ index, date: row.date, value: row[metric] == null ? NaN : Number(row[metric]), objective: metric === "total" ? Number(row.objective) : NaN })).filter((item) => Number.isFinite(item.value));
  if (pointsData.length < 2) return <div className="transphere-kpi-detail__empty">Pas encore assez d’historique pour tracer 10 jours.</div>;

  const values = pointsData.map((item) => item.value);
  const objectives = metric === "total" ? pointsData.map((item) => item.objective).filter(Number.isFinite) : [];
  const all = [...values, ...objectives];
  const minRaw = Math.min(...all);
  const maxRaw = Math.max(...all);
  const padding = Math.max(1, (maxRaw - minRaw) * .18);
  const min = Math.max(0, minRaw - padding);
  const max = maxRaw + padding;
  const W = 1000, H = 280, PX = 54, PY = 30;
  const xFor = (index: number) => PX + ((W - PX * 2) * index / Math.max(1, windowRows.length - 1));
  const yFor = (value: number) => H - PY - ((value - min) / Math.max(1e-6, max - min)) * (H - PY * 2);
  const line = pointsData.map((item) => `${xFor(item.index)},${yFor(item.value)}`).join(" ");
  const objectiveLine = metric === "total" ? pointsData.filter((item) => Number.isFinite(item.objective)).map((item) => `${xFor(item.index)},${yFor(item.objective)}`).join(" ") : "";
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const latest = values.at(-1) ?? 0;
  const first = values[0] ?? latest;
  const delta = first === 0 ? null : ((latest - first) / Math.abs(first)) * 100;

  return (
    <section className="transphere-kpi-detail" style={{ "--detail-accent": config.accent } as CSSProperties}>
      <div className="transphere-kpi-detail__head">
        <div><small>TENDANCE · 10 JOURS GLISSANTS</small><h2>{config.label}</h2><p>Survolez ou sélectionnez un indicateur pour afficher sa trajectoire réelle.</p></div>
        <div className="transphere-kpi-detail__stats">
          <div><span>DERNIER</span><b>{fmt(latest, config.digits)}{config.unit}</b></div>
          <div><span>MOYENNE 10 J</span><b>{fmt(avg, config.digits)}{config.unit}</b></div>
          <div><span>ÉVOLUTION</span><b className={delta != null && delta < 0 ? "down" : "up"}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmt(delta, 1)} %`}</b></div>
        </div>
      </div>
      <div className="transphere-kpi-detail__chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="transphere-kpi-detail__chart" role="img" aria-label={`Évolution 10 jours ${config.label}`}>
          {[0,1,2,3,4].map((i) => { const y = PY + ((H - PY * 2) * i / 4); const label = max - ((max - min) * i / 4); return <g key={i}><line x1={PX} y1={y} x2={W-PX} y2={y} stroke="rgba(136,190,226,.16)"/><text x={PX-10} y={y+4} textAnchor="end" fill="rgba(207,229,244,.6)" fontSize="11">{fmt(label, config.digits)}</text></g>; })}
          {objectiveLine ? <polyline points={objectiveLine} fill="none" stroke="#fec82f" strokeWidth="3" strokeDasharray="9 8" strokeLinecap="round" strokeLinejoin="round" opacity=".9"/> : null}
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          {pointsData.map((item) => <circle key={item.date} cx={xFor(item.index)} cy={yFor(item.value)} r="5" fill="#041c37" stroke="currentColor" strokeWidth="3" />)}
          {windowRows.map((row, index) => <text key={row.date} x={xFor(index)} y={H-5} textAnchor="middle" fill="rgba(207,229,244,.68)" fontSize="11">{shortDate(row.date)}</text>)}
        </svg>
        {metric === "total" ? <div className="transphere-kpi-detail__legend"><span><i className="real"/>Réalisé</span><span><i className="objective"/>Objectif</span></div> : null}
      </div>
    </section>
  );
}

export default function TransphereExactHome() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [activeMetric, setActiveMetric] = useState<MetricKey>("total");

  useEffect(() => {
    let dead = false;
    async function load() {
      try {
        const response = await fetch(`/api/transphere/dashboard?_=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as Payload;
        if (!response.ok || payload.connected === false) throw new Error(payload.error || "Indicateurs Transphère indisponibles.");
        if (!dead) { setData(payload); setError(""); }
      } catch (cause) {
        if (!dead) setError(cause instanceof Error ? cause.message : "Indicateurs Transphère indisponibles.");
      }
    }
    void load();
    const timer = window.setInterval(load, 60000);
    return () => { dead = true; window.clearInterval(timer); };
  }, []);

  const previous = useMemo(() => {
    const rows = data?.trend ?? [];
    return rows.length > 1 ? rows[rows.length - 2] : null;
  }, [data?.trend]);

  const d = data?.day;
  const m = data?.monthToDate;
  const rows = data?.trend ?? [];

  return (
    <main className="transphere-exact-home">
      <div className="transphere-exact-home__frame">
        <div className="transphere-exact-home__visual-crop">
          <div className="transphere-exact-home__visual-stage">
            <img src="/transphere-home-exact.png" alt="Accueil Transphère" draggable={false} className="transphere-exact-home__visual" />
            <Link href="/transphere/dashboard" aria-label="Ouvrir le Dashboard Transphère" title="Dashboard" className="transphere-exact-home__hotspot transphere-exact-home__hotspot--dashboard" />
            <Link href="/transphere/matrice" aria-label="Ouvrir la matrice décisionnelle transport" title="Matrice décisionnelle transport" className="transphere-exact-home__hotspot transphere-exact-home__hotspot--matrix" />
            <Link href="/transphere/parametre" aria-label="Ouvrir les paramètres Transphère" title="Paramètre" className="transphere-exact-home__hotspot transphere-exact-home__hotspot--settings" />
          </div>
        </div>

        <section className="transphere-live-kpis" aria-label="Indicateurs Transphère en temps réel">
          <LiveKpi metric="total" value={d?.total} detail={d ? `Objectif ${fmt(d.objective)} · écart ${d.delta > 0 ? "+" : ""}${fmt(d.delta)}` : "Donnée du Dashboard"} rows={rows} previous={previous?.total} active={activeMetric === "total"} onActivate={() => setActiveMetric("total")} />
          <LiveKpi metric="entries" value={d?.entries} detail="PdV → CRVO" rows={rows} previous={previous?.entries} active={activeMetric === "entries"} onActivate={() => setActiveMetric("entries")} />
          <LiveKpi metric="exits" value={d?.exits} detail="CRVO → PdV" rows={rows} previous={previous?.exits} active={activeMetric === "exits"} onActivate={() => setActiveMetric("exits")} />
          <LiveKpi metric="serviceHours" value={d?.serviceHours} detail={m ? `${fmt(m.serviceHours, 1)} h cumulées mois` : "Donnée du Dashboard"} rows={rows} previous={previous?.serviceHours} active={activeMetric === "serviceHours"} onActivate={() => setActiveMetric("serviceHours")} />
          <LiveKpi metric="fuelLPer100" value={d?.fuelLPer100} detail={m?.averageFuelLPer100 != null ? `Moyenne mois ${fmt(m.averageFuelLPer100, 1)} L/100` : "Donnée du Dashboard"} rows={rows} previous={previous?.fuelLPer100} active={activeMetric === "fuelLPer100"} onActivate={() => setActiveMetric("fuelLPer100")} />
        </section>

        {data ? <TenDayChart rows={rows} metric={activeMetric} /> : null}
        <div className="transphere-live-kpis__status">{error ? error : data ? `Données réelles du Dashboard · arrêté au ${dateLabel(data.reportDate)}` : "Chargement des indicateurs réels…"}</div>
      </div>

      <style>{`
        html:has(.transphere-exact-home),body:has(.transphere-exact-home){margin:0!important;padding:0!important;width:100%!important;min-height:100%!important;overflow:hidden!important;background:#031a34!important}
        body:has(.transphere-exact-home) .gn2-trigger,body:has(.transphere-exact-home) .trust-guard,body:has(.transphere-exact-home) .daily-animation-root{display:none!important}
        .transphere-exact-home{position:fixed;inset:0;z-index:9999;overflow:auto;background:radial-gradient(circle at 50% 0%,#0a3560 0%,#031a34 54%,#021426 100%)}
        .transphere-exact-home__frame{width:min(100%,1672px);min-height:100%;margin:0 auto;background:#031a34;box-shadow:0 0 70px rgba(0,0,0,.28)}
        .transphere-exact-home__visual-crop{position:relative;width:100%;aspect-ratio:1672/742;overflow:hidden;background:#031a34}
        .transphere-exact-home__visual-stage{position:absolute;inset:0 auto auto 0;width:100%;aspect-ratio:1672/941}
        .transphere-exact-home__visual{position:absolute;inset:0;width:100%;height:auto;display:block;user-select:none;-webkit-user-drag:none;pointer-events:none}
        .transphere-exact-home__hotspot{position:absolute;z-index:2;display:block;background:transparent;text-decoration:none;border-radius:18px}
        .transphere-exact-home__hotspot--dashboard{left:3.35%;top:48.15%;width:29.55%;height:29.2%}.transphere-exact-home__hotspot--matrix{left:34.10%;top:48.15%;width:29.80%;height:29.2%}.transphere-exact-home__hotspot--settings{left:65.13%;top:48.15%;width:29.55%;height:29.2%}
        .transphere-exact-home__hotspot:focus-visible{outline:3px solid #10bfff;outline-offset:-3px}
        .transphere-live-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding:14px 3.35% 10px;background:linear-gradient(180deg,#031a34 0%,#02172d 100%)}
        .transphere-live-kpi{--accent:#1187ff;min-width:0;min-height:128px;display:grid;grid-template-columns:52px minmax(0,1fr) 82px;align-items:center;gap:12px;padding:16px 14px;color:#fff;border:1px solid color-mix(in srgb,var(--accent) 46%,#16466e 54%);border-radius:14px;background:linear-gradient(145deg,rgba(4,35,68,.96),rgba(1,24,48,.98));box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 8px 24px rgba(0,0,0,.14);cursor:pointer;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
        .transphere-live-kpi:hover,.transphere-live-kpi:focus-visible,.transphere-live-kpi.is-active{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 35%,transparent),0 13px 30px rgba(0,0,0,.22),0 0 26px color-mix(in srgb,var(--accent) 14%,transparent);outline:none}
        .transphere-live-kpi__icon{width:52px;height:52px;display:grid;place-items:center;color:#e9f8ff;border:1px solid color-mix(in srgb,var(--accent) 62%,transparent);border-radius:50%;background:radial-gradient(circle at 35% 25%,color-mix(in srgb,var(--accent) 62%,#fff 4%),color-mix(in srgb,var(--accent) 34%,#04254a 66%));box-shadow:0 0 24px color-mix(in srgb,var(--accent) 22%,transparent)}
        .transphere-live-kpi__icon svg{width:32px;height:32px}.transphere-live-kpi__body{min-width:0}.transphere-live-kpi__body>span{display:block;margin-bottom:3px;color:rgba(255,255,255,.78);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.transphere-live-kpi__value{font-size:28px;line-height:1;font-weight:900;font-style:italic}.transphere-live-kpi__value small{margin-left:4px;font-size:11px;font-style:normal;color:rgba(255,255,255,.75)}.transphere-live-kpi__detail{display:block;margin-top:7px;color:rgba(190,216,233,.68);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.transphere-live-kpi__trend{align-self:stretch;display:flex;flex-direction:column;justify-content:center;color:var(--accent);min-width:0}.transphere-live-kpi__trend small{min-height:28px;text-align:right;color:#7cf6c8;font-size:8px;line-height:1.15}.transphere-live-kpi__spark{width:100%;height:40px;margin-top:5px}.transphere-live-kpi__spark-empty{height:40px}
        .transphere-kpi-detail{--detail-accent:#1187ff;margin:4px 3.35% 0;padding:22px 24px 18px;color:#fff;border:1px solid color-mix(in srgb,var(--detail-accent) 34%,#173f62 66%);border-radius:20px;background:radial-gradient(circle at 86% 0%,color-mix(in srgb,var(--detail-accent) 17%,transparent),transparent 33%),linear-gradient(145deg,#062745,#031a34);box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 16px 34px rgba(0,0,0,.17)}
        .transphere-kpi-detail__head{display:flex;align-items:flex-start;justify-content:space-between;gap:22px}.transphere-kpi-detail__head small{color:var(--detail-accent);font-size:9px;font-weight:900;letter-spacing:.14em}.transphere-kpi-detail__head h2{margin:5px 0 4px;font-size:27px;font-style:italic}.transphere-kpi-detail__head p{margin:0;color:#8faec4;font-size:10px}.transphere-kpi-detail__stats{display:grid;grid-template-columns:repeat(3,minmax(110px,1fr));gap:8px}.transphere-kpi-detail__stats div{padding:10px 13px;border:1px solid rgba(129,182,219,.17);border-radius:12px;background:rgba(255,255,255,.03)}.transphere-kpi-detail__stats span{display:block;color:#7899b0;font-size:8px;font-weight:900}.transphere-kpi-detail__stats b{display:block;margin-top:4px;font-size:18px}.transphere-kpi-detail__stats b.up{color:#6cf3bc}.transphere-kpi-detail__stats b.down{color:#ff9a92}
        .transphere-kpi-detail__chart-wrap{position:relative;margin-top:10px}.transphere-kpi-detail__chart{width:100%;height:280px;color:var(--detail-accent);overflow:visible}.transphere-kpi-detail__chart text{font-family:Exo,Arial,sans-serif}.transphere-kpi-detail__legend{position:absolute;right:18px;top:8px;display:flex;gap:14px;color:#9bb4c8;font-size:9px}.transphere-kpi-detail__legend i{display:inline-block;width:22px;height:3px;margin-right:6px;vertical-align:middle;border-radius:3px}.transphere-kpi-detail__legend .real{background:var(--detail-accent)}.transphere-kpi-detail__legend .objective{background:#fec82f}.transphere-kpi-detail__empty{min-height:260px;display:grid;place-items:center;color:#86a4ba;font-size:12px}
        .transphere-live-kpis__status;padding:0 3.35% 18px;text-align:right;color:#65859e;font-size:9px}.transphere-live-kpis__status{padding:8px 3.35% 18px;text-align:right;color:#65859e;font-size:9px}
        @media(max-width:1180px){.transphere-live-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.transphere-live-kpi:last-child{grid-column:span 2}.transphere-kpi-detail__head{flex-direction:column}.transphere-kpi-detail__stats{width:100%}}
        @media(max-width:700px){.transphere-exact-home__frame{width:100%}.transphere-exact-home__visual-crop{aspect-ratio:1672/742}.transphere-live-kpis{grid-template-columns:1fr;padding-left:14px;padding-right:14px}.transphere-live-kpi:last-child{grid-column:auto}.transphere-live-kpi{grid-template-columns:46px minmax(0,1fr) 78px;min-height:112px;padding:13px}.transphere-live-kpi__icon{width:46px;height:46px}.transphere-kpi-detail{margin-left:14px;margin-right:14px;padding:18px 14px}.transphere-kpi-detail__stats{grid-template-columns:1fr}.transphere-kpi-detail__chart{height:230px}.transphere-kpi-detail__chart text{font-size:9px}.transphere-live-kpis__status{padding-left:14px;padding-right:14px}}
      `}</style>
    </main>
  );
}
