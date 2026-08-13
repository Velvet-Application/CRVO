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
  recommendation: Vehicle[];
};

type Payload = {
  snapshot: { date: string; label: string; exits: number; stock: number };
  dataConnected: boolean;
  workloadSnapshot: string | null;
  sources: { sftp: boolean; workloadSql: boolean; workloadTime: boolean; invoicesSql: boolean };
  invoiceToday: { revenue: number; invoices: number };
  workloadSummary: { workOrders: number; remainingHours: number; potentialRevenue: number };
  major: Plan[];
  plans: Plan[];
};

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

export default function PilotagePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState("");

  async function refresh() {
    try {
      const response = await fetch(`/api/pilotage?_=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Pilotage indisponible.");
      setData(payload);
      setSelected((current) => current || payload.major[0]?.sectorKey || payload.plans[0]?.sectorKey || "");
      setUpdated(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossible d’actualiser le pilotage.");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(timer);
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
        <small>Actualisé {updated} · toutes les 30 s</small>
      </div>
    </header>

    <section className={styles.sourceStrip}>
      <div className={data.sources.sftp ? styles.ready : styles.missing}><i/><span>SFTP production</span><strong>{data.sources.sftp ? "PRÊT" : "ABSENT"}</strong></div>
      <div className={data.sources.workloadSql ? styles.ready : styles.missing}><i/><span>SQL encours dossier</span><strong>{data.sources.workloadSql ? "PRÊT" : "À BRANCHER"}</strong></div>
      <div className={data.sources.workloadTime ? styles.ready : styles.missing}><i/><span>Temps MO / véhicule</span><strong>{data.sources.workloadTime ? "PRÊT" : "À FOURNIR"}</strong></div>
      <div className={data.sources.invoicesSql ? styles.ready : styles.missing}><i/><span>SQL factures</span><strong>{data.sources.invoicesSql ? "PRÊT" : "À BRANCHER"}</strong></div>
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
          {!data.major.length && <div className={styles.allGood}><strong>Objectifs sécurisés</strong><span>Aucun secteur n’est actuellement sous son objectif.</span></div>}
        </div>
      </article>

      <article className={styles.dayCard}>
        <span>SYNTHÈSE DU JOUR</span>
        <div><small>Sorties usine</small><strong>{data.snapshot.exits}</strong></div>
        <div><small>Stock usine</small><strong>{data.snapshot.stock.toLocaleString("fr-FR")}</strong></div>
        <div><small>CA facturé</small><strong>{data.sources.invoicesSql ? euro(data.invoiceToday.revenue) : "—"}</strong></div>
        <div><small>Factures / avoirs</small><strong>{data.sources.invoicesSql ? data.invoiceToday.invoices : "—"}</strong></div>
        <div><small>CA potentiel encours</small><strong>{data.sources.workloadSql ? euro(data.workloadSummary.potentialRevenue) : "—"}</strong></div>
        <div><small>Heures MO encours</small><strong>{data.sources.workloadTime ? Math.round(data.workloadSummary.remainingHours).toLocaleString("fr-FR") : "—"}</strong></div>
        <div><small>OR en cours</small><strong>{data.sources.workloadSql ? data.workloadSummary.workOrders.toLocaleString("fr-FR") : "—"}</strong></div>
        {!data.sources.invoicesSql && <p>Le CA instantané apparaîtra ici dès que le reporting factures SQL sera importé ou branché.</p>}
      </article>
    </section>

    {current && <>
      <section className={styles.sectorHead}>
        <div>
          <span>PLAN D’ACTION · {current.label.toUpperCase()}</span>
          <h2>{current.gap > 0 ? `${current.gap} véhicules à sécuriser` : "Objectif atteint"}</h2>
          <p>{current.queue ? `${current.queue} dossiers disponibles dans l’encours du ${shortDate(data.workloadSnapshot)}.` : "La file véhicule n’est pas encore alimentée par le SQL encours."}</p>
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
          <span>LECTURE DU FIFO</span>
          <h3>Les 10 plus vieux dossiers</h3>
          {current.oldest.length ? <div className={styles.oldList}>{current.oldest.map((vehicle, index) => <div key={`${vehicle.registration}-${vehicle.work_order}`}>
            <b>{index + 1}</b><div><strong>{vehicle.registration || vehicle.work_order}</strong><span>{vehicle.primary_activity || vehicle.status || vehicle.work_order || "Dossier"}</span></div><div><strong>{vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j</strong><span>{minutes(vehicle.remaining_minutes)} · {euro(vehicle.potential_revenue_total)}</span></div>
          </div>)}</div> : <div className={styles.dataNeeded}><strong>Flux SQL encours requis</strong><span>Immatriculation, OR, activité, ancienneté, temps MO et potentiel CA.</span></div>}
        </article>

        <article className={styles.logicCard}>
          <span>ARBITRAGE VOLUME / FIFO</span>
          <h3>Lecture recommandée</h3>
          {current.workloadReady ? <div className={styles.strategyBox}>
            <div><strong>{Math.round(current.fifoShare * 100)}%</strong><span>FIFO cible</span></div>
            <div><strong>≤ {Math.round(current.runMaxMinutes)} min</strong><span>définition RUN</span></div>
            <div><strong>{current.highTimeOld}</strong><span>dossiers lourds dans le top 10</span></div>
            <p>{current.highTimeOld > 0 ? `${current.highTimeOld} dossiers parmi les plus anciens dépassent le seuil RUN. Le moteur complète le FIFO avec des dossiers courts pour sécuriser le volume sans perdre de vue les dossiers les plus anciens.` : "Le FIFO est compatible avec le volume cible : aucune injection RUN particulière n’est nécessaire."}</p>
          </div> : <div className={styles.dataNeeded}><strong>Temps MO par véhicule manquant</strong><span>Dès réception, le moteur distinguera automatiquement dossiers longs et RUN.</span></div>}
        </article>
      </section>

      <section className={styles.actionPlan}>
        <div className={styles.actionTitle}><div><span>LISTE À FAIRE MAINTENANT</span><h2>Ordonnancement recommandé</h2></div><p>FIFO et RUN sont croisés avec le temps MO et le potentiel CA du dossier. La recommandation reste une aide au pilotage terrain.</p></div>
        {current.recommendation.length ? <div className={styles.actionTable}>
          <div className={styles.actionHeader}><span>#</span><span>Véhicule</span><span>OR / activité</span><span>Ancienneté</span><span>Temps MO</span><span>CA potentiel</span><span>Choix</span><span>Pourquoi</span></div>
          {current.recommendation.map((vehicle) => <div key={`${vehicle.registration}-${vehicle.work_order}`} className={vehicle.strategy === "RUN" ? styles.runRow : styles.fifoRow}>
            <b>{vehicle.rank}</b><strong>{vehicle.registration || "—"}</strong><span>{vehicle.work_order || "—"}<small>{vehicle.primary_activity ? ` · ${vehicle.primary_activity}` : ""}</small></span><span>{vehicle.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "—"} j</span><span>{minutes(vehicle.remaining_minutes)}</span><strong>{euro(vehicle.potential_revenue_total)}</strong><span className={vehicle.strategy === "RUN" ? styles.runPill : styles.fifoPill}>{vehicle.strategy}</span><span>{vehicle.reason}</span>
          </div>)}
        </div> : <div className={styles.emptyPlan}>
          <strong>{current.gap === 0 ? "Objectif atteint sur ce secteur" : "Liste véhicule en attente de la donnée SQL"}</strong>
          <span>{current.gap === 0 ? "Le moteur ne propose aucun véhicule supplémentaire." : "La liste sera générée automatiquement dès que l’encours dossier sera importé dans Sources & connexion."}</span>
        </div>}
      </section>
    </>}

    {error && <div className={styles.error}>{error}</div>}
  </main>;
}
