"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./cockpit-v2.module.css";

type Section = "pilotage" | "synthese" | "decision" | "prevision";
type Risk = "critique" | "tension" | "maitrise";
type Weather = { level: string; title: string; detail: string };
type Sector = { key:string; label:string; current:number; pending:number; over20:number; daysOfDemand:number; urgent:number; risk:Risk };
type Production = { key:string; label:string; current:number; target:number; projected:number; gapProjected:number; attainmentProjected:number; confidence:string };
type Forecast = { key:string; label:string; current:number; pending:number; avgEntries:number; avgExits:number; avgNet:number; d1:number; d2:number; d3:number; riskD1:Risk };
type Action = { rank:number; sectorLabel:string; title:string; detail:string; vehicles:Array<{ registration:string|null; client:string|null; status:string|null; ageDays:number; score:number }> };
type CockpitData = {
  generatedAt:string;
  sourceModifiedAt:string|null;
  summary:{ stock:number; over15:number; over20:number; activeVehicles:number; walkingVehicles:number };
  weather:{ now:Weather; tonight:Weather; tomorrow?:Weather };
  sectors:Sector[];
  production:{ latestAt:string|null; snapshotCount:number; profileDays:number; sectors:Production[] };
  actions:Action[];
  forecast?:Forecast[];
  learning:{ projectionMode:string };
};

const sections:Array<{id:Section;label:string;short:string}> = [
  { id:"pilotage", label:"Pilotage du jour", short:"Jour" },
  { id:"synthese", label:"Synthèse managériale", short:"Synthèse" },
  { id:"decision", label:"Aide à la décision", short:"Décision" },
  { id:"prevision", label:"Prévision fin de journée", short:"Prévision" },
];

function fmt(value:number,digits=0){return Number(value||0).toLocaleString("fr-FR",{maximumFractionDigits:digits});}
function time(value:string|null){if(!value)return"—";const date=new Date(value);return Number.isNaN(date.getTime())?"—":new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(date);}
function riskLabel(risk:Risk){return risk==="critique"?"CRITIQUE":risk==="tension"?"À SURVEILLER":"MAÎTRISÉ";}

export default function CockpitV2Page(){
  const [section,setSection]=useState<Section>("pilotage");
  const [data,setData]=useState<CockpitData|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const raw=new URLSearchParams(window.location.search).get("section") as Section|null;
    if(raw&&sections.some(item=>item.id===raw))setSection(raw);
  },[]);

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try{
        const response=await fetch(`/api/intelligence?mode=deep&_=${Date.now()}`,{cache:"no-store"});
        const payload=await response.json() as CockpitData&{error?:string};
        if(!response.ok)throw new Error(payload.error||"Cockpit indisponible");
        if(!cancelled){setData(payload);setError("");}
      }catch(err){if(!cancelled)setError(err instanceof Error?err.message:"Actualisation impossible");}
      finally{if(!cancelled)setLoading(false);}
    }
    void load();
    const timer=window.setInterval(()=>void load(),60000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[]);

  function open(next:Section){
    setSection(next);
    const url=new URL(window.location.href);url.searchParams.set("section",next);window.history.replaceState({},"",url);
    window.scrollTo({top:0,behavior:"smooth"});
  }

  const critical=useMemo(()=>data?.sectors.filter(item=>item.risk==="critique")??[],[data]);
  const watch=useMemo(()=>data?.sectors.filter(item=>item.risk==="tension")??[],[data]);
  const underTarget=useMemo(()=>data?.production.sectors.filter(item=>item.projected<item.target)??[],[data]);

  if(loading&&!data)return <main className={styles.loading}><div/><strong>CRVO COCKPIT V2</strong><span>Consolidation des données opérationnelles…</span></main>;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href="/" className={styles.back}>← PERFORMANCE & BOOK</a><span>CRVO LENS · COCKPIT DE DIRECTION</span><h1>CRVO COCKPIT V2</h1><p>Piloter le jour, comprendre les tensions, décider vite et anticiper la clôture.</p></div>
      <aside><span>DERNIÈRE DONNÉE</span><strong>{time(data?.sourceModifiedAt??null)}</strong><small>Actualisation automatique · 1 min</small></aside>
    </header>

    <nav className={styles.tabs}>{sections.map(item=><button key={item.id} className={section===item.id?styles.active:""} onClick={()=>open(item.id)}><span>{item.short}</span><strong>{item.label}</strong></button>)}</nav>
    {error&&<div className={styles.warning}>{error}</div>}

    {data&&section==="pilotage"&&<>
      <section className={styles.kpis}>
        <article><span>STOCK USINE</span><strong>{fmt(data.summary.stock)}</strong><small>{fmt(data.summary.over20)} véhicules &gt;20 j</small></article>
        <article><span>SORTIES PROJETÉES</span><strong>{fmt(data.production.sectors.find(item=>item.key==="sortie_usine")?.projected??0)}</strong><small>objectif {fmt(data.production.sectors.find(item=>item.key==="sortie_usine")?.target??0)}</small></article>
        <article className={critical.length?styles.alertCard:""}><span>SECTEURS CRITIQUES</span><strong>{critical.length}</strong><small>{watch.length} à surveiller</small></article>
        <article><span>WALKING DEAD</span><strong>{fmt(data.summary.walkingVehicles)}</strong><small>véhicules au-delà de 15 j</small></article>
      </section>
      <section className={styles.panel}><div className={styles.panelTitle}><div><span>PILOTAGE DU JOUR</span><h2>Réalisé, cible et trajectoire</h2></div><p>{data.learning.projectionMode}</p></div><div className={styles.productionGrid}>{data.production.sectors.map(item=>{const ratio=Math.min(100,Math.round(item.current/Math.max(item.target,1)*100));return <article key={item.key}><header><span>{item.label}</span><em className={item.projected>=item.target?styles.good:styles.bad}>{item.projected>=item.target?"SUR TRAJECTOIRE":"À SÉCURISER"}</em></header><div className={styles.bigPair}><strong>{fmt(item.current)}</strong><small>/ {fmt(item.target)}</small></div><div className={styles.bar}><i style={{width:`${ratio}%`}}/></div><footer><span>Prévision fin de journée</span><b>{fmt(item.projected)}</b></footer></article>})}</div></section>
    </>}

    {data&&section==="synthese"&&<>
      <section className={styles.weather}>
        {[['MAINTENANT',data.weather.now],['CE SOIR',data.weather.tonight],['DEMAIN',data.weather.tomorrow]].map(([label,item])=>item?<article key={String(label)} className={styles[`weather_${(item as Weather).level}`]??""}><span>{String(label)}</span><strong>{(item as Weather).title}</strong><p>{(item as Weather).detail}</p></article>:null)}
      </section>
      <section className={styles.managerGrid}>
        <article className={styles.panel}><div className={styles.panelTitle}><div><span>SYNTHÈSE MANAGÉRIALE</span><h2>Ce qui mérite ton attention</h2></div></div><div className={styles.signalList}>{[...critical,...watch].slice(0,7).map(item=><div key={item.key}><i className={styles[`dot_${item.risk}`]}/><span><strong>{item.label}</strong><small>{item.current} encours · {item.pending} à traiter · {item.over20} &gt;20 j</small></span><em>{riskLabel(item.risk)}</em></div>)}</div></article>
        <article className={styles.panel}><div className={styles.panelTitle}><div><span>PHOTO USINE</span><h2>Les 4 chiffres du jour</h2></div></div><div className={styles.summaryNumbers}><div><span>Stock</span><strong>{fmt(data.summary.stock)}</strong></div><div><span>&gt;15 jours</span><strong>{fmt(data.summary.over15)}</strong></div><div><span>&gt;20 jours</span><strong>{fmt(data.summary.over20)}</strong></div><div><span>Dossiers actifs</span><strong>{fmt(data.summary.activeVehicles)}</strong></div></div></article>
      </section>
    </>}

    {data&&section==="decision"&&<section className={styles.panel}><div className={styles.panelTitle}><div><span>AIDE À LA DÉCISION</span><h2>Priorités à engager maintenant</h2></div><p>Classées par risque, vieillissement et charge.</p></div><div className={styles.actionList}>{data.actions.map(action=><article key={`${action.rank}-${action.sectorLabel}`}><div className={styles.rank}>{action.rank}</div><div className={styles.actionCopy}><span>{action.sectorLabel}</span><h3>{action.title}</h3><p>{action.detail}</p>{action.vehicles.length>0&&<div className={styles.vehicleChips}>{action.vehicles.map((vehicle,index)=><span key={`${vehicle.registration}-${index}`}><b>{vehicle.registration||"Sans immat."}</b>{vehicle.client?` · ${vehicle.client}`:""} · {fmt(vehicle.ageDays,1)} j</span>)}</div>}</div></article>)}</div></section>}

    {data&&section==="prevision"&&<>
      <section className={styles.forecastHero}><div><span>PRÉVISION FIN DE JOURNÉE</span><h2>{underTarget.length?`${underTarget.length} secteur${underTarget.length>1?"s":""} à sécuriser`:`Trajectoire de clôture maîtrisée`}</h2><p>La prévision combine le profil historique disponible et la cadence observée aujourd’hui.</p></div><strong>{data.production.profileDays}<small> jours appris</small></strong></section>
      <section className={styles.forecastGrid}>{data.production.sectors.map(item=><article key={item.key}><header><span>{item.label}</span><em>{item.confidence}</em></header><div><strong>{fmt(item.projected)}</strong><small>prévu / objectif {fmt(item.target)}</small></div><footer><span>Écart prévu</span><b className={item.gapProjected>=0?styles.good:styles.bad}>{item.gapProjected>0?"+":""}{fmt(item.gapProjected)}</b></footer></article>)}</section>
      {data.forecast&&<section className={styles.panel}><div className={styles.panelTitle}><div><span>CHARGE J+1 À J+3</span><h2>Pression projetée par secteur</h2></div></div><div className={styles.forecastTable}><div><span>SECTEUR</span><span>ACTUEL</span><span>J+1</span><span>J+2</span><span>J+3</span><span>RISQUE J+1</span></div>{data.forecast.map(item=><div key={item.key}><strong>{item.label}</strong><span>{item.current}</span><span>{item.d1}</span><span>{item.d2}</span><span>{item.d3}</span><em className={styles[`risk_${item.riskD1}`]}>{riskLabel(item.riskD1)}</em></div>)}</div></section>}
    </>}
  </main>;
}
