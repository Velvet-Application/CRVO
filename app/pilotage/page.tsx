"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./pilotage.module.css";

type Vehicle = {
  registration: string;
  work_order: string | null;
  client: string | null;
  vin: string | null;
  status: string | null;
  primary_activity: string | null;
  age_days: number | null;
  remaining_minutes: number | null;
  estimated_total_minutes: number | null;
  potential_revenue_total: number | null;
  strategy?: "FIFO" | "RUN";
  reason?: string;
  rank?: number;
};

type Plan = {
  sectorKey: string;
  label: string;
  actual: number;
  target: number;
  gap: number;
  attainment: number;
  queue: number;
  workloadReady: boolean;
  runMaxMinutes: number;
  fifoShare: number;
  highTimeOld: number;
  runPool: number;
  remainingHours: number;
  potentialRevenue: number;
  oldest: Vehicle[];
  fifoCandidates: Vehicle[];
  runCandidates: Vehicle[];
  recommendation: Vehicle[];
};

type Payload = {
  snapshot: { date: string; label: string; source: string; exits: number; stock: number };
  dataConnected: boolean;
  workloadSnapshot: string | null;
  productionMode: "ftp" | "book";
  sources: { ftp?: boolean; sftp?: boolean; production: "ftp" | "book"; workloadSql: boolean; workloadTime: boolean; invoicesSql: boolean; financeBook: boolean };
  invoiceToday: { revenue: number; invoices: number; available: boolean; source: "none" | "sql" | "book" };
  workloadSummary: { workOrders: number; remainingHours: number; potentialRevenue: number };
  major: Plan[];
  plans: Plan[];
};

type FtpRefresh = { lastRefreshAt: string | null; lastDepositAt: string | null; lastDepositFilename: string | null };

function euro(value: number | null | undefined) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function minutes(value: number | null) {
  if (value == null) return "Temps non reçu";
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const mins = Math.round(value % 60);
  return `${hours} h${mins ? ` ${mins}` : ""}`;
}

function shortDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function timeParis(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value));
}

function VehicleQueue({ vehicles, mode }: { vehicles: Vehicle[]; mode: "FIFO" | "RUN" }) {
  if (!vehicles.length) return <div className={styles.dataNeeded}><strong>Aucun véhicule {mode} disponible</strong><span>{mode === "FIFO" ? "La file sera affichée dès que des dossiers sont présents sur ce secteur." : "Aucun dossier ne respecte actuellement le seuil de temps RUN configuré."}</span></div>;
  return <div className={styles.oldList}>{vehicles.map((vehicle, index) => <div key={`${mode}-${vehicle.registration}-${vehicle.work_order}`}>
    <b>{index + 1}</b>
    <div><strong>{vehicle.registration || vehicle.work_order || "—"}</strong><span>{vehicle.primary_activity || vehicle.status || vehicle.work_order || "Dossier"}</span></div>
    <div><strong>{mode === "FIFO" ? `${vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j` : minutes(vehicle.remaining_minutes)}</strong><span>{mode === "FIFO" ? `${minutes(vehicle.remaining_minutes)} · ${euro(vehicle.potential_revenue_total)}` : `${vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j · ${euro(vehicle.potential_revenue_total)}`}</span></div>
  </div>)}</div>;
}

export default function PilotagePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [ftpRefresh, setFtpRefresh] = useState<FtpRefresh | null>(null);

  async function refresh() {
    try {
      const [response, statusResponse] = await Promise.all([
        fetch(`/api/pilotage?_=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } }),
        fetch(`/api/system-status?_=${Date.now()}`, { cache: "no-store" }),
      ]);
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Pilotage indisponible.");
      if (statusResponse.ok) {
        const status = await statusResponse.json() as { ftpRefresh?: FtpRefresh | null };
        setFtpRefresh(status.ftpRefresh ?? null);
      }
      setData(payload);
      setSelected((current) => payload.plans.some((item) => item.sectorKey === current) ? current : payload.major[0]?.sectorKey || payload.plans.find((item) => item.fifoCandidates?.length || item.runCandidates?.length)?.sectorKey || payload.plans[0]?.sectorKey || "");
      setUpdated(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’actualiser le pilotage.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const current = useMemo(() => data?.plans.find((item) => item.sectorKey === selected) ?? data?.major[0] ?? null, [data, selected]);

  if (!data) return <main className={styles.loading}><div/><strong>Préparation du cockpit de pilotage…</strong>{error && <span>{error}</span>}</main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <a href="/" className={styles.back}>← REPORTING CRVO</a>
        <span className={styles.eyebrow}>COCKPIT DE DÉCISION · CRVO LENS</span>
        <h1>PILOTAGE DU JOUR</h1>
        <p>Transformer les objectifs en liste d’actions terrain : FIFO, dossiers lourds, RUN, charge disponible et sécurisation du chiffre.</p>
      </div>
      <div className={styles.headerStatus}>
        <span>DERNIÈRE PRODUCTION</span>
        <strong>{data.snapshot.label}</strong>
        <small>{data.productionMode === "ftp" ? "FTP" : "Dernier Book CRVO"} · écran actualisé {updated}</small>
        {ftpRefresh?.lastRefreshAt && <small><b>FTP refresh {timeParis(ftpRefresh.lastRefreshAt)}</b> · dernier dépôt {timeParis(ftpRefresh.lastDepositAt)}{ftpRefresh.lastDepositFilename ? ` · ${ftpRefresh.lastDepositFilename}` : ""}</small>}
      </div>
    </header>

    <section className={styles.sourceStrip}>
      <div className={styles.ready}><i/><span>Production du jour</span><strong>{data.productionMode === "ftp" ? "FTP" : "BOOK"}</strong></div>
      <div className={data.sources.workloadSql ? styles.ready : styles.missing}><i/><span>Détail dossiers</span><strong>{data.sources.workloadSql ? shortDate(data.workloadSnapshot).toUpperCase() : "À BRANCHER"}</strong></div>
      <div className={data.sources.workloadTime ? styles.ready : styles.missing}><i/><span>Temps MO / véhicule</span><strong>{data.sources.workloadTime ? "PRÊT" : "À FOURNIR"}</strong></div>
      <div className={data.sources.invoicesSql || data.sources.financeBook ? styles.ready : styles.missing}><i/><span>Chiffre d’affaires</span><strong>{data.sources.invoicesSql ? "SQL FACTURES" : data.sources.financeBook ? "BOOK" : "À BRANCHER"}</strong></div>
    </section>

    <section className={styles.topGrid}>
      <article className={styles.commandCard}>
        <span>SUJETS MAJEURS À TRAITER</span>
        <h2>Ce qui met le chiffre du jour en risque</h2>
        <div className={styles.majorList}>
          {data.major.map((item, index) => <button key={item.sectorKey} onClick={() => setSelected(item.sectorKey)} className={selected === item.sectorKey ? styles.activeMajor : ""}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <div><strong>{item.label}</strong><span>{item.gap} véhicule{item.gap > 1 ? "s" : ""} à passer · {Math.round(item.remainingHours).toLocaleString("fr-FR")} h en encours · {euro(item.potentialRevenue)} potentiel</span></div>
            <div className={styles.majorScore}><strong>{item.actual}</strong><span>/ {item.target}</span><small>{item.attainment}%</small></div>
          </button>)}
          {!data.major.length && <div className={styles.allGood}><strong>Objectifs sécurisés</strong><span>Aucun secteur suivi n’est actuellement sous son objectif.</span></div>}
        </div>
      </article>

      <article className={styles.dayCard}>
        <span>SYNTHÈSE DU JOUR</span>
        <div><small>Sorties usine</small><strong>{data.snapshot.exits}</strong></div>
        <div><small>Stock usine</small><strong>{data.snapshot.stock.toLocaleString("fr-FR")}</strong></div>
        <div><small>CA facturé</small><strong>{data.invoiceToday.available ? euro(data.invoiceToday.revenue) : "—"}</strong></div>
        <div><small>Factures / avoirs</small><strong>{data.invoiceToday.available && data.invoiceToday.invoices ? data.invoiceToday.invoices : "—"}</strong></div>
        <div><small>CA potentiel encours</small><strong>{data.sources.workloadSql ? euro(data.workloadSummary.potentialRevenue) : "—"}</strong></div>
        <div><small>Heures MO encours</small><strong>{data.sources.workloadTime ? Math.round(data.workloadSummary.remainingHours).toLocaleString("fr-FR") : "—"}</strong></div>
        <div><small>OR en cours</small><strong>{data.sources.workloadSql ? data.workloadSummary.workOrders.toLocaleString("fr-FR") : "—"}</strong></div>
        {!data.invoiceToday.available && <p>Le CA instantané apparaîtra ici dès que le branchement SQL factures sera disponible.</p>}
      </article>
    </section>

    {current && <>
      <section className={styles.sectorHead}>
        <div>
          <span>PLAN D’ACTION · {current.label.toUpperCase()}</span>
          <h2>{current.gap > 0 ? `${current.gap} véhicules à sécuriser` : "Objectif atteint"}</h2>
          <p>{current.queue ? `${current.queue} dossiers/activités disponibles dans l’encours du ${shortDate(data.workloadSnapshot)}.` : "La file véhicule n’est pas encore alimentée."}</p>
        </div>
        <div className={styles.sectorMetrics}>
          <div><span>RÉALISÉ</span><strong>{current.actual}</strong></div>
          <div><span>OBJECTIF</span><strong>{current.target}</strong></div>
          <div><span>RESTE</span><strong>{current.gap}</strong></div>
          <div><span>RUN</span><strong>{current.workloadReady ? current.runPool : "—"}</strong></div>
          <div><span>HEURES ENCOURS</span><strong>{Math.round(current.remainingHours).toLocaleString("fr-FR")}</strong></div>
          <div><span>CA POTENTIEL</span><strong>{euro(current.potentialRevenue)}</strong></div>
        </div>
      </section>

      <section className={styles.logicGrid}>
        <article className={styles.logicCard}>
          <span>FIFO · LISTE VÉHICULES</span>
          <h3>Les 10 plus vieux dossiers</h3>
          <VehicleQueue vehicles={current.fifoCandidates?.length ? current.fifoCandidates : current.oldest} mode="FIFO"/>
        </article>

        <article className={styles.logicCard}>
          <span>RUN · LISTE VÉHICULES</span>
          <h3>Dossiers courts disponibles</h3>
          <VehicleQueue vehicles={current.runCandidates ?? []} mode="RUN"/>
          <div className={styles.strategyBox}>
            <div><strong>{Math.round(current.fifoShare * 100)}%</strong><span>FIFO cible</span></div>
            <div><strong>≤ {Math.round(current.runMaxMinutes)} min</strong><span>définition RUN</span></div>
            <div><strong>{current.highTimeOld}</strong><span>dossiers lourds dans le top 10</span></div>
          </div>
        </article>
      </section>

      <section className={styles.actionPlan}>
        <div className={styles.actionTitle}><div><span>LISTE À FAIRE MAINTENANT</span><h2>Ordonnancement recommandé</h2></div><p>FIFO et RUN sont croisés avec le temps disponible et, lorsque le SQL CA sera branché, avec le potentiel financier du dossier. La recommandation reste une aide au pilotage terrain.</p></div>
        {current.recommendation.length ? <div className={styles.actionTable}>
          <div className={styles.actionHeader}><span>#</span><span>Véhicule</span><span>OR / activité</span><span>Ancienneté</span><span>Temps MO</span><span>CA potentiel</span><span>Choix</span><span>Pourquoi</span></div>
          {current.recommendation.map((vehicle) => <div key={`${vehicle.registration}-${vehicle.work_order}`} className={vehicle.strategy === "RUN" ? styles.runRow : styles.fifoRow}>
            <b>{vehicle.rank}</b><strong>{vehicle.registration || "—"}</strong><span>{vehicle.work_order || "—"}<small>{vehicle.primary_activity ? ` · ${vehicle.primary_activity}` : ""}</small></span><span>{vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j</span><span>{minutes(vehicle.remaining_minutes)}</span><strong>{euro(vehicle.potential_revenue_total)}</strong><span className={vehicle.strategy === "RUN" ? styles.runPill : styles.fifoPill}>{vehicle.strategy}</span><span>{vehicle.reason}</span>
          </div>)}
        </div> : <div className={styles.emptyPlan}>
          <strong>{current.gap === 0 ? "Objectif atteint sur ce secteur" : "Ordonnancement en cours de calcul"}</strong>
          <span>{current.gap === 0 ? "Les listes FIFO et RUN restent visibles ci-dessus même quand aucun véhicule supplémentaire n’est nécessaire." : "Les listes FIFO et RUN sont affichées ci-dessus ; l’ordonnancement final utilise l’écart à l’objectif."}</span>
        </div>}
      </section>
    </>}

    {error && <div className={styles.error}>{error}</div>}
  </main>;
}
