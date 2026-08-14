"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./managerial-focus.module.css";

type Alert = { rank:number; key:string; level:"critique"|"tension"|"info"; title:string; detail:string };
type Priority = { registration:string|null;workOrder:string|null;client:string|null;ageDays:number;status:string|null;currentSector:string|null;pending:string[];alert:string|null;urgent:boolean;bmw:boolean;priorityReason:string };
type Managerial = {
  connected:boolean;
  generatedAt:string;
  sourceModifiedAt:string|null;
  summary:{activeVehicles:number;over10:number;over20:number;anomalyVehicles:number;missingEntryDate:number};
  managerialAlerts:Alert[];
  preparation:{current:number;pipeline:number;over10:number;over20:number;entries24h:number;outputs24h:number;net24h:number;deltaVsPrevious:number;outputReference:number;bufferCoveragePct:number};
  bodywork:{current:number;pending:number;actionable:number;over10:number;over20:number;averageAge:number;medianAge:number;entries24h:number;outputs24h:number;net24h:number;deltaVsPrevious:number;cadenceReference:number;productionTarget:number;topFifo:Array<{registration:string|null;workOrder:string|null;client:string|null;ageDays:number;status:string|null;alert:string|null;urgent:boolean;bmw:boolean}>};
  bmw:{targetLeadTimeDays:number;vehicles:number;averageAge:number;medianAge:number;age0_9:number;age10_15:number;age16_19:number;age20Plus:number;missingEntryDate:number;oldest:Array<{registration:string|null;workOrder:string|null;ageDays:number;status:string|null;pending:string[];alert:string|null;breach:boolean;nearBreach:boolean}>};
  priorities:Priority[];
  dataQuality:{missingEntryDate:number;message:string};
  liveMetrics:{stock:number;entries:number;exits:number;preparation:number;factoryExit:number};
};

type LiveIntelligence = { production?:{sectors?:Array<{key:string;current:number;target:number;projected:number;gapProjected:number;confidence:string}>} };

function fmtTime(value:string|null){
  if(!value)return "—";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "—";
  return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(date);
}

function signed(value:number){return `${value>0?"+":""}${value}`;}

export default function ManagerialFocus(){
  const [data,setData]=useState<Managerial|null>(null);
  const [live,setLive]=useState<LiveIntelligence|null>(null);
  const [error,setError]=useState("");

  async function load(){
    try{
      const stamp=Date.now();
      const [managerialResponse,liveResponse]=await Promise.all([
        fetch(`/api/cockpit-v2?_=${stamp}`,{cache:"no-store"}),
        fetch(`/api/intelligence?mode=live&_=${stamp}`,{cache:"no-store"}),
      ]);
      const managerial=await managerialResponse.json() as Managerial&{error?:string};
      if(!managerialResponse.ok||managerial.connected!==true)throw new Error(managerial.error||"Analyse managériale indisponible");
      setData(managerial);
      if(liveResponse.ok)setLive(await liveResponse.json() as LiveIntelligence);
      setError("");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Actualisation impossible");
    }
  }

  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>void load(),300000);
    const visible=()=>{if(document.visibilityState==="visible")void load();};
    document.addEventListener("visibilitychange",visible);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[]);

  const bodyProjection=useMemo(()=>live?.production?.sectors?.find((sector)=>sector.key==="carrosserie")??null,[live]);
  const exitProjection=useMemo(()=>live?.production?.sectors?.find((sector)=>sector.key==="sortie_usine")??null,[live]);
  const prepProjection=useMemo(()=>live?.production?.sectors?.find((sector)=>sector.key==="preparation")??null,[live]);
  const bodyAbsorptionDays=data&&bodyProjection&&bodyProjection.projected>0?data.bodywork.pending/bodyProjection.projected:null;

  if(!data&&!error)return <section className={styles.shell}><div className={styles.loading}>Construction des priorités managériales…</div></section>;
  if(!data)return <section className={styles.shell}><div className={styles.error}>{error}</div></section>;

  return <section className={styles.shell} aria-label="Priorités managériales CRVO COCKPIT V2">
    <div className={styles.topline}>
      <div><span>CRVO COCKPIT V2 · SYNTHÈSE MANAGÉRIALE</span><h2>Les décisions à prendre aujourd’hui</h2><p>Priorisation fondée sur le FIFO réception usine, avec surclassement Urgence et BMW France.</p></div>
      <div className={styles.updated}><span>RÉALISÉ À</span><strong>{fmtTime(data.sourceModifiedAt)}</strong><small>Analyse recalculée automatiquement</small></div>
    </div>

    {error&&<div className={styles.softError}>{error}</div>}

    <div className={styles.alertGrid}>
      {data.managerialAlerts.map((alert)=><article key={alert.key} className={`${styles.alertCard} ${styles[`alert_${alert.level}`]}`}>
        <b>{String(alert.rank).padStart(2,"0")}</b><div><span>{alert.level==="critique"?"PRIORITÉ FORTE":alert.level==="tension"?"À SURVEILLER":"INFORMATION"}</span><h3>{alert.title}</h3><p>{alert.detail}</p></div>
      </article>)}
      {!data.managerialAlerts.length&&<article className={styles.clearCard}><strong>Aucune dérive majeure détectée</strong><p>Les principaux signaux surveillés restent maîtrisés.</p></article>}
    </div>

    <div className={styles.mainGrid}>
      <article className={styles.prepCard}>
        <div className={styles.cardHeader}><div><span>SIGNAL DE SORTIE</span><h3>Préparation</h3></div><em className={data.preparation.bufferCoveragePct<35?styles.bad:data.preparation.bufferCoveragePct<65?styles.watch:styles.good}>{data.preparation.bufferCoveragePct}% du repère</em></div>
        <div className={styles.heroNumber}><strong>{data.preparation.current}</strong><span>véhicules actuellement en préparation</span></div>
        <div className={styles.statGrid}>
          <div><span>Pipeline vers prépa</span><b>{data.preparation.pipeline}</b></div>
          <div><span>&gt;10 jours</span><b>{data.preparation.over10}</b></div>
          <div><span>Flux 24 h</span><b>{signed(data.preparation.net24h)}</b></div>
          <div><span>Évolution photo</span><b>{signed(data.preparation.deltaVsPrevious)}</b></div>
        </div>
        <div className={styles.projectionLine}><span>Production prépa aujourd’hui</span><strong>{prepProjection?`${prepProjection.current} → ${prepProjection.projected}`:`${data.liveMetrics.preparation}`}</strong><small>{prepProjection?`objectif ${prepProjection.target} · projection ${prepProjection.confidence}`:"projection en apprentissage"}</small></div>
        <div className={styles.projectionLine}><span>Sorties usine</span><strong>{exitProjection?`${exitProjection.current} → ${exitProjection.projected}`:`${data.liveMetrics.factoryExit}`}</strong><small>{exitProjection?`objectif ${exitProjection.target}`:"suivi temps réel"}</small></div>
      </article>

      <article className={styles.bodyCard}>
        <div className={styles.cardHeader}><div><span>FOCUS STRATÉGIQUE</span><h3>Carrosserie</h3></div><em className={data.bodywork.over10>=50?styles.bad:styles.watch}>ENJEU MAJEUR</em></div>
        <div className={styles.bodyHero}><div><span>Encours métier</span><strong>{data.bodywork.current}</strong></div><div><span>À traiter</span><strong>{data.bodywork.pending}</strong></div><div><span>Actionnables</span><strong>{data.bodywork.actionable}</strong></div><div><span>&gt;10 j</span><strong>{data.bodywork.over10}</strong></div></div>
        <div className={styles.bodyProjection}>
          <div><span>Performance jour</span><strong>{bodyProjection?`${bodyProjection.current} → ${bodyProjection.projected}`:"—"}</strong><small>{bodyProjection?`objectif ${bodyProjection.target} · ${bodyProjection.confidence}`:"projection en apprentissage"}</small></div>
          <div><span>Capacité repère actuelle</span><strong>{data.bodywork.cadenceReference}/j</strong><small>sera remplacée par la capacité heures × présence × performance</small></div>
          <div><span>Flux net 24 h</span><strong>{signed(data.bodywork.net24h)}</strong><small>{data.bodywork.entries24h} entrées · {data.bodywork.outputs24h} sorties</small></div>
          <div><span>Résorption théorique</span><strong>{bodyAbsorptionDays?`${bodyAbsorptionDays.toFixed(1)} j`:"—"}</strong><small>au rythme de production projeté</small></div>
        </div>
        <div className={styles.fifoMini}><span>FIFO carrosserie prioritaire</span>{data.bodywork.topFifo.slice(0,4).map((vehicle)=><div key={`${vehicle.registration}-${vehicle.workOrder}`}><b>{vehicle.registration||vehicle.workOrder||"—"}</b><small>{vehicle.ageDays} j · {vehicle.bmw?"BMW France · ":vehicle.urgent?"Urgence · ":""}{vehicle.status||"Position non renseignée"}</small></div>)}</div>
      </article>
    </div>

    <div className={styles.secondaryGrid}>
      <article className={styles.bmwCard}>
        <div className={styles.cardHeader}><div><span>CLIENT PRIORITAIRE</span><h3>BMW France · objectif LT &lt;20 j</h3></div><strong>{data.bmw.vehicles} dossiers</strong></div>
        <div className={styles.bmwBands}><div><span>0–9 j</span><b>{data.bmw.age0_9}</b></div><div><span>10–15 j</span><b>{data.bmw.age10_15}</b></div><div className={styles.watchBand}><span>16–19 j</span><b>{data.bmw.age16_19}</b></div><div className={styles.badBand}><span>≥20 j</span><b>{data.bmw.age20Plus}</b></div></div>
        <p>Âge moyen {data.bmw.averageAge} j · médiane {data.bmw.medianAge} j. Les dossiers 16–19 j sont traités comme risque de franchissement du seuil client.</p>
      </article>

      <article className={styles.factoryCard}>
        <div className={styles.cardHeader}><div><span>SANTÉ DU PARC</span><h3>Vue usine</h3></div><strong>{data.summary.activeVehicles}</strong></div>
        <div className={styles.statGrid}><div><span>&gt;10 jours</span><b>{data.summary.over10}</b></div><div><span>≥20 jours</span><b>{data.summary.over20}</b></div><div><span>Parc anomalie</span><b>{data.summary.anomalyVehicles}</b></div><div><span>Date entrée manquante</span><b>{data.summary.missingEntryDate}</b></div></div>
        <p className={styles.dataNote}>Une date de réception usine absente est traitée comme anomalie de donnée. Le temps sans mouvement n’est pas utilisé comme signal de blocage métier.</p>
      </article>
    </div>

    <div className={styles.priorityStrip}>
      <div><span>FIFO PILOTÉ</span><strong>Urgence → BMW France → ancienneté réception usine</strong></div>
      <div className={styles.priorityVehicles}>{data.priorities.slice(0,5).map((vehicle)=><span key={`${vehicle.registration}-${vehicle.workOrder}`}><b>{vehicle.registration||vehicle.workOrder||"—"}</b><small>{vehicle.ageDays} j · {vehicle.priorityReason}</small></span>)}</div>
    </div>
  </section>;
}
