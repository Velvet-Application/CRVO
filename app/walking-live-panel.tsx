"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Vehicle={registration:string;work_order:string|null;client:string|null;status:string|null;age_days:number|null;remaining_minutes:number|null};
type Plan={sectorKey:string;label:string;oldest:Vehicle[]};
type Payload={workloadSnapshot:string|null;sources:{workloadSql:boolean;workloadTime:boolean};plans:Plan[]};
type Row=Vehicle&{sector:string;sectorKey:string};

function dateLabel(value:string|null){return value?new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`)):"—";}
function timeLabel(value:number|null){if(value==null)return"—";const h=Math.floor(value/60),m=Math.round(value%60);return h?`${h} h${m?` ${m} min`:""}`:`${m} min`;}

export default function WalkingLivePanel(){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [data,setData]=useState<Payload|null>(null);
  const [sector,setSector]=useState("Tous");
  const [error,setError]=useState("");

  useEffect(()=>{
    const locate=()=>{
      const old=document.querySelector<HTMLElement>(".oldest-overview");
      if(!old?.parentElement){document.body.classList.remove("crvo-live-walking");setHost(null);return;}
      let root=document.getElementById("walking-live-root");
      if(!root){root=document.createElement("div");root.id="walking-live-root";old.parentElement.insertBefore(root,old);}
      document.body.classList.add("crvo-live-walking");setHost(root);
    };
    locate();const observer=new MutationObserver(locate);observer.observe(document.body,{childList:true,subtree:true});return()=>{observer.disconnect();document.body.classList.remove("crvo-live-walking");};
  },[]);

  useEffect(()=>{
    if(!host)return;let active=true;
    const load=async()=>{try{const response=await fetch(`/api/pilotage?_=${Date.now()}`,{cache:"no-store"});const payload=await response.json() as Payload&{error?:string};if(!response.ok)throw new Error(payload.error||"Walking DEAD indisponible");if(active){setData(payload);setError("");}}catch(reason){if(active)setError(reason instanceof Error?reason.message:"Impossible d’actualiser la liste");}};
    void load();const timer=window.setInterval(()=>void load(),60000);return()=>{active=false;window.clearInterval(timer);};
  },[host]);

  const rows=useMemo<Row[]>(()=>{
    if(!data?.sources.workloadSql)return[];
    const map=new Map<string,Row>();
    data.plans.forEach((plan)=>plan.oldest.forEach((vehicle)=>{const key=`${vehicle.work_order||vehicle.registration}|${plan.sectorKey}`;map.set(key,{...vehicle,sector:plan.label,sectorKey:plan.sectorKey});}));
    return [...map.values()].filter((row)=>sector==="Tous"||row.sector===sector).sort((a,b)=>(b.age_days??-1)-(a.age_days??-1)).slice(0,30);
  },[data,sector]);
  const sectors=useMemo(()=>["Tous",...Array.from(new Set(data?.plans.flatMap((plan)=>plan.oldest.length?[plan.label]:[])??[]))],[data]);

  if(!host||!host.isConnected)return null;
  return createPortal(<section className="walking-live-panel">
    {!data&&<div className="walking-state">Chargement des dossiers réels…</div>}
    {data&&!data.sources.workloadSql&&<div className="walking-safety"><strong>LISTE STATIQUE DÉSACTIVÉE</strong><h3>Le Walking DEAD attend le flux OR en cours</h3><p>L’ancienne liste a été retirée du pilotage parce qu’elle pouvait afficher des véhicules qui n’étaient plus réellement en encours. Importe <b>OR en cours.xlsx</b> dans Sources & connexion ou branche la passerelle SQL : la liste se reconstruira automatiquement.</p></div>}
    {data&&data.sources.workloadSql&&<>
      <div className="walking-live-head"><div><span>SOURCE SQL ENCOURS</span><strong>Photographie du {dateLabel(data.workloadSnapshot)}</strong></div><div><small>Dossiers prioritaires visibles</small><b>{rows.length}</b></div><div><small>Temps restant</small><b>{data.sources.workloadTime?"DISPONIBLE":"INCOMPLET"}</b></div></div>
      <div className="walking-live-filter">{sectors.map((name)=><button key={name} className={sector===name?"active":""} onClick={()=>setSector(name)}>{name}</button>)}</div>
      <div className="walking-live-table"><div className="walking-row heading"><span>#</span><span>Secteur</span><span>Immatriculation</span><span>OR</span><span>Statut / activité</span><span>Client</span><span>Ancienneté</span><span>Temps restant</span></div>{rows.map((row,index)=><div className="walking-row" key={`${row.work_order}-${row.sectorKey}`}><b>{index+1}</b><span className="walking-sector">{row.sector}</span><strong>{row.registration||"—"}</strong><span>{row.work_order||"—"}</span><span>{row.status||"—"}</span><span>{row.client||"—"}</span><strong className={(row.age_days??0)>40?"critical":(row.age_days??0)>20?"warning":""}>{row.age_days==null?"—":`${row.age_days.toLocaleString("fr-FR",{maximumFractionDigits:1})} j`}</strong><span>{timeLabel(row.remaining_minutes)}</span></div>)}</div>
    </>}
    {error&&<div className="walking-error">{error}</div>}
  </section>,host);
}
