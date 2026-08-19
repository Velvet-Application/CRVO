"use client";

import { useEffect, useState, type CSSProperties } from "react";
import styles from "./atelier.module.css";

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
  verifiedMetrics?: string[];
};

type Objective = {
  sectorKey: string;
  sectorLabel: string;
  dailyTarget: number;
  minThreshold: number | null;
  maxThreshold: number | null;
};

type ObjectivesPayload = {
  objectives?: Objective[];
  sortieDailyTargets?: Record<string, number>;
  connected?: boolean;
};

type DashboardPayload = {
  snapshot?: Snapshot;
  snapshots?: Snapshot[];
  connected?: boolean;
  backend?: string;
  liveFreshness?: { sourceModifiedAt?: string | null; factoryModifiedAt?: string | null; parkModifiedAt?: string | null } | null;
};

type SystemStatusPayload = {
  ftpRefresh?: {
    lastRefreshAt?: string | null;
    lastDepositAt?: string | null;
    lastDepositFilename?: string | null;
  } | null;
};

type VerifiedMetric = {
  metric_date: string;
  metric_key: string;
  metric_value: number | string;
  source_label: string;
  verified_at: string;
};

type VerifiedPayload = { rows?: VerifiedMetric[] };
type TargetContext = { objectiveMap: Record<string, Objective>; exitTarget: number };
type DecoratedProduction = Production & { target: number; percent: number; color: string };

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
  Mécanique: "mecanique",
  DSP: "dsp",
  Carrosserie: "carrosserie",
  Préparation: "preparation",
  Qualité: "qualite",
  "Sortie usine": "sortie_usine",
};

const productionMetricNames: Record<string, string> = {
  production_expertise: "Expertise",
  production_mechanics: "Mécanique",
  production_dsp: "DSP",
  production_bodywork: "Carrosserie",
  production_preparation: "Préparation",
  production_quality: "Qualité",
  production_factory_exit: "Sortie usine",
};

const toneColors: Record<string, string> = {
  coral: "#ef8582",
  green: "#55b779",
  cyan: "#29b9df",
  red: "#77cddd",
  purple: "#9f78d5",
  orange: "#e4a65f",
  blue: "#0b64b4",
  expertise: "#ef8582",
  mecanique: "#55b779",
  dsp: "#29b9df",
  carrosserie: "#77cddd",
  preparation: "#9f78d5",
  qualite_photo: "#e4a65f",
  sortie_usine: "#0b64b4",
};

function parisToday() {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const civilDate = `${part("year")}-${part("month")}-${part("day")}`;
  if (Number(part("hour")) >= 5) return civilDate;
  const cursor = new Date(`${civilDate}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

function isBusinessDay(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(`${value}T12:00:00Z`));
}

function shortDay(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" }).format(new Date(`${value}T12:00:00Z`));
}

function clock() {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" }).format(new Date());
}

function ftpClock(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" }).format(parsed);
}

function staleMinutes(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 60000) : Number.POSITIVE_INFINITY;
}

function applyVerifiedMetrics(rows: Snapshot[], verified: VerifiedMetric[]) {
  const byDate = new Map<string, VerifiedMetric[]>();
  for (const item of verified) {
    const list = byDate.get(item.metric_date) ?? [];
    list.push(item);
    byDate.set(item.metric_date, list);
  }
  return rows.map((row) => {
    const corrections = byDate.get(row.date) ?? [];
    if (!corrections.length) return row;
    let next = { ...row, production: row.production.map((item) => ({ ...item })), verifiedMetrics: corrections.map((item) => item.metric_key) };
    for (const item of corrections) {
      const value = Number(item.metric_value);
      if (!Number.isFinite(value)) continue;
      if (item.metric_key === "entries_vop") next.entries = value;
      if (item.metric_key === "exits_vop") next.exits = value;
      if (item.metric_key === "factory_stock") next.stock = value;
      if (item.metric_key === "stock_over_15d") next.over15 = value;
      if (item.metric_key === "stock_over_20d") next.over20 = value;
      const productionName = productionMetricNames[item.metric_key];
      if (productionName) next.production = next.production.map((production) => production.name === productionName ? { ...production, value } : production);
    }
    return next;
  });
}

function targetContext(snapshot: Snapshot | null, payload?: ObjectivesPayload): TargetContext {
  const objectives = payload?.objectives ?? [];
  const objectiveMap = Object.fromEntries(objectives.map((item) => [item.sectorKey, item]));
  const exitTarget = snapshot
    ? (payload?.sortieDailyTargets?.[snapshot.date] ?? objectiveMap.sortie_usine?.dailyTarget ?? fallbackTargets["Sortie usine"])
    : fallbackTargets["Sortie usine"];
  return { objectiveMap, exitTarget };
}

function decoratedProduction(snapshot: Snapshot | null, context: TargetContext): DecoratedProduction[] {
  if (!snapshot) return [];
  return snapshot.production.map((item) => {
    const key = sectorKeys[item.name];
    const target = item.name === "Sortie usine" ? context.exitTarget : context.objectiveMap[key]?.dailyTarget ?? fallbackTargets[item.name] ?? 0;
    const percent = target > 0 ? Math.round(item.value / target * 100) : 0;
    return { ...item, target, percent, color: toneColors[item.tone] ?? "#009edb" };
  });
}

function percent(value: number, target: number) {
  return target > 0 ? Math.round(value / target * 100) : 0;
}

export default function AtelierScreen() {
  const [liveSnapshot, setLiveSnapshot] = useState<Snapshot | null>(null);
  const [closedSnapshot, setClosedSnapshot] = useState<Snapshot | null>(null);
  const [objectivesByMonth, setObjectivesByMonth] = useState<Record<string, ObjectivesPayload>>({});
  const [connected, setConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");
  const [ftpLastRefreshAt, setFtpLastRefreshAt] = useState<string | null>(null);
  const [ftpLastDepositAt, setFtpLastDepositAt] = useState<string | null>(null);
  const [now, setNow] = useState(clock());
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const stamp = Date.now();
      const [dashboardResponse, systemResponse, verifiedResponse] = await Promise.all([
        fetch(`/api/kiosk/atelier?resource=dashboard&history=1&_=${stamp}`, { cache: "no-store" }),
        fetch(`/api/kiosk/atelier?resource=system-status&_=${stamp}`, { cache: "no-store" }),
        fetch(`/api/kiosk/atelier?resource=verified-metrics&_=${stamp}`, { cache: "no-store" }),
      ]);
      const dashboard = await dashboardResponse.json() as DashboardPayload;
      const systemStatus = systemResponse.ok ? await systemResponse.json() as SystemStatusPayload : null;
      const verifiedPayload = verifiedResponse.ok ? await verifiedResponse.json() as VerifiedPayload : null;
      const rawRows = dashboard.snapshots ?? (dashboard.snapshot ? [dashboard.snapshot] : []);
      const rows = applyVerifiedMetrics(rawRows, verifiedPayload?.rows ?? []);
      const today = parisToday();
      const live = rows.find((row) => row.date === today) ?? null;
      const closed = [...rows].reverse().find((row) => row.date < today && isBusinessDay(row.date)) ?? null;
      if (!live && !closed) throw new Error("Aucune donnée de production disponible.");

      const months = [...new Set([live?.date.slice(0, 7), closed?.date.slice(0, 7)].filter(Boolean) as string[])];
      const objectivePairs = await Promise.all(months.map(async (month) => {
        const response = await fetch(`/api/kiosk/atelier?resource=objectives&month=${month}&_=${Date.now()}`, { cache: "no-store" });
        const payload = response.ok ? await response.json() as ObjectivesPayload : {};
        return [month, payload] as const;
      }));

      setLiveSnapshot(live);
      setClosedSnapshot(closed);
      setObjectivesByMonth(Object.fromEntries(objectivePairs));
      setConnected(Boolean(dashboard.connected));
      setFtpLastRefreshAt(dashboard.liveFreshness?.factoryModifiedAt ?? dashboard.liveFreshness?.sourceModifiedAt ?? systemStatus?.ftpRefresh?.lastRefreshAt ?? null);
      setFtpLastDepositAt(dashboard.liveFreshness?.parkModifiedAt ?? dashboard.liveFreshness?.sourceModifiedAt ?? systemStatus?.ftpRefresh?.lastDepositAt ?? null);
      setLastRefresh(clock());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’actualiser l’écran atelier.");
      setLastRefresh(clock());
    }
  }

  useEffect(() => {
    void refresh();
    const refreshTimer = window.setInterval(() => void refresh(), 60000);
    const clockTimer = window.setInterval(() => setNow(clock()), 1000);
    return () => { window.clearInterval(refreshTimer); window.clearInterval(clockTimer); };
  }, []);

  if (!liveSnapshot && !closedSnapshot) {
    return <main className={styles.loading}><div className={styles.loader}/><strong>Connexion à la production atelier…</strong>{error && <span>{error}</span>}</main>;
  }

  const livePayload = liveSnapshot ? objectivesByMonth[liveSnapshot.date.slice(0, 7)] : undefined;
  const closedPayload = closedSnapshot ? objectivesByMonth[closedSnapshot.date.slice(0, 7)] : undefined;
  const liveContext = targetContext(liveSnapshot, livePayload);
  const closedContext = targetContext(closedSnapshot, closedPayload);
  const liveProduction = decoratedProduction(liveSnapshot, liveContext);
  const closedProduction = decoratedProduction(closedSnapshot, closedContext);
  const liveByName = new Map(liveProduction.map((item) => [item.name, item]));
  const closedByName = new Map(closedProduction.map((item) => [item.name, item]));
  const sectorNames = Object.keys(fallbackTargets).filter((name) => liveByName.has(name) || closedByName.has(name));

  const liveExitPercent = liveSnapshot ? percent(liveSnapshot.exits, liveContext.exitTarget) : 0;
  const closedExitPercent = closedSnapshot ? percent(closedSnapshot.exits, closedContext.exitTarget) : 0;
  const liveRemaining = liveSnapshot ? Math.max(liveContext.exitTarget - liveSnapshot.exits, 0) : liveContext.exitTarget;
  const ftpStale = Boolean(liveSnapshot) && staleMinutes(ftpLastRefreshAt) > 85;
  const closedVerified = Boolean(closedSnapshot?.verifiedMetrics?.some((key) => key === "exits_vop" || key === "production_factory_exit"));
  const liveStatus = !liveSnapshot ? "EN ATTENTE DU JOUR" : ftpStale ? "DÉPÔT EN RETARD" : "FLUX HORAIRE";

  return <main className={styles.screen}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>CRVO LENS · PILOTAGE TERRAIN</span>
        <h1>PRODUCTION ATELIER</h1>
      </div>
      <div className={styles.headerRight}>
        <div className={!ftpStale && liveSnapshot ? styles.live : styles.lastReading}><i/>{liveStatus}</div>
        <strong>{now}</strong>
        <small>Production FTP {ftpClock(ftpLastRefreshAt)} · Parc FTP {ftpClock(ftpLastDepositAt)}</small>
      </div>
    </header>

    <section className={styles.compareHero}>
      <article className={styles.todayPanel}>
        <div className={styles.dayTop}>
          <div><span>AUJOURD’HUI · EN COURS</span><strong>{liveSnapshot ? displayDate(liveSnapshot.date) : "Première donnée attendue"}</strong></div>
          <div className={!ftpStale && liveSnapshot ? styles.livePill : styles.warningPill}>{liveStatus}</div>
        </div>
        <div className={styles.summaryRow}>
          <div className={styles.summaryMain}>
            <small>SORTIES USINE · RÉALISÉ À {ftpClock(ftpLastRefreshAt)}</small>
            <div><strong>{liveSnapshot?.exits ?? "—"}</strong><b>/ {liveContext.exitTarget}</b></div>
            <p>{liveSnapshot ? (liveRemaining === 0 ? "Objectif du jour atteint" : `${liveRemaining} véhicule${liveRemaining > 1 ? "s" : ""} restant${liveRemaining > 1 ? "s" : ""}`) : "En attente du premier relevé de production"}</p>
          </div>
          <div className={styles.livePercent}><strong>{liveSnapshot ? `${liveExitPercent}%` : "—"}</strong><span>de l’objectif</span></div>
        </div>
        <div className={styles.heroTrack}><i style={{ width: `${Math.min(liveExitPercent, 100)}%` }}/></div>
        <div className={styles.miniStats}>
          <div><span>ENTRÉES</span><strong>{liveSnapshot?.entries ?? "—"}</strong></div>
          <div><span>STOCK</span><strong>{liveSnapshot?.stock ?? "—"}</strong></div>
          <div><span>STOCK +20 J</span><strong>{liveSnapshot?.over20 ?? "—"}</strong></div>
        </div>
      </article>

      <article className={styles.closedPanel}>
        <div className={styles.dayTop}>
          <div><span>DERNIÈRE JOURNÉE CLÔTURÉE</span><strong>{closedSnapshot ? displayDate(closedSnapshot.date) : "Aucune clôture disponible"}</strong></div>
          <div className={closedVerified ? styles.verifiedPill : styles.closedPill}>{closedVerified ? "CLÔTURE VÉRIFIÉE" : "CLÔTURÉ"}</div>
        </div>
        <div className={styles.summaryRow}>
          <div className={styles.summaryMain}>
            <small>SORTIES USINE · CHIFFRE FINAL</small>
            <div><strong>{closedSnapshot?.exits ?? "—"}</strong><b>/ {closedContext.exitTarget}</b></div>
            <p>{closedSnapshot ? `${closedExitPercent}% de l’objectif de la journée` : "Pas encore de journée clôturée"}</p>
          </div>
          <div className={styles.closedPercent}><strong>{closedSnapshot ? `${closedExitPercent}%` : "—"}</strong><span>final</span></div>
        </div>
        <div className={styles.closedTrack}><i style={{ width: `${Math.min(closedExitPercent, 100)}%` }}/></div>
        <div className={styles.miniStats}>
          <div><span>ENTRÉES</span><strong>{closedSnapshot?.entries ?? "—"}</strong></div>
          <div><span>STOCK</span><strong>{closedSnapshot?.stock ?? "—"}</strong></div>
          <div><span>STOCK +20 J</span><strong>{closedSnapshot?.over20 ?? "—"}</strong></div>
        </div>
      </article>
    </section>

    <section className={styles.grid}>
      {sectorNames.map((name) => {
        const live = liveByName.get(name);
        const closed = closedByName.get(name);
        const color = live?.color ?? closed?.color ?? "#009edb";
        return <article key={name} className={styles.card} style={{ "--sector-color": color } as CSSProperties}>
          <div className={styles.cardHead}><span>{name.toUpperCase()}</span><small>AUJOURD’HUI vs CLÔTURÉ</small></div>
          <div className={styles.dualMetrics}>
            <div className={styles.todayMetric}>
              <span>AUJOURD’HUI</span>
              <div><strong>{live?.value ?? "—"}</strong><b>/ {live?.target ?? fallbackTargets[name] ?? 0}</b></div>
              <em>{live ? `${live.percent}%` : "—"}</em>
              <div className={styles.metricTrack}><i style={{ width: `${Math.min(live?.percent ?? 0, 100)}%` }}/></div>
            </div>
            <div className={styles.closedMetric}>
              <span>{closedSnapshot ? shortDay(closedSnapshot.date).toUpperCase() : "CLÔTURÉ"}</span>
              <div><strong>{closed?.value ?? "—"}</strong><b>/ {closed?.target ?? fallbackTargets[name] ?? 0}</b></div>
              <em>{closed ? `${closed.percent}%` : "—"}</em>
              <div className={styles.metricTrack}><i style={{ width: `${Math.min(closed?.percent ?? 0, 100)}%` }}/></div>
            </div>
          </div>
        </article>;
      })}
    </section>

    <footer className={styles.footer}>
      <div className={styles.legendItem}><i className={styles.todayDot}/><span>CHIFFRES DU JOUR</span><strong>évolutifs</strong></div>
      <div className={styles.legendItem}><i className={styles.closedDot}/><span>CHIFFRES CLÔTURÉS</span><strong>définitifs</strong></div>
      <div className={styles.sync}><i className={!ftpStale && connected ? styles.syncOk : styles.syncFallback}/><span>{ftpStale ? "DÉPÔT FTP EN RETARD · DONNÉE HORODATÉE" : connected ? "FTP HORAIRE CONNECTÉ" : "DERNIÈRE DONNÉE DISPONIBLE"}</span><small>écran {lastRefresh || now} · production {ftpClock(ftpLastRefreshAt)} · parc {ftpClock(ftpLastDepositAt)}</small></div>
    </footer>

    {error && <div className={styles.error}>{error}</div>}
  </main>;
}