"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type FinancialSnapshot = {
  date: string;
  source: string;
  filename: string;
  metrics: Record<string, number | string | null>;
};

type Point = {
  date: string;
  label: string;
  actual: number | null;
  target: number;
  projection: number | null;
};

function euro(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function compactEuro(value: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value) + " €";
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00`));
}

function workingDates(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, mon - 1, day, 12);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    dates.push(`${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "");
}

function validNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSeries(rows: FinancialSnapshot[], month: string) {
  const monthRows = rows.filter((row) => row.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
  if (!monthRows.length) return null;

  const days = workingDates(month);
  const latest = monthRows.at(-1)!;
  const latestActual = validNumber(latest.metrics.revenue_cumulative) ?? 0;
  const explicitDayTarget = monthRows.map((row) => validNumber(row.metrics.revenue_day_target)).find((value) => value != null) ?? null;
  const explicitMonthTarget = monthRows.map((row) => validNumber(row.metrics.revenue_cumulative_target)).find((value) => value != null) ?? null;
  const dailyTarget = explicitDayTarget ?? (explicitMonthTarget && days.length ? explicitMonthTarget / days.length : 0);
  const monthTarget = explicitMonthTarget ?? dailyTarget * days.length;
  const elapsed = Math.max(days.filter((date) => date <= latest.date).length, 1);
  const averagePerWorkedDay = latestActual / elapsed;
  const projectionEnd = averagePerWorkedDay * days.length;
  const remainingDays = Math.max(days.length - elapsed, 0);
  const requiredPerDay = remainingDays > 0 ? Math.max(monthTarget - latestActual, 0) / remainingDays : 0;
  const actualByDate = new Map(monthRows.map((row) => [row.date, validNumber(row.metrics.revenue_cumulative)]));
  const latestIndex = Math.max(days.findIndex((date) => date === latest.date), elapsed - 1);

  const points: Point[] = days.map((date, index) => {
    const actual = actualByDate.get(date) ?? null;
    let projection: number | null = null;
    if (index === latestIndex) projection = latestActual;
    if (index > latestIndex) projection = latestActual + averagePerWorkedDay * (index - latestIndex);
    return { date, label: shortDate(date), actual, target: dailyTarget * (index + 1), projection };
  });

  return {
    points,
    monthTarget,
    projectionEnd,
    averagePerWorkedDay,
    requiredPerDay,
    totalDays: days.length,
    remainingDays,
    projectionGap: projectionEnd - monthTarget,
    attainmentProjection: monthTarget > 0 ? projectionEnd / monthTarget * 100 : 0,
  };
}

function RevenueSvg({ points }: { points: Point[] }) {
  const width = 1200, height = 390, left = 86, right = 36, top = 32, bottom = 58;
  const usableW = width - left - right, usableH = height - top - bottom;
  const values = points.flatMap((point) => [point.actual, point.target, point.projection]).filter((value): value is number => value != null);
  const maxValue = Math.max(...values, 1) * 1.08;
  const x = (index: number) => left + index / Math.max(points.length - 1, 1) * usableW;
  const y = (value: number) => top + (maxValue - value) / maxValue * usableH;
  const path = (series: Array<number | null>) => {
    let started = false;
    return series.map((value, index) => {
      if (value == null) return "";
      const command = started ? "L" : "M";
      started = true;
      return `${command}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    }).join(" ");
  };
  const actualPath = path(points.map((point) => point.actual));
  const targetPath = path(points.map((point) => point.target));
  const projectionPath = path(points.map((point) => point.projection));
  let lastActualIndex = 0;
  points.forEach((point, index) => { if (point.actual != null) lastActualIndex = index; });
  const areaPath = actualPath ? `${actualPath} L${x(lastActualIndex)},${top + usableH} L${x(0)},${top + usableH} Z` : "";
  const labels = Array.from(new Set([0, Math.floor((points.length - 1) * .25), Math.floor((points.length - 1) * .5), Math.floor((points.length - 1) * .75), points.length - 1]));

  return <div className="finance-month-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Évolution du chiffre d’affaires cumulé, objectif et projection fin de mois">
    <defs><linearGradient id="financeActualFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#009edb" stopOpacity=".22"/><stop offset="1" stopColor="#009edb" stopOpacity=".015"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map((tick) => { const yy = top + usableH * tick; return <g key={tick}><line className="finance-grid-line" x1={left} x2={width-right} y1={yy} y2={yy}/><text className="finance-axis-label" x={left-12} y={yy+4} textAnchor="end">{compactEuro(maxValue * (1-tick))}</text></g>; })}
    <path d={areaPath} fill="url(#financeActualFill)"/>
    <path d={targetPath} className="finance-target-line" fill="none"/>
    <path d={actualPath} className="finance-actual-line" fill="none"/>
    <path d={projectionPath} className="finance-projection-line" fill="none"/>
    {points.map((point,index) => point.actual != null ? <circle key={point.date} cx={x(index)} cy={y(point.actual)} r="5" className="finance-actual-dot"/> : null)}
    {labels.map((index) => <text key={index} className="finance-x-label" x={x(index)} y={height-18} textAnchor={index === 0 ? "start" : index === points.length-1 ? "end" : "middle"}>{points[index]?.label}</text>)}
  </svg><div className="finance-chart-legend"><span><i className="actual"/>CA réel cumulé</span><span><i className="target"/>Objectif cumulé</span><span><i className="projection"/>Projection au rythme actuel</span></div></div>;
}

export default function FinanceTrendPanel() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState<FinancialSnapshot[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("");

  useEffect(() => {
    const locate = () => {
      const kpis = document.querySelector(".finance-kpis") as HTMLElement | null;
      if (!kpis?.parentElement) { if (host) setHost(null); return; }
      let portal = document.getElementById("finance-trend-root");
      if (!portal) {
        portal = document.createElement("div");
        portal.id = "finance-trend-root";
        kpis.insertAdjacentElement("afterend", portal);
      }
      if (host !== portal) setHost(portal);
      const picker = document.querySelector(".finance-date-select") as any;
      if (picker?.value) setSelectedMonth(String(picker.value).slice(0, 7));
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    const onChange = (event: Event) => {
      const target = event.target as any;
      if (target?.classList?.contains("finance-date-select") && target.value) setSelectedMonth(String(target.value).slice(0, 7));
    };
    document.addEventListener("change", onChange);
    return () => { observer.disconnect(); document.removeEventListener("change", onChange); };
  }, [host]);

  useEffect(() => {
    if (!host) return;
    fetch("/api/finance?history=1", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("finance")))
      .then((payload: { snapshots?: FinancialSnapshot[] }) => {
        const snapshots = payload.snapshots ?? [];
        setRows(snapshots);
        if (!selectedMonth && snapshots[0]?.date) setSelectedMonth(snapshots[0].date.slice(0, 7));
      })
      .catch(() => setRows([]));
  }, [host, selectedMonth]);

  const trend = useMemo(() => selectedMonth ? buildSeries(rows, selectedMonth) : null, [rows, selectedMonth]);
  if (!host || !trend) return null;

  return createPortal(<section className="finance-trend-panel">
    <div className="finance-trend-heading"><div><span>TRAJECTOIRE DU MOIS</span><h3>CA cumulé, tendance & projection</h3><p>{monthLabel(selectedMonth)} · projection calculée sur le rythme moyen des jours ouvrés réellement écoulés.</p></div><div className="finance-projection-main"><span>PROJECTION FIN DE MOIS</span><strong>{euro(trend.projectionEnd)}</strong><small className={trend.projectionGap >= 0 ? "positive" : "negative"}>{trend.projectionGap >= 0 ? "+" : ""}{euro(trend.projectionGap)} vs objectif</small></div></div>
    <RevenueSvg points={trend.points}/>
    <div className="finance-trend-stats"><article><span>OBJECTIF MOIS</span><strong>{euro(trend.monthTarget)}</strong><small>{trend.totalDays} jours ouvrés</small></article><article><span>RYTHME ACTUEL</span><strong>{euro(trend.averagePerWorkedDay)}</strong><small>CA moyen / jour ouvré</small></article><article><span>CADENCE À TENIR</span><strong>{euro(trend.requiredPerDay)}</strong><small>{trend.remainingDays} jours ouvrés restants</small></article><article className={trend.attainmentProjection >= 100 ? "success" : "warning"}><span>ATTERRISSAGE PROJETÉ</span><strong>{trend.attainmentProjection.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%</strong><small>de l’objectif mensuel</small></article></div>
  </section>, host);
}
