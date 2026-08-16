"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./sources.module.css";

type SystemStatus = {
  supabase?: boolean;
  supabaseStatus?: string;
  ftpBridge?: boolean;
  ftpRefresh?: {
    lastRefreshAt?: string | null;
    lastDepositAt?: string | null;
    lastDepositFilename?: string | null;
    filesSeen?: number;
    filesImported?: number;
    bridgeStatus?: string | null;
    bridgeStartedAt?: string | null;
    bridgeFinishedAt?: string | null;
    protocol?: string | null;
  } | null;
  readiness?: Record<string, { latestDate?: string | null; updatedAt?: string | null; ready?: boolean; lastSyncStatus?: string | null }>;
  error?: string;
};

type HistoryRow = {
  snapshotAt?: string | null;
  filename: string;
  archivedFilename?: string | null;
  depositAt?: string | null;
  importedAt?: string | null;
  readyAt?: string | null;
  delayMinutes?: number | null;
  status?: string | null;
  rows?: number | null;
  remotePath?: string | null;
};

type FileSummary = {
  filename: string;
  imports: number;
  lastDepositAt?: string | null;
  lastImportAt?: string | null;
  lastReadyAt?: string | null;
  avgDelayMinutes?: number | null;
  minDelayMinutes?: number | null;
  maxDelayMinutes?: number | null;
};

type BridgeRun = {
  startedAt?: string | null;
  finishedAt?: string | null;
  status?: string | null;
  filesSeen?: number | null;
  filesImported?: number | null;
  protocol?: string | null;
};

type HistoryPayload = {
  ok?: boolean;
  generatedAt?: string;
  windowHours?: number;
  cadenceMinutes?: number;
  history?: HistoryRow[];
  files?: FileSummary[];
  bridgeRuns?: BridgeRun[];
  error?: string;
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error || `${response.status}`);
  return payload as T;
}

function dt(value?: string | null, seconds = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  }).format(date);
}

function fmt(value?: number | null, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("fr-FR", { maximumFractionDigits: digits });
}

function delayClass(value?: number | null) {
  if (value == null) return styles.delayNeutral;
  if (value <= 15) return styles.delayGood;
  if (value <= 30) return styles.delayWatch;
  return styles.delayLate;
}

const priority = ["EtatduParc.csv", "Factory-j+1.csv", "Analyse-Temps-Bruts.csv", "Factory-j-1.csv"];

export default function SourcesClient() {
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [period, setPeriod] = useState<24 | 168>(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    try {
      const [status, imports] = await Promise.all([
        readJson<SystemStatus>("/api/system-status"),
        readJson<HistoryPayload>("/api/ftp-history?hours=168&limit=400"),
      ]);
      setSystem(status);
      setHistory(imports);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Contrôle des sources impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = useMemo(() => {
    const cutoff = Date.now() - period * 60 * 60 * 1000;
    return (history?.history ?? []).filter(row => {
      const raw = row.depositAt ?? row.importedAt;
      if (!raw) return false;
      const value = new Date(raw).getTime();
      return Number.isFinite(value) && value >= cutoff;
    });
  }, [history, period]);

  const files = useMemo(() => [...(history?.files ?? [])].sort((a, b) => {
    const pa = priority.indexOf(a.filename), pb = priority.indexOf(b.filename);
    if (pa >= 0 || pb >= 0) return (pa >= 0 ? pa : 99) - (pb >= 0 ? pb : 99);
    return String(b.lastDepositAt ?? "").localeCompare(String(a.lastDepositAt ?? ""));
  }), [history]);

  const lastRun = history?.bridgeRuns?.[0] ?? null;

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div>
        <span>PARAMÈTRE · SUPERVISION DES SOURCES</span>
        <h1>Sources & connexion</h1>
        <p>Traçabilité réelle des dépôts FTP, imports KPI CRVO et disponibilités en base. Aucun statut de démonstration n'est utilisé.</p>
      </div>
      <div className={styles.heroStatus}>
        <small>FTP</small>
        <strong className={system?.ftpBridge ? styles.goodText : styles.badText}>{system?.ftpBridge ? "CONNECTÉ" : "INDISPONIBLE"}</strong>
        <small>CADENCE DE CONTRÔLE</small>
        <strong>{history?.cadenceMinutes ?? 15} MIN · 24H/24</strong>
      </div>
    </section>

    {error && <div className={styles.error}><strong>Supervision indisponible.</strong> {error}</div>}
    {loading && !history && <div className={styles.loading}>Lecture des historiques réels…</div>}

    <section className={styles.kpis}>
      <article><span>DERNIER PASSAGE BRIDGE</span><strong>{dt(lastRun?.finishedAt ?? lastRun?.startedAt)}</strong><small>{lastRun?.status === "success" ? "Succès" : lastRun?.status ?? "—"}</small></article>
      <article><span>FICHIERS VUS</span><strong>{fmt(lastRun?.filesSeen)}</strong><small>Dernier scan FTP</small></article>
      <article><span>FICHIERS MODIFIÉS</span><strong>{fmt(lastRun?.filesImported)}</strong><small>0 = aucun nouveau contenu</small></article>
      <article><span>DERNIER DÉPÔT DÉTECTÉ</span><strong>{dt(system?.ftpRefresh?.lastDepositAt)}</strong><small>{system?.ftpRefresh?.lastDepositFilename ?? "FTP CRVO"}</small></article>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><span>FICHIERS SUPERVISÉS</span><h2>Dernier dépôt et délai d'intégration</h2></div>
        <p>Le « dépôt FTP » correspond à la date de dernière modification remontée par le serveur FTP.</p>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Fichier</th><th>Dernier dépôt FTP</th><th>Import KPI</th><th>Disponible KPI</th><th>Délai moyen</th><th>Délai max</th><th>Imports / 7 j</th></tr></thead>
          <tbody>{files.map(file => <tr key={file.filename}>
            <td><strong>{file.filename}</strong></td>
            <td>{dt(file.lastDepositAt, true)}</td>
            <td>{dt(file.lastImportAt, true)}</td>
            <td>{dt(file.lastReadyAt, true)}</td>
            <td><span className={`${styles.delay} ${delayClass(file.avgDelayMinutes)}`}>{file.avgDelayMinutes == null ? "—" : `${fmt(file.avgDelayMinutes, 1)} min`}</span></td>
            <td><span className={`${styles.delay} ${delayClass(file.maxDelayMinutes)}`}>{file.maxDelayMinutes == null ? "—" : `${fmt(file.maxDelayMinutes, 1)} min`}</span></td>
            <td>{fmt(file.imports)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><span>HISTORIQUE DES DÉPÔTS</span><h2>Dépôt FTP → import KPI CRVO</h2></div>
        <div className={styles.periods}>
          <button className={period === 24 ? styles.active : ""} onClick={() => setPeriod(24)}>24 H</button>
          <button className={period === 168 ? styles.active : ""} onClick={() => setPeriod(168)}>7 JOURS</button>
          <button onClick={() => void refresh()}>ACTUALISER</button>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Dépôt FTP</th><th>Fichier</th><th>Import KPI</th><th>Disponible KPI</th><th>Délai</th><th>Lignes</th><th>Statut</th></tr></thead>
          <tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.filename}-${row.importedAt}-${index}`}>
            <td><strong>{dt(row.depositAt, true)}</strong></td>
            <td>{row.filename}</td>
            <td>{dt(row.importedAt, true)}</td>
            <td>{dt(row.readyAt, true)}</td>
            <td><span className={`${styles.delay} ${delayClass(row.delayMinutes)}`}>{row.delayMinutes == null ? "—" : `${fmt(row.delayMinutes, 1)} min`}</span></td>
            <td>{fmt(row.rows)}</td>
            <td><span className={styles.status}>{row.status ?? "—"}</span></td>
          </tr>) : <tr><td colSpan={7} className={styles.empty}>Aucun dépôt FTP enregistré sur cette période.</td></tr>}</tbody>
        </table>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><span>PASSAGES DU BRIDGE</span><h2>Contrôle de récupération</h2></div><p>Un passage avec 0 fichier importé est normal si les 12 fichiers vus sont inchangés.</p></div>
      <div className={styles.runs}>{(history?.bridgeRuns ?? []).slice(0, 12).map((run, index) => <article key={`${run.startedAt}-${index}`}>
        <div><span>{dt(run.startedAt, true)}</span><strong>{run.status === "success" ? "SUCCÈS" : (run.status ?? "—").toUpperCase()}</strong></div>
        <small>{fmt(run.filesSeen)} vus · {fmt(run.filesImported)} modifiés · {run.protocol?.toUpperCase() ?? "FTP"}</small>
      </article>)}</div>
    </section>

    <section className={styles.note}>
      <strong>Règle de confiance :</strong> si un fichier attendu cesse d'être déposé ou si le bridge ne passe plus, l'anomalie doit être visible ici avant d'impacter le pilotage. Les données manquantes ne sont jamais remplacées par une valeur fictive.
    </section>
  </main>;
}
