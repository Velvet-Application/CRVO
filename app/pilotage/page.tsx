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
  alert: string | null;
  urgency: string | null;
  factory_age_days: number | null;
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
  timeReady: boolean;
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
  ftpVehicleSnapshot: string | null;
  ftpVehicleLoadedAt: string | null;
  productionMode: "ftp" | "book";
  sources: { ftp?: boolean; sftp?: boolean; production: "ftp" | "book"; workloadFtp: boolean; workloadSql: boolean; workloadTime: boolean; alertsFtp: boolean; invoicesSql: boolean; financeBook: boolean };
  invoiceToday: { revenue: number; invoices: number; available: boolean; source: "none" | "sql" | "book" };
  workloadSummary: { workOrders: number; remainingHours: number; potentialRevenue: number };
  major: Plan[];
  plans: Plan[];
};

type FtpRefresh = { lastRefreshAt: string | null; lastDepositAt: string | null; lastDepositFilename: string | null };
type LeadTimePayload = {
  available: boolean;
  sourceModifiedAt: string | null;
  vehicleCount: number;
  avgFactoryDays: number | null;
  medianFactoryDays: number | null;
  avgStorageDays: number | null;
  avgPartsDays: number | null;
  vopEffCount: number;
  vopExtCount: number;
  historyReady: boolean;
  latestHistoryEventDate: string | null;
  latestHistoryEventTime: string | null;
};

function euro(value: number | null | undefined) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value) || 0); }
function minutes(value: number | null) { if (value == null) return "Temps SQL à venir"; if (value < 60) return `${Math.round(value)} min`; const hours = Math.floor(value / 60); const mins = Math.round(value % 60); return `${hours} h${mins ? ` ${mins}` : ""}`; }
function shortDate(value: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function timeParis(value: string | null | undefined) { if (!value) return "—"; return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Paris" }).format(new Date(value)); }
function days(value: number | null | undefined) { return value == null ? "—" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j`; }

function VehicleQueue({ vehicles, mode, timeReady = true }: { vehicles: Vehicle[]; mode: "FIFO" | "RUN"; timeReady?: boolean }) {
  if (!vehicles.length) return <div className={styles.dataNeeded}><strong>{mode === "RUN" && !timeReady ? "RUN en attente du temps SQL" : `Aucun véhicule ${mode} disponible`}</strong><span>{mode === "FIFO" ? "La file sera affichée dès que des dossiers sont présents sur ce secteur." : !timeReady ? "La photo FTP donne déjà le FIFO et les passages restants. Le RUN sera calculé dès que le temps restant par OR sera branché." : "Aucun dossier ne respecte actuellement le seuil de temps RUN configuré."}</span></div>;
  return <div className={styles.oldList}>{vehicles.map((vehicle, index) => <div key={`${mode}-${vehicle.registration}-${vehicle.work_order}`}>
    <b>{index + 1}</b>
    <div><strong>{vehicle.registration || vehicle.work_order || "—"}{/^oui$/i.test(vehicle.urgency || "") ? " · URGENT" : ""}</strong><span>{vehicle.alert ? `À faire · ${vehicle.alert}` : vehicle.primary_activity || vehicle.status || vehicle.work_order || "Dossier"}</span></div>
    <div><strong>{mode === "FIFO" ? `${vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j` : minutes(vehicle.remaining_minutes)}</strong><span>{mode === "FIFO" ? (vehicle.remaining_minutes != null ? `${minutes(vehicle.remaining_minutes)}${vehicle.potential_revenue_total ? ` · ${euro(vehicle.potential_revenue_total)}` : ""}` : vehicle.factory_age_days != null ? `Depuis réception ${vehicle.factory_age_days.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j` : "État parc FTP") : `${vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j${vehicle.potential_revenue_total ? ` · ${euro(vehicle.potential_revenue_total)}` : ""}`}</span></div>
  </div>)}</div>;
}

export default function PilotagePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");
  const [ftpRefresh, setFtpRefresh] = useState<FtpRefresh | null>(null);
  const [leadTime, setLeadTime] = useState<LeadTimePayload | null>(null);

  async function refresh() {
    try {
      const [response, statusResponse, leadTimeResponse] = await Promise.all([
        fetch(`/api/pilotage?_=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } }),
        fetch(`/api/system-status?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/lead-time?_=${Date.now()}`, { cache: "no-store" }),
      ]);
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Pilotage indisponible.");
      if (statusResponse.ok) { const status = await statusResponse.json() as { ftpRefresh?: FtpRefresh | null }; setFtpRefresh(status.ftpRefresh ?? null); }
      if (leadTimeResponse.ok) setLeadTime(await leadTimeResponse.json() as LeadTimePayload);
      setData(payload);
      setSelected((current) => payload.plans.some((item) => item.sectorKey === current) ? current : payload.major[0]?.sectorKey || payload.plans.find((item) => item.fifoCandidates?.length || item.runCandidates?.length)?.sectorKey || payload.plans[0]?.sectorKey || "");
      setUpdated(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible d’actualiser le pilotage."); }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const current = useMemo(() => data?.plans.find((item) => item.sectorKey === selected) ?? data?.major[0] ?? null, [data, selected]);
  if (!data) return <main className={styles.loading}><div/><strong>Préparation du cockpit de pilotage…</strong>{error && <span>{error}</span>}</main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><a href="/" className={styles.back}>← REPORTING CRVO</a><span className={styles.eyebrow}>COCKPIT DE DÉCISION · CRVO LENS</span><h1>PILOTAGE DU JOUR</h1><p>Transformer les objectifs en liste d’actions terrain : FIFO, alertes dossiers, RUN, charge disponible et sécurisation du chiffre.</p></div>
      <div className={styles.headerStatus}><span>DERNIÈRE PRODUCTION</span><strong>{data.snapshot.label}</strong><small>{data.productionMode === "ftp" ? "FTP" : "Dernier Book CRVO"} · écran actualisé {updated}</small>{ftpRefresh?.lastRefreshAt && <small><b>FTP refresh {timeParis(ftpRefresh.lastRefreshAt)}</b> · dernier dépôt {timeParis(ftpRefresh.lastDepositAt)}{ftpRefresh.lastDepositFilename ? ` · ${ftpRefresh.lastDepositFilename}` : ""}</small>}{data.sources.workloadFtp && <small><b>EtatduParc actif</b> · photo {shortDate(data.ftpVehicleSnapshot)} · alertes dossiers chargées</small>}{leadTime?.available && <small><b>LeadTimeFactoryBI actif</b> · LT usine moyen {days(leadTime.avgFactoryDays)} · médiane {days(leadTime.medianFactoryDays)}{leadTime.historyReady ? " · historique statuts actif" : ""}</small>}</div>
    </header>

    <section className={styles.sourceStrip}>
      <div className={styles.ready}><i/><span>Production du jour</span><strong>{data.productionMode === "ftp" ? "FTP" : "BOOK"}</strong></div>
      <div className={data.sources.workloadFtp || data.sources.workloadSql ? styles.ready : styles.missing}><i/><span>Détail dossiers / alertes</span><strong>{data.sources.workloadFtp ? `FTP · ${shortDate(data.ftpVehicleSnapshot).toUpperCase()}` : data.sources.workloadSql ? `SQL · ${shortDate(data.workloadSnapshot).toUpperCase()}` : "À BRANCHER"}</strong></div>
      <div className={data.sources.workloadTime ? styles.ready : styles.missing}><i/><span>Temps MO / véhicule</span><strong>{data.sources.workloadTime ? "SQL PRÊT" : "SQL À FOURNIR"}</strong></div>
      <div className={data.sources.invoicesSql || data.sources.financeBook ? styles.ready : styles.missing}><i/><span>Chiffre d’affaires</span><strong>{data.sources.invoicesSql ? "SQL FACTURES" : data.sources.financeBook ? "BOOK" : "À BRANCHER"}</strong></div>
    </section>

    <section className={styles.topGrid}>
      <article className={styles.commandCard}><span>SUJETS MAJEURS À TRAITER</span><h2>Ce qui met le chiffre du jour en risque</h2><div className={styles.majorList}>{data.major.map((item, index) => <button key={item.sectorKey} onClick={() => setSelected(item.sectorKey)} className={selected === item.sectorKey ? styles.activeMajor : ""}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.label}</strong><span>{item.gap} véhicule{item.gap > 1 ? "s" : ""} à passer · {item.queue} dossier{item.queue > 1 ? "s" : ""} dans la file{item.timeReady ? ` · ${Math.round(item.remainingHours).toLocaleString("fr-FR")} h` : ""}</span></div><div className={styles.majorScore}><strong>{item.actual}</strong><span>/ {item.target}</span><small>{item.attainment}%</small></div></button>)}{!data.major.length && <div className={styles.allGood}><strong>Objectifs sécurisés</strong><span>Aucun secteur suivi n’est actuellement sous son objectif.</span></div>}</div></article>

      <article className={styles.dayCard}><span>SYNTHÈSE DU JOUR</span><div><small>Sorties usine</small><strong>{data.snapshot.exits}</strong></div><div><small>Stock usine</small><strong>{data.snapshot.stock.toLocaleString("fr-FR")}</strong></div><div><small>Lead Time usine moy.</small><strong>{leadTime?.available ? days(leadTime.avgFactoryDays) : "—"}</strong></div><div><small>Lead Time médian</small><strong>{leadTime?.available ? days(leadTime.medianFactoryDays) : "—"}</strong></div><div><small>CA facturé</small><strong>{data.invoiceToday.available ? euro(data.invoiceToday.revenue) : "—"}</strong></div><div><small>Factures / avoirs</small><strong>{data.invoiceToday.available && data.invoiceToday.invoices ? data.invoiceToday.invoices : "—"}</strong></div><div><small>CA potentiel encours</small><strong>{data.sources.workloadSql ? euro(data.workloadSummary.potentialRevenue) : "—"}</strong></div><div><small>Heures MO encours</small><strong>{data.sources.workloadTime ? Math.round(data.workloadSummary.remainingHours).toLocaleString("fr-FR") : "—"}</strong></div><div><small>OR / dossiers en cours</small><strong>{data.sources.workloadFtp || data.sources.workloadSql ? data.workloadSummary.workOrders.toLocaleString("fr-FR") : "—"}</strong></div>{!data.invoiceToday.available && <p>Le CA instantané apparaîtra ici dès que le branchement SQL factures sera disponible.</p>}</article>
    </section>

    {current && <>
      <section className={styles.sectorHead}><div><span>PLAN D’ACTION · {current.label.toUpperCase()}</span><h2>{current.gap > 0 ? `${current.gap} véhicules à sécuriser` : "Objectif atteint"}</h2><p>{current.queue ? `${current.queue} dossiers identifiés. Le FIFO utilise l’ancienneté EtatduParc et affiche clairement l’alerte « à faire » quand elle existe.` : "La file véhicule n’est pas encore alimentée."}</p></div><div className={styles.sectorMetrics}><div><span>RÉALISÉ</span><strong>{current.actual}</strong></div><div><span>OBJECTIF</span><strong>{current.target}</strong></div><div><span>RESTE</span><strong>{current.gap}</strong></div><div><span>RUN</span><strong>{current.timeReady ? current.runPool : "—"}</strong></div><div><span>HEURES ENCOURS</span><strong>{current.timeReady ? Math.round(current.remainingHours).toLocaleString("fr-FR") : "—"}</strong></div><div><span>CA POTENTIEL</span><strong>{data.sources.workloadSql ? euro(current.potentialRevenue) : "—"}</strong></div></div></section>

      <section className={styles.logicGrid}>
        <article className={styles.logicCard}><span>FIFO · LISTE VÉHICULES</span><h3>Les 10 plus vieux dossiers</h3><VehicleQueue vehicles={current.fifoCandidates?.length ? current.fifoCandidates : current.oldest} mode="FIFO"/></article>
        <article className={styles.logicCard}><span>RUN · LISTE VÉHICULES</span><h3>Dossiers courts disponibles</h3><VehicleQueue vehicles={current.runCandidates ?? []} mode="RUN" timeReady={current.timeReady}/><div className={styles.strategyBox}><div><strong>{Math.round(current.fifoShare * 100)}%</strong><span>FIFO cible</span></div><div><strong>≤ {Math.round(current.runMaxMinutes)} min</strong><span>définition RUN</span></div><div><strong>{current.highTimeOld}</strong><span>dossiers lourds dans le top 10</span></div></div></article>
      </section>

      <section className={styles.actionPlan}><div className={styles.actionTitle}><div><span>LISTE À FAIRE MAINTENANT</span><h2>Ordonnancement recommandé</h2></div><p>EtatduParc apporte le véhicule, son ancienneté et les passages encore attendus. LeadTimeFactoryBI apporte désormais la mesure opérationnelle du Lead Time. Le temps SQL complète la logique RUN ; le SQL CA viendra ensuite ajouter la valeur économique du dossier.</p></div>{current.recommendation.length ? <div className={styles.actionTable}><div className={styles.actionHeader}><span>#</span><span>Véhicule</span><span>OR / à faire</span><span>Ancienneté</span><span>Temps MO</span><span>CA potentiel</span><span>Choix</span><span>Pourquoi</span></div>{current.recommendation.map((vehicle) => <div key={`${vehicle.registration}-${vehicle.work_order}`} className={vehicle.strategy === "RUN" ? styles.runRow : styles.fifoRow}><b>{vehicle.rank}</b><strong>{vehicle.registration || "—"}</strong><span>{vehicle.work_order || "—"}<small>{vehicle.alert ? ` · À faire : ${vehicle.alert}` : vehicle.primary_activity ? ` · ${vehicle.primary_activity}` : ""}</small></span><span>{vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j</span><span>{minutes(vehicle.remaining_minutes)}</span><strong>{vehicle.potential_revenue_total ? euro(vehicle.potential_revenue_total) : "—"}</strong><span className={vehicle.strategy === "RUN" ? styles.runPill : styles.fifoPill}>{vehicle.strategy}</span><span>{vehicle.reason}</span></div>)}</div> : <div className={styles.emptyPlan}><strong>{current.gap === 0 ? "Objectif atteint sur ce secteur" : "Ordonnancement en cours de calcul"}</strong><span>{current.gap === 0 ? "Les listes FIFO et RUN restent visibles ci-dessus même quand aucun véhicule supplémentaire n’est nécessaire." : "La liste FIFO est déjà exploitable avec EtatduParc. Le RUN se précise avec les temps SQL."}</span></div>}</section>
    </>}

    {error && <div className={styles.error}>{error}</div>}
  </main>;
}
