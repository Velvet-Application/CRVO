"use client";

import { useEffect, useState } from "react";

type Payload={snapshot?:{date:string;label:string;source:string;sourceMode?:string};sourceMode?:string;latestSource?:string};
type StatusPayload={ftpRefresh?:{lastRefreshAt:string|null;lastDepositAt:string|null;lastDepositFilename:string|null;filesSeen:number;filesImported:number}|null};
type Latest={date:string;label:string;source:string;mode:string;lastRefreshAt:string|null;lastDepositAt:string|null;lastDepositFilename:string|null};

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

function timeLabel(value:string|null){
  if(!value)return "—";
  return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Europe/Paris"}).format(new Date(value));
}

function modeLabel(mode:string){return mode==="ftp"||mode==="sftp"?"FTP opérationnel":mode==="book"?"Dernier Book CRVO":"Historique de secours";}

export default function DataFreshnessGuard(){
  const [warning,setWarning]=useState<{date:string;expected:string;source:string}|null>(null);
  const [latest,setLatest]=useState<Latest|null>(null);
  useEffect(()=>{
    let active=true;
    const check=async()=>{
      try{
        const [dashboardResponse,statusResponse]=await Promise.all([
          fetch(`/api/dashboard?_=${Date.now()}`,{cache:"no-store"}),
          fetch(`/api/system-status?_=${Date.now()}`,{cache:"no-store"}),
        ]);
        if(!dashboardResponse.ok)return;
        const payload=await dashboardResponse.json() as Payload;
        const status=statusResponse.ok?await statusResponse.json() as StatusPayload:{};
        const snapshot=payload.snapshot;
        if(!snapshot?.date)return;
        const expected=previousBusinessDay(parisToday());
        const mode=payload.sourceMode||snapshot.sourceMode||"book";
        const source=mode==="ftp"||mode==="sftp"?"FTP":mode==="book"?"Book CRVO":"historique de secours";
        const ftp=status.ftpRefresh??null;
        if(active){
          setLatest({date:snapshot.date,label:snapshot.label,source:payload.latestSource||snapshot.source,mode,lastRefreshAt:ftp?.lastRefreshAt??null,lastDepositAt:ftp?.lastDepositAt??null,lastDepositFilename:ftp?.lastDepositFilename??null});
          setWarning(snapshot.date<expected?{date:snapshot.date,expected,source}:null);
        }
      }catch{}
    };
    void check(); const timer=window.setInterval(()=>void check(),30000);
    return()=>{active=false;window.clearInterval(timer);};
  },[]);

  useEffect(()=>{ document.body.classList.toggle("crvo-data-stale",Boolean(warning)); return()=>document.body.classList.remove("crvo-data-stale"); },[warning]);

  useEffect(()=>{
    if(!latest)return;
    const apply=()=>{
      const ftpDetail=latest.lastRefreshAt
        ? `Dernier refresh FTP ${timeLabel(latest.lastRefreshAt)}${latest.lastDepositAt?` · dépôt source ${timeLabel(latest.lastDepositAt)}`:""}${latest.lastDepositFilename?` · ${latest.lastDepositFilename}`:""}`
        : `Données arrêtées au ${latest.label} · ${latest.source}`;
      document.querySelectorAll<HTMLElement>(".freshness").forEach((node)=>{
        const strong=node.querySelector<HTMLElement>("strong"); const small=node.querySelector<HTMLElement>("small"); const tag=node.querySelector<HTMLElement>(".freshness-tag");
        if(strong)strong.textContent=modeLabel(latest.mode);
        if(small)small.textContent=ftpDetail;
        if(tag)tag.textContent=latest.lastRefreshAt?"FTP · REFRESH 15 MIN":latest.mode==="book"?"SOURCE BOOK":"SOURCE RÉELLE";
      });
      const side=document.querySelector<HTMLElement>(".sidebar-bottom");
      if(side){const strong=side.querySelector<HTMLElement>("strong");const small=side.querySelector<HTMLElement>("small");if(strong)strong.textContent=modeLabel(latest.mode);if(small)small.textContent=latest.lastRefreshAt?`FTP refresh ${timeLabel(latest.lastRefreshAt)} · dépôt ${timeLabel(latest.lastDepositAt)}`:`Dernière donnée · ${latest.label}`;}
    };
    apply();const observer=new MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();
  },[latest]);

  if(!warning)return null;
  return <div className="crvo-freshness-alert" role="alert"><strong>⚠ DONNÉES À CONTRÔLER</strong><span>Dernière donnée : <b>{displayDate(warning.date)}</b> via {warning.source}. Une donnée au moins au <b>{displayDate(warning.expected)}</b> est attendue avant décision opérationnelle.</span></div>;
}
