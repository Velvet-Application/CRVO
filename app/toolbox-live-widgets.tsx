"use client";

import {useEffect,useMemo,useState,type CSSProperties} from "react";
import styles from "./toolbox-live-widgets.module.css";

type WidgetKey="factory_exits"|"entries"|"absence_rate"|"unplanned_absence_etp"|"factory_stock"|"entry_exit_gap"|"ftp_freshness"|"approved_leave";
type Metrics={factoryExits?:number|null;entries?:number|null;factoryStock?:number|null;exitObjective?:number|null;entryExitGap?:number|null;absenceRate?:number|null;absencePeople?:number|null;population?:number|null;unplannedPeople?:number|null;unplannedHours?:number|null;unplannedEtp?:number|null;unplannedLostVop?:number|null;hoursPerSiteVop?:number|null;approvedLeavePeople?:number|null;factoryAgeMin?:number|null;parkAgeMin?:number|null;sourceName?:string|null;sourceModifiedAt?:string|null;factoryModifiedAt?:string|null;parkModifiedAt?:string|null};
type Payload={date:string;generatedAt:string;profile:string;available:WidgetKey[];selected:WidgetKey[];maxWidgets:number;metrics:Metrics;error?:string};

type CatalogItem={key:WidgetKey;label:string;description:string;group:"Production"|"RH"|"Sources"};
const CATALOG:CatalogItem[]=[
  {key:"factory_exits",label:"Sorties Usine",description:"VOP sortis aujourd’hui face à l’objectif journalier.",group:"Production"},
  {key:"entries",label:"Entrées",description:"VOP entrés dans le flux CRVO aujourd’hui.",group:"Production"},
  {key:"absence_rate",label:"Absentéisme",description:"Taux d’absences santé / non planifiées sur l’effectif du site.",group:"RH"},
  {key:"unplanned_absence_etp",label:"ETP absents non planifiés",description:"ETP et heures perdues sur maladie, AT et absences non anticipées.",group:"RH"},
  {key:"factory_stock",label:"Encours Factory",description:"Stock Factory actuellement exposé par le flux live.",group:"Production"},
  {key:"entry_exit_gap",label:"Écart entrées / sorties",description:"Solde du flux du jour entre entrées et sorties usine.",group:"Production"},
  {key:"approved_leave",label:"CP / RTT aujourd’hui",description:"Collaborateurs en CP ou RTT aujourd’hui.",group:"RH"},
  {key:"ftp_freshness",label:"Fraîcheur FTP",description:"Ancienneté des dernières données Factory et État du Parc.",group:"Sources"},
];

function n(value:number|null|undefined,digits=0){return value==null||!Number.isFinite(Number(value))?"—":Number(value).toLocaleString("fr-FR",{minimumFractionDigits:digits,maximumFractionDigits:digits});}
function timeLabel(value?:string|null){if(!value)return"—";return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(new Date(value));}
function dateLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"2-digit",month:"long",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function ageLabel(value:number|null|undefined){if(value==null||!Number.isFinite(Number(value)))return"—";const minutes=Math.max(0,Math.round(Number(value)));if(minutes<60)return`${minutes} min`;const hours=Math.floor(minutes/60),rest=minutes%60;return rest?`${hours} h ${rest} min`:`${hours} h`;}
function freshnessTone(age:number|null|undefined){if(age==null)return"neutral";if(age<=45)return"good";if(age<=90)return"warning";return"critical";}

function CarIcon(){return <svg viewBox="0 0 48 24" aria-hidden="true"><path d="M7 16h34l-2-7-6-4H16l-6 4-3 7Z"/><path d="M14 9h20M4 16v4h4m36-4v4h-4"/><circle cx="13" cy="18" r="3"/><circle cx="35" cy="18" r="3"/></svg>}

export default function ToolboxLiveWidgets(){
  const[data,setData]=useState<Payload|null>(null);const[error,setError]=useState("");const[configOpen,setConfigOpen]=useState(false);const[draft,setDraft]=useState<WidgetKey[]>([]);const[saving,setSaving]=useState(false);const[pulse,setPulse]=useState(0);
  async function load(silent=false){if(!silent)setError("");try{const response=await fetch(`/api/toolbox-widgets?_=${Date.now()}`,{cache:"no-store"});const payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error||"Chargement impossible.");setData(payload);setDraft(payload.selected??[]);setPulse(value=>value+1);}catch(cause){if(!silent)setError(cause instanceof Error?cause.message:"Indicateurs indisponibles.");}}
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(true),60000);return()=>window.clearInterval(timer);},[]);
  const available=useMemo(()=>CATALOG.filter(item=>data?.available?.includes(item.key)),[data?.available]);
  const selected=data?.selected??[];
  const worstAge=Math.max(Number(data?.metrics.factoryAgeMin??0),Number(data?.metrics.parkAgeMin??0));
  const generated=data?.generatedAt?timeLabel(data.generatedAt):"—";

  function toggle(key:WidgetKey){setDraft(current=>current.includes(key)?current.filter(item=>item!==key):current.length<(data?.maxWidgets??6)?[...current,key]:current);}
  function move(key:WidgetKey,delta:number){setDraft(current=>{const index=current.indexOf(key);const target=index+delta;if(index<0||target<0||target>=current.length)return current;const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next;});}
  async function save(){if(!draft.length)return;setSaving(true);setError("");try{const response=await fetch("/api/toolbox-widgets",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({widgets:draft})});const payload=await response.json() as {error?:string};if(!response.ok)throw new Error(payload.error||"Enregistrement impossible.");setConfigOpen(false);await load();}catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}finally{setSaving(false);}}

  if(data&&available.length===0)return null;
  return <section className={styles.live} aria-label="Indicateurs Live CRVO">
    <div className={styles.liveHead}>
      <div><span className={styles.liveDot}/><div><p>LIVE CRVO</p><strong>{data?dateLabel(data.date):"Indicateurs du site"}</strong></div><small>Actualisé à {generated}</small></div>
      <button type="button" onClick={()=>{setDraft(selected);setConfigOpen(true);}}>Configurer mes indicateurs <span>⚙</span></button>
    </div>
    {error&&<div className={styles.error}>{error}</div>}
    {!data&&!error&&<div className={styles.skeleton}><i/><i/><i/><i/></div>}
    {data&&<div className={styles.grid} data-count={selected.length} key={pulse}>
      {selected.map(key=>{
        const m=data.metrics;
        if(key==="factory_exits"){
          const progress=Math.max(0,Math.min(100,Number(m.exitObjective)>0?Number(m.factoryExits??0)*100/Number(m.exitObjective):0));
          return <article className={styles.card} data-widget="exits" key={key}><header><span>PRODUCTION</span><b>Sorties Usine</b><i>LIVE</i></header><div className={styles.value}><strong>{n(m.factoryExits)}</strong><em>VO</em></div><p>Objectif du jour : <b>{n(m.exitObjective)} VO</b> · {n(progress)} % atteint</p><div className={styles.road}><span style={{width:`${progress}%`}}/><div className={styles.car} style={{left:`calc(${progress}% - 17px)`}}><CarIcon/></div><i/></div></article>;
        }
        if(key==="entries")return <article className={styles.card} data-widget="entries" key={key}><header><span>FLUX</span><b>Entrées aujourd’hui</b><i>LIVE</i></header><div className={`${styles.value} ${styles.odometer}`}><strong>{n(m.entries)}</strong><em>VO</em></div><p>Solde entrées / sorties : <b>{Number(m.entryExitGap??0)>=0?"+":""}{n(m.entryExitGap)} VO</b></p><div className={styles.flowBars}><i/><i/><i/><i/><i/></div></article>;
        if(key==="absence_rate"){
          const rate=Math.max(0,Math.min(100,Number(m.absenceRate??0)));
          return <article className={styles.card} data-widget="absence" key={key}><header><span>RH</span><b>Absentéisme</b><i>LIVE</i></header><div className={styles.ringWrap}><div className={styles.ring} style={{"--ring":`${rate*3.6}deg`} as CSSProperties}><span><strong>{n(rate,1)}%</strong><small>du site</small></span></div><p><b>{n(m.absencePeople)}</b> personnes / {n(m.population)} collaborateurs<br/><small>Maladie, AT, absence longue et non justifiée.</small></p></div></article>;
        }
        if(key==="unplanned_absence_etp")return <article className={styles.card} data-widget="unplanned" key={key}><header><span>CAPACITÉ RH</span><b>ETP absents non planifiés</b><i>LIVE</i></header><div className={styles.value}><strong>{n(m.unplannedEtp,1)}</strong><em>ETP</em></div><p><b>{n(m.unplannedPeople)}</b> personnes · {n(m.unplannedHours,1)} h perdues{m.unplannedLostVop!=null?<> · <strong>≈ -{n(m.unplannedLostVop,1)} VO</strong></>:null}</p><div className={styles.peoplePulse}><i/><i/><i/><i/><i/><i/></div></article>;
        if(key==="factory_stock")return <article className={styles.card} data-widget="stock" key={key}><header><span>ENCOURS</span><b>Stock Factory</b><i>LIVE</i></header><div className={styles.value}><strong>{n(m.factoryStock)}</strong><em>VO</em></div><p>Encours Factory exposé par la dernière donnée disponible.</p><div className={styles.stockLine}><i/><i/><i/><i/><i/><i/><i/></div></article>;
        if(key==="entry_exit_gap"){
          const gap=Number(m.entryExitGap??0);return <article className={styles.card} data-widget={gap>0?"gap-high":"gap"} key={key}><header><span>ÉQUILIBRE DU FLUX</span><b>Entrées − sorties</b><i>LIVE</i></header><div className={styles.value}><strong>{gap>0?"+":""}{n(gap)}</strong><em>VO</em></div><p>{gap>0?"Le stock augmente sur la journée.":gap<0?"Les sorties dépassent les entrées.":"Flux parfaitement équilibré à ce stade."}</p><div className={styles.balance}><span>ENTRÉES {n(m.entries)}</span><i>↔</i><span>SORTIES {n(m.factoryExits)}</span></div></article>;
        }
        if(key==="approved_leave")return <article className={styles.card} data-widget="leave" key={key}><header><span>RH PLANIFIÉ</span><b>CP / RTT aujourd’hui</b><i>LIVE</i></header><div className={styles.value}><strong>{n(m.approvedLeavePeople)}</strong><em>pers.</em></div><p>Absences planifiées et déjà intégrées à la capacité du site.</p><div className={styles.leaveDots}>{Array.from({length:10},(_,index)=><i key={index} data-on={index<Math.min(10,Math.ceil(Number(m.approvedLeavePeople??0)/6))}/>)}</div></article>;
        const tone=freshnessTone(worstAge);
        return <article className={styles.card} data-widget={`freshness-${tone}`} key={key}><header><span>SOURCES</span><b>Fraîcheur FTP</b><i>{tone==="good"?"FRAIS":tone==="warning"?"À SURVEILLER":"RETARD"}</i></header><div className={styles.value}><strong>{ageLabel(worstAge)}</strong></div><p>Factory : <b>{ageLabel(m.factoryAgeMin)}</b> · Parc : <b>{ageLabel(m.parkAgeMin)}</b></p><div className={styles.sourceTimes}><span>Factory {timeLabel(m.factoryModifiedAt)}</span><span>Parc {timeLabel(m.parkModifiedAt)}</span></div></article>;
      })}
    </div>}

    {configOpen&&data&&<><button className={styles.backdrop} aria-label="Fermer la configuration" onClick={()=>setConfigOpen(false)}/><aside className={styles.config}>
      <header><div><span>PERSONNALISATION</span><h2>Mes indicateurs Live CRVO</h2><p>Choisis de 1 à {data.maxWidgets} cartes. Leur emplacement reste verrouillé pour préserver la lisibilité de la ToolBox.</p></div><button onClick={()=>setConfigOpen(false)}>×</button></header>
      <div className={styles.configList}>{available.map(item=>{const active=draft.includes(item.key);const index=draft.indexOf(item.key);return <article key={item.key} data-active={active}><button className={styles.check} onClick={()=>toggle(item.key)} aria-pressed={active}>{active?"✓":""}</button><div><span>{item.group}</span><strong>{item.label}</strong><p>{item.description}</p></div>{active&&<nav><button onClick={()=>move(item.key,-1)} disabled={index<=0}>↑</button><button onClick={()=>move(item.key,1)} disabled={index>=draft.length-1}>↓</button></nav>}</article>})}</div>
      <footer><span>{draft.length} / {data.maxWidgets} widgets sélectionnés</span><button onClick={()=>void save()} disabled={saving||draft.length<1}>{saving?"Enregistrement…":"Enregistrer ma configuration"}</button></footer>
    </aside></>}
  </section>;
}
