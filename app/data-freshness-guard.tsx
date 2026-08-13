"use client";

import { useEffect, useState } from "react";

type Payload={snapshot?:{date:string;label:string;source:string;sourceMode?:string};sourceMode?:string;latestSource?:string};

function parisToday(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=(type:string)=>parts.find((part)=>part.type===type)?.value||"";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function previousBusinessDay(iso:string){
  const date=new Date(`${iso}T12:00:00Z`);
  do { date.setUTCDate(date.getUTCDate()-1); } while(date.getUTCDay()===0||date.getUTCDay()===6);
  return date.toISOString().slice(0,10);
}

function displayDate(iso:string){
  return new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${iso}T12:00:00Z`));
}

export default function DataFreshnessGuard(){
  const [warning,setWarning]=useState<{date:string;expected:string;source:string}|null>(null);
  useEffect(()=>{
    let active=true;
    const check=async()=>{
      try{
        const response=await fetch(`/api/dashboard?_=${Date.now()}`,{cache:"no-store"});
        if(!response.ok) return;
        const payload=await response.json() as Payload;
        const date=payload.snapshot?.date;
        if(!date) return;
        const expected=previousBusinessDay(parisToday());
        const mode=payload.sourceMode||payload.snapshot?.sourceMode||"book";
        const source=mode==="sftp"?"SFTP":mode==="book"?"Book CRVO":"historique de secours";
        if(active) setWarning(date<expected?{date,expected,source}:null);
      }catch{}
    };
    void check(); const timer=window.setInterval(()=>void check(),60000);
    return()=>{active=false;window.clearInterval(timer);};
  },[]);

  useEffect(()=>{ document.body.classList.toggle("crvo-data-stale",Boolean(warning)); return()=>document.body.classList.remove("crvo-data-stale"); },[warning]);
  if(!warning) return null;
  return <div className="crvo-freshness-alert" role="alert"><strong>⚠ DONNÉES À CONTRÔLER</strong><span>Dernière donnée : <b>{displayDate(warning.date)}</b> via {warning.source}. Une donnée au moins au <b>{displayDate(warning.expected)}</b> est attendue avant décision opérationnelle.</span></div>;
}
