"use client";

import { useEffect, useState } from "react";

type State="checking"|"ok"|"unavailable"|"stale";
type TrustPayload={connected?:boolean;snapshot?:{date?:string};snapshots?:unknown[];backend?:string;latestSource?:string};
export default function DataTrustGuard(){
  const [state,setState]=useState<State>("checking");
  useEffect(()=>{
    const requested=new URLSearchParams(window.location.search).get("nav");
    if(window.location.pathname!=="/"||requested==="objectives"||requested==="sources"){setState("ok");return;}
    let cancelled=false;
    async function check(){try{
      const response=await fetch(`/api/dashboard?history=1&trust=${Date.now()}`,{cache:"no-store"});if(!response.ok)throw new Error();const payload=await response.json() as TrustPayload;
      if(payload.connected!==true){if(!cancelled)setState("unavailable");return;}
      const dateIso=payload.snapshot?.date;const snapshotDate=dateIso?new Date(`${dateIso}T12:00:00Z`):null;const ageMs=snapshotDate&&!Number.isNaN(snapshotDate.getTime())?Date.now()-snapshotDate.getTime():Number.POSITIVE_INFINITY;const maxAgeMs=3*24*60*60*1000;
      if(!cancelled)setState(ageMs<=maxAgeMs?"ok":"stale");
    }catch{if(!cancelled)setState("unavailable");}}
    void check();const timer=window.setInterval(()=>void check(),60000);return()=>{cancelled=true;window.clearInterval(timer);};
  },[]);
  useEffect(()=>{document.body.classList.toggle("crvo-data-unavailable",state==="unavailable"||state==="stale");return()=>document.body.classList.remove("crvo-data-unavailable");},[state]);
  if(state!=="unavailable"&&state!=="stale")return null;
  const stale=state==="stale";
  return <div className="crvo-trust-alert" role="alert"><span>{stale?"DONNÉES À ACTUALISER":"DONNÉES NON CERTIFIÉES"}</span><strong>{stale?"La dernière photographie opérationnelle est trop ancienne.":"Le flux de pilotage ne répond pas."}</strong><p>{stale?"Les indicateurs du CODIR sont neutralisés tant qu'une donnée récente n'est pas disponible. L'outil ne présente pas une photographie ancienne comme la situation du jour.":"Les indicateurs opérationnels sont neutralisés tant que la source réelle n'est pas disponible."}</p><button type="button" onClick={()=>location.reload()}>RÉESSAYER</button><style>{`
    .crvo-data-unavailable .main-workspace{filter:grayscale(.7);opacity:.20;pointer-events:none;user-select:none}.crvo-data-unavailable .sidebar-bottom{opacity:.35}.crvo-trust-alert{position:fixed;z-index:180;left:calc(250px + 50%);top:150px;transform:translateX(-50%);width:min(620px,calc(100vw - 300px));padding:25px 28px;border:1px solid #efc8c5;border-left:5px solid #eb5b56;border-radius:14px;background:#fff;box-shadow:0 24px 60px rgba(26,58,79,.22);font-family:Exo,Arial,sans-serif;color:#17364d}.crvo-trust-alert span{display:block;color:#c53b39;font-size:9px;font-weight:800;letter-spacing:.13em}.crvo-trust-alert strong{display:block;margin-top:6px;color:#004f9f;font-size:22px;font-weight:800;font-style:italic}.crvo-trust-alert p{margin:10px 0 16px;color:#667f8f;font-size:11px;line-height:1.55}.crvo-trust-alert button{min-height:38px;padding:0 14px;border:0;border-radius:8px;background:#004f9f;color:#fff;font:800 9px Exo,Arial,sans-serif;letter-spacing:.08em}@media(max-width:760px){.crvo-data-unavailable .main-workspace{filter:grayscale(.7);opacity:.20}.crvo-trust-alert{left:50%;top:90px;width:calc(100vw - 28px)}}@media print{.crvo-trust-alert{display:none!important}}
  `}</style></div>;
}
