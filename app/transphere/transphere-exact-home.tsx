"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TransphereSummary, TransphereTrend } from "./transphere-report";

type Payload = TransphereSummary & { connected?: boolean; error?: string };
type MetricKey = "total" | "entries" | "exits" | "serviceHours" | "fuelLPer100";

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

function variation(current: unknown, previous: unknown) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

function Sparkline({ values }: { values: number[] }) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return <div className="transphere-live-kpi__spark-empty" />;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(1e-6, max - min);
  const points = clean
    .map((value, index) => {
      const x = (index / Math.max(1, clean.length - 1)) * 100;
      const y = 32 - ((value - min) / range) * 25;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="transphere-live-kpi__spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricIcon({ type }: { type: "truck" | "in" | "out" | "clock" | "fuel" }) {
  if (type === "truck") {
    return <svg viewBox="0 0 48 48" fill="none"><path d="M7 15h22v17H7V15Zm22 7h7l6 7v3H29V22Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><circle cx="14" cy="34" r="4" stroke="currentColor" strokeWidth="2.5"/><circle cx="35" cy="34" r="4" stroke="currentColor" strokeWidth="2.5"/></svg>;
  }
  if (type === "in") {
    return <svg viewBox="0 0 48 48" fill="none"><path d="M10 31v7h28v-7M24 8v22m0 0-8-8m8 8 8-8" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  }
  if (type === "out") {
    return <svg viewBox="0 0 48 48" fill="none"><rect x="11" y="10" width="26" height="28" rx="5" stroke="currentColor" strokeWidth="2.5"/><path d="M24 31V16m0 0-7 7m7-7 7 7" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  }
  if (type === "clock") {
    return <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="2.7"/><path d="M24 15v10l7 5" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  }
  return <svg viewBox="0 0 48 48" fill="none"><path d="M24 7c7 10 13 17 13 25a13 13 0 1 1-26 0c0-8 6-15 13-25Z" stroke="currentColor" strokeWidth="2.7"/><path d="M19 33c1.5 3 4 4 7 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}

function LiveKpi({
  label,
  value,
  unit,
  detail,
  trend,
  previous,
  accent,
  icon,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  detail: string;
  trend: number[];
  previous?: number | null;
  accent: string;
  icon: "truck" | "in" | "out" | "clock" | "fuel";
}) {
  const change = variation(value, previous);
  return (
    <article className="transphere-live-kpi" style={{ "--accent": accent } as CSSProperties}>
      <div className="transphere-live-kpi__icon"><MetricIcon type={icon} /></div>
      <div className="transphere-live-kpi__body">
        <span>{label}</span>
        <div className="transphere-live-kpi__value">{value == null ? "—" : fmt(value, icon === "clock" || icon === "fuel" ? 1 : 0)}{unit ? <small>{unit}</small> : null}</div>
        <small className="transphere-live-kpi__detail">{detail}</small>
      </div>
      <div className="transphere-live-kpi__trend">
        {change == null ? <small>Historique réel</small> : <small>{change >= 0 ? "↗" : "↘"} {change > 0 ? "+" : ""}{fmt(change, 1)} % vs J-1</small>}
        <Sparkline values={trend} />
      </div>
    </article>
  );
}

function trendValues(rows: TransphereTrend[], key: MetricKey) {
  return rows.slice(-10).map((row) => {
    const value = row[key];
    return value == null ? NaN : Number(value);
  }).filter((value) => Number.isFinite(value));
}

export default function TransphereExactHome() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

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
            <img
              src="/transphere-home-exact.png"
              alt="Accueil Transphère"
              draggable={false}
              className="transphere-exact-home__visual"
            />

            <Link href="/transphere/dashboard" aria-label="Ouvrir le Dashboard Transphère" title="Dashboard" className="transphere-exact-home__hotspot transphere-exact-home__hotspot--dashboard" />
            <Link href="/transphere/matrice" aria-label="Ouvrir la matrice décisionnelle transport" title="Matrice décisionnelle transport" className="transphere-exact-home__hotspot transphere-exact-home__hotspot--matrix" />
            <Link href="/transphere/parametre" aria-label="Ouvrir les paramètres Transphère" title="Paramètre" className="transphere-exact-home__hotspot transphere-exact-home__hotspot--settings" />
          </div>
        </div>

        <section className="transphere-live-kpis" aria-label="Indicateurs Transphère en temps réel">
          <LiveKpi label="Véhicules convoyés" value={d?.total} detail={d ? `Objectif ${fmt(d.objective)} · écart ${d.delta > 0 ? "+" : ""}${fmt(d.delta)}` : "Donnée du Dashboard"} trend={trendValues(rows, "total")} previous={previous?.total} accent="#1187ff" icon="truck" />
          <LiveKpi label="Entrées CRVO" value={d?.entries} detail="PdV → CRVO" trend={trendValues(rows, "entries")} previous={previous?.entries} accent="#0aa99f" icon="in" />
          <LiveKpi label="Sorties CRVO" value={d?.exits} detail="CRVO → PdV" trend={trendValues(rows, "exits")} previous={previous?.exits} accent="#168dff" icon="out" />
          <LiveKpi label="Temps de service" value={d?.serviceHours} unit=" h" detail={m ? `${fmt(m.serviceHours, 1)} h cumulées mois` : "Donnée du Dashboard"} trend={trendValues(rows, "serviceHours")} previous={previous?.serviceHours} accent="#9b64e8" icon="clock" />
          <LiveKpi label="Consommation" value={d?.fuelLPer100} unit=" L/100" detail={m?.averageFuelLPer100 != null ? `Moyenne mois ${fmt(m.averageFuelLPer100, 1)} L/100` : "Donnée du Dashboard"} trend={trendValues(rows, "fuelLPer100")} previous={previous?.fuelLPer100} accent="#28b875" icon="fuel" />
        </section>

        <div className="transphere-live-kpis__status">{error ? error : data ? `Données réelles du Dashboard · arrêté au ${dateLabel(data.reportDate)}` : "Chargement des indicateurs réels…"}</div>
      </div>

      <style>{`
        html:has(.transphere-exact-home),
        body:has(.transphere-exact-home) {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          min-height: 100% !important;
          overflow: hidden !important;
          background: #031a34 !important;
        }
        body:has(.transphere-exact-home) .gn2-trigger,
        body:has(.transphere-exact-home) .trust-guard,
        body:has(.transphere-exact-home) .daily-animation-root { display: none !important; }

        .transphere-exact-home {
          position: fixed;
          inset: 0;
          z-index: 9999;
          overflow: auto;
          background: radial-gradient(circle at 50% 0%, #0a3560 0%, #031a34 54%, #021426 100%);
        }
        .transphere-exact-home__frame {
          width: min(100%, 1672px);
          min-height: 100%;
          margin: 0 auto;
          background: #031a34;
          box-shadow: 0 0 70px rgba(0,0,0,.28);
        }
        .transphere-exact-home__visual-crop {
          position: relative;
          width: 100%;
          aspect-ratio: 1672 / 742;
          overflow: hidden;
          background: #031a34;
        }
        .transphere-exact-home__visual-stage {
          position: absolute;
          inset: 0 auto auto 0;
          width: 100%;
          aspect-ratio: 1672 / 941;
        }
        .transphere-exact-home__visual {
          position: absolute;
          inset: 0;
          width: 100%;
          height: auto;
          display: block;
          user-select: none;
          -webkit-user-drag: none;
          pointer-events: none;
        }
        .transphere-exact-home__hotspot {
          position: absolute;
          z-index: 2;
          display: block;
          background: transparent;
          text-decoration: none;
          border-radius: 18px;
        }
        .transphere-exact-home__hotspot--dashboard { left: 3.35%; top: 48.15%; width: 29.55%; height: 29.2%; }
        .transphere-exact-home__hotspot--matrix { left: 34.10%; top: 48.15%; width: 29.80%; height: 29.2%; }
        .transphere-exact-home__hotspot--settings { left: 65.13%; top: 48.15%; width: 29.55%; height: 29.2%; }
        .transphere-exact-home__hotspot:focus-visible { outline: 3px solid #10bfff; outline-offset: -3px; }

        .transphere-live-kpis {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          padding: 14px 3.35% 10px;
          background: linear-gradient(180deg, #031a34 0%, #02172d 100%);
        }
        .transphere-live-kpi {
          --accent: #1187ff;
          min-width: 0;
          min-height: 128px;
          display: grid;
          grid-template-columns: 52px minmax(0,1fr) 82px;
          align-items: center;
          gap: 12px;
          padding: 16px 14px;
          color: #fff;
          border: 1px solid color-mix(in srgb, var(--accent) 46%, #16466e 54%);
          border-radius: 14px;
          background: linear-gradient(145deg, rgba(4,35,68,.96), rgba(1,24,48,.98));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 8px 24px rgba(0,0,0,.14);
        }
        .transphere-live-kpi__icon {
          width: 52px;
          height: 52px;
          display: grid;
          place-items: center;
          color: #e9f8ff;
          border: 1px solid color-mix(in srgb, var(--accent) 62%, transparent);
          border-radius: 50%;
          background: radial-gradient(circle at 35% 25%, color-mix(in srgb, var(--accent) 62%, #fff 4%), color-mix(in srgb, var(--accent) 34%, #04254a 66%));
          box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 22%, transparent);
        }
        .transphere-live-kpi__icon svg { width: 32px; height: 32px; }
        .transphere-live-kpi__body { min-width: 0; }
        .transphere-live-kpi__body > span {
          display: block;
          margin-bottom: 3px;
          color: rgba(255,255,255,.78);
          font-size: clamp(11px, .78vw, 14px);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .transphere-live-kpi__value {
          display: flex;
          align-items: baseline;
          gap: 5px;
          color: #fff;
          font-size: clamp(23px, 1.75vw, 32px);
          line-height: 1;
          font-weight: 800;
          letter-spacing: -.03em;
        }
        .transphere-live-kpi__value small { font-size: .48em; font-weight: 600; color: rgba(255,255,255,.82); }
        .transphere-live-kpi__detail {
          display: block;
          margin-top: 7px;
          color: rgba(211,232,248,.68);
          font-size: clamp(9px, .63vw, 11px);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .transphere-live-kpi__trend {
          align-self: stretch;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          min-width: 0;
          color: var(--accent);
        }
        .transphere-live-kpi__trend > small {
          min-height: 24px;
          color: #7fffd0;
          font-size: clamp(8px, .56vw, 10px);
          line-height: 1.15;
          text-align: right;
        }
        .transphere-live-kpi__spark { width: 100%; height: 42px; overflow: visible; filter: drop-shadow(0 0 5px currentColor); }
        .transphere-live-kpi__spark-empty { height: 42px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .transphere-live-kpis__status {
          padding: 0 3.35% 18px;
          color: rgba(174,211,239,.58);
          background: #02172d;
          font-size: 11px;
          text-align: right;
        }

        @media (max-width: 1180px) {
          .transphere-live-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
          .transphere-live-kpi:last-child { grid-column: span 2; }
        }
        @media (max-width: 700px) {
          .transphere-exact-home__frame { min-width: 0; }
          .transphere-live-kpis { grid-template-columns: 1fr; padding-left: 12px; padding-right: 12px; }
          .transphere-live-kpi:last-child { grid-column: auto; }
          .transphere-live-kpi { grid-template-columns: 52px minmax(0,1fr) 72px; }
          .transphere-live-kpis__status { padding-left: 12px; padding-right: 12px; }
        }
      `}</style>
    </main>
  );
}
