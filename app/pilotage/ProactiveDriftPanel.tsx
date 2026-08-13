"use client";

import { useEffect, useState } from "react";
import styles from "./pilotage.module.css";

type DriftRow = {
  registration: string | null;
  work_order: string | null;
  client: string | null;
  model: string | null;
  status: string | null;
  status_age_days: number | string | null;
  factory_age_days: number | string | null;
  alert: string | null;
  urgency: string | null;
  proactive_level: "CRITIQUE" | "SURVEILLANCE";
  abnormality_ratio: number | string | null;
  p75_days: number | string | null;
  p90_days: number | string | null;
};

type DriftPayload = {
  connected: boolean;
  critical: number;
  watch: number;
  rows: DriftRow[];
  methodology?: { scope?: string; critical?: string; watch?: string };
};

function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function days(value: unknown) { const result = number(value); return result == null ? "—" : `${result.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j`; }

export default function ProactiveDriftPanel() {
  const [data, setData] = useState<DriftPayload | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch(`/api/proactive-drift?_=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as DriftPayload;
        if (active) setData(payload);
      } catch {}
    }
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (!data?.connected) return null;
  const rows = data.rows.slice(0, 10);
  return <section className={styles.actionPlan}>
    <div className={styles.actionTitle}><div><span>DÉTECTION PROACTIVE · HISTORIQUE DES STATUTS</span><h2>{data.critical} dérives critiques · {data.watch} sous surveillance</h2></div><p>Cette liste cible les véhicules encore sous 15 jours usine mais qui restent anormalement longtemps sur leur statut par rapport aux transitions observées dans Analyse-Temps-Bruts.</p></div>
    {rows.length ? <div className={styles.actionTable}>
      <div className={styles.actionHeader}><span>#</span><span>Véhicule</span><span>Statut</span><span>Durée statut</span><span>Âge usine</span><span>Écart historique</span><span>Niveau</span><span>À faire</span></div>
      {rows.map((row,index)=><div key={`${row.registration}-${row.work_order}-${index}`} className={row.proactive_level === "CRITIQUE" ? styles.runRow : styles.fifoRow}><b>{index+1}</b><strong>{row.registration || row.work_order || "—"}{/^oui$/i.test(row.urgency || "") ? " · URGENT" : ""}</strong><span>{row.status || "—"}<small>{row.work_order ? ` · OR ${row.work_order}` : ""}</small></span><span>{days(row.status_age_days)}</span><span>{days(row.factory_age_days)}</span><strong>{number(row.abnormality_ratio)?.toLocaleString("fr-FR", { maximumFractionDigits:1 }) ?? "—"}× P75</strong><span className={row.proactive_level === "CRITIQUE" ? styles.runPill : styles.fifoPill}>{row.proactive_level}</span><span>{row.alert || "Vérifier l'absence de mouvement sur ce statut"}</span></div>)}
    </div> : <div className={styles.emptyPlan}><strong>Aucune dérive précoce détectée</strong><span>Les véhicules de moins de 15 jours usine restent dans les temps observés historiquement pour leur statut.</span></div>}
  </section>;
}
