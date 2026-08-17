"use client";

import { useEffect, useState } from "react";

type State="checking"|"green"|"amber"|"red";
type Warning={code?:string;severity?:string;message?:string;count?:number;ageMinutes?:number};
type HealthPayload={ok?:boolean;dataTrustOk?:boolean;trustLevel?:"green"|"amber"|"red";dataReady?:boolean;warnings?:Warning[];production?:{snapshotDate?:string;sourceAgeMinutes?:number;sourceName?:string};ftp?:{syncAgeMinutes?:number;lastSuccessAt?:string}};

export default function DataTrustGuard(){
  const [state,setState]=useState<State>("checking");
  const [health,setHealth]=useState<HealthPayload|null>(null);
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get("nav");
    if(requested==="objectives"||requested==="sources"){setState("green");return;}
    let cancelled=false;
    async function check(){
      try{
        const response=await fetch(`/api/health?trust=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
        const payload=await response.json() as HealthPayload;
        if(cancelled)return;
        setHealth(payload);
        if(!response.ok||payload.dataReady!==true||payload.trustLevel==="red"||payload.dataTrustOk===false){setState("red");return;}
        setState(payload.trustLevel==="amber"?"amber":"green");
      }catch{if(!cancelled){setHealth(null);setState("red");}}
    }
    void check();const timer=window.setInterval(()=>void check(),60000);return()=>{cancelled=true;window.clearInterval(timer);};
  },[]);
  useEffect(()=>{document.body.classList.toggle("crvo-data-unavailable",state==="red");return()=>document.body.classList.remove("crvo-data-unavailable");},[state]);
  if(state==="checking"||state==="green")return null;
  const warnings=(health?.warnings??[]).filter(w=>w?.message).slice(0,state==="red"?4:2);
  if(state==="amber")return <div className="crvo-trust-watch" role="status"><strong>CONFIANCE DONNÉES · À SURVEILLER</strong><span>{warnings.map(w=>w.message).join(" · ")||"Une source nécessite une surveillance, les données restent exploitables."}</span><small>FTP vérifié il y a {Number(health?.ftp?.syncAgeMinutes??0).toLocaleString("fr-FR",{maximumFractionDigits:0})} min · source métier {Number(health?.production?.sourceAgeMinutes??0).toLocaleString("fr-FR",{maximumFractionDigits:0})} min</small><style>{`.crvo-trust-watch{position:fixed;z-index:145;left:50%;top:8px;transform:translateX(-50%);width:min(720px,calc(100vw - 130px));display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 12px;border:1px solid #efd995;border-radius:10px;background:rgba(255,249,234,.97);box-shadow:0 8px 24px rgba(72,57,12,.10);font-family:Exo,Arial,sans-serif;color:#725918}.crvo-trust-watch strong{font-size:8px;letter-spacing:.09em;white-space:nowrap}.crvo-trust-watch span{font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.crvo-trust-watch small{font-size:7px;color:#8b7433;white-space:nowrap}@media(max-width:760px){.crvo-trust-watch{top:54px;width:calc(100vw - 24px);grid-template-columns:1fr}.crvo-trust-watch span{white-space:normal}.crvo-trust-watch small{display:none}}@media print{.crvo-trust-watch{display:none!important}}`}</style></div>;
  return <div className="crvo-trust-alert" role="alert"><span>DONNÉES NON CERTIFIÉES</span><strong>Le pilotage opérationnel est volontairement neutralisé.</strong><p>{warnings.map(w=>w.message).join(" · ")||"La fraîcheur ou l'intégrité d'une source critique ne permet pas de présenter ces chiffres comme la situation réelle du centre."}</p><small>Le KPI CRVO fonctionne en mode fail-closed : aucune ancienne donnée n'est présentée silencieusement comme une donnée actuelle.</small><button type="button" onClick={()=>location.reload()}>RECONTRÔLER LES SOURCES</button><style>{`.crvo-data-unavailable .main-workspace{filter:grayscale(.7);opacity:.20;pointer-events:none;user-select:none}.crvo-data-unavailable .sidebar-bottom{opacity:.35}.crvo-trust-alert{position:fixed;z-index:180;left:calc(250px + 50%);top:150px;transform:translateX(-50%);width:min(650px,calc(100vw - 300px));padding:25px 28px;border:1px solid #efc8c5;border-left:5px solid #eb5b56;border-radius:14px;background:#fff;box-shadow:0 24px 60px rgba(26,58,79,.22);font-family:Exo,Arial,sans-serif;color:#17364d}.crvo-trust-alert span{display:block;color:#c53b39;font-size:9px;font-weight:800;letter-spacing:.13em}.crvo-trust-alert strong{display:block;margin-top:6px;color:#004f9f;font-size:22px;font-weight:800;font-style:italic}.crvo-trust-alert p{margin:10px 0 8px;color:#667f8f;font-size:11px;line-height:1.55}.crvo-trust-alert small{display:block;margin-bottom:16px;color:#8b5a59;font-size:8px;line-height:1.5}.crvo-trust-alert button{min-height:38px;padding:0 14px;border:0;border-radius:8px;background:#004f9f;color:#fff;font:800 9px Exo,Arial,sans-serif;letter-spacing:.08em}@media(max-width:760px){.crvo-data-unavailable .main-workspace{filter:grayscale(.7);opacity:.20}.crvo-trust-alert{left:50%;top:90px;width:calc(100vw - 28px)}}@media print{.crvo-trust-alert{display:none!important}}`}</style></div>;
}
