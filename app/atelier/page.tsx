"use client";

import { useEffect, useMemo, useState } from "react";
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

const toneColors: Record<string, string> = {
  coral: "#ef8582",
  green: "#55b779",
  cyan: "#29b9df",
  red: "#77cddd",
  purple: "#9f78d5",
  orange: "#e4a65f",
  blue: "#0b64b4",
};

function parisToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date(`${value}T12:00:00+02:00`));
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

export default function AtelierScreen() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [exitTargets, setExitTargets] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [lastRefresh, setLastRefresh] = useState("");
  const [ftpLastRefreshAt, setFtpLastRefreshAt] = useState<string | null>(null);
  const [ftpLastDepositAt, setFtpLastDepositAt] = useState<string | null>(null);
  const [now, setNow] = useState(clock());
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const [dashboardResponse, systemResponse] = await Promise.all([
        fetch(`/api/dashboard?history=1&_=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/system-status?_=${Date.now()}`, { cache: "no-store" }),
      ]);
      const dashboard = await dashboardResponse.json() as DashboardPayload;
      const systemStatus = systemResponse.ok ? await systemResponse.json() as SystemStatusPayload : null;
      const rows = dashboard.snapshots ?? (dashboard.snapshot ? [dashboard.snapshot] : []);
      const latest = rows.at(-1) ?? dashboard.snapshot ?? null;
      if (!latest) throw new Error("Aucune donnée de production disponible.");

      const objectiveResponse = await fetch(`/api/objectives?month=${latest.date.slice(0, 7)}&_=${Date.now()}`, { cache: "no-store" });
      const objectivePayload = await objectiveResponse.json() as ObjectivesPayload;

      setSnapshot(latest);
      setObjectives(objectivePayload.objectives ?? []);
      setExitTargets(objectivePayload.sortieDailyTargets ?? {});
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

  const objectiveMap = useMemo(() => Object.fromEntries(objectives.map((item) => [item.sectorKey, item])), [objectives]);
  const exitTarget = snapshot ? (exitTargets[snapshot.date] ?? objectiveMap.sortie_usine?.dailyTarget ?? fallbackTargets["Sortie usine"]) : fallbackTargets["Sortie usine"];
  const exitPercent = snapshot && exitTarget > 0 ? Math.round(snapshot.exits / exitTarget * 100) : 0;
  const remaining = snapshot ? Math.max(exitTarget - snapshot.exits, 0) : exitTarget;
  const isToday = snapshot?.date === parisToday();

  const production = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.production.map((item) => {
      const key = sectorKeys[item.name];
      const target = item.name === "Sortie usine"
        ? exitTarget
        : objectiveMap[key]?.dailyTarget ?? fallbackTargets[item.name] ?? 0;
      const percent = target > 0 ? Math.round(item.value / target * 100) : 0;
      return { ...item, target, percent, color: toneColors[item.tone] ?? "#009edb" };
    });
  }, [snapshot, objectiveMap, exitTarget]);

  const pulseMessage = exitPercent >= 100
    ? "OBJECTIF ATTEINT · BRAVO À TOUTE L’ÉQUIPE"
    : exitPercent >= 85
      ? "DERNIÈRE LIGNE DROITE"
      : exitPercent >= 65
        ? "BON RYTHME · ON GARDE LA CADENCE"
        : "CAP SUR L’OBJECTIF DU JOUR";

  if (!snapshot) {
    return <main className={styles.loading}><div className={styles.loader}/><strong>Connexion à la production atelier…</strong>{error && <span>{error}</span>}</main>;
  }

  return <main className={styles.screen}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>CRVO LENS · PILOTAGE TERRAIN</span>
        <h1>PRODUCTION ATELIER</h1>
      </div>
      <div className={styles.headerRight}>
        <div className={isToday ? styles.live : styles.lastReading}><i/>{isToday ? "EN DIRECT" : "DERNIER RELEVÉ"}</div>
        <strong>{now}</strong>
        <small>{displayDate(snapshot.date)}</small>
      </div>
    </header>

    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span>SORTIES USINE · RÉALISÉ À {ftpClock(ftpLastRefreshAt)}</span>
        <div className={styles.heroNumbers}><strong>{snapshot.exits}</strong><b>/ {exitTarget}</b></div>
        <p>{remaining === 0 ? "Objectif du jour atteint" : `${remaining} véhicule${remaining > 1 ? "s" : ""} à sortir pour atteindre l’objectif`}</p>
        <div className={styles.heroTrack}><i style={{ width: `${Math.min(exitPercent, 100)}%` }}/><span style={{ left: `${Math.min(exitPercent, 100)}%` }}>{exitPercent}%</span></div>
      </div>
      <div className={styles.heroSignal}>
        <span>{pulseMessage}</span>
        <div className={exitPercent >= 100 ? styles.goalRingDone : styles.goalRing}>
          <strong>{exitPercent}%</strong>
          <small>de l’objectif</small>
        </div>
      </div>
    </section>

    <section className={styles.grid}>
      {production.map((item) => <article key={item.name} className={`${styles.card} ${item.percent >= 100 ? styles.cardDone : item.percent >= 75 ? styles.cardNear : ""}`} style={{ "--sector-color": item.color } as React.CSSProperties}>
        <div className={styles.cardHead}><span>{item.name.toUpperCase()}</span><b>{item.percent >= 100 ? "OBJECTIF ✓" : `${item.percent}%`}</b></div>
        <div className={styles.cardValues}><strong>{item.value}</strong><span>/ {item.target}</span></div>
        <div className={styles.cardTrack}><i style={{ width: `${Math.min(item.percent, 100)}%` }}/></div>
        <small>{item.percent >= 100 ? `+${item.value - item.target} au-dessus de l’objectif` : `${Math.max(item.target - item.value, 0)} restant${Math.max(item.target - item.value, 0) > 1 ? "s" : ""}`}</small>
      </article>)}
    </section>

    <footer className={styles.footer}>
      <div><span>ENTRÉES</span><strong>{snapshot.entries}</strong></div>
      <div><span>STOCK USINE</span><strong>{snapshot.stock}</strong></div>
      <div><span>STOCK +20 J</span><strong>{snapshot.over20}</strong></div>
      <div className={styles.sync}><i className={connected ? styles.syncOk : styles.syncFallback}/><span>{connected ? "FTP LIVE CONNECTÉ" : "DERNIÈRE DONNÉE DISPONIBLE"}</span><small>écran {lastRefresh || now} · production FTP {ftpClock(ftpLastRefreshAt)} · parc FTP {ftpClock(ftpLastDepositAt)}</small></div>
    </footer>

    {error && <div className={styles.error}>{error}</div>}
  </main>;
}
