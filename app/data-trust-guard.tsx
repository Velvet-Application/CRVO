"use client";

import { useEffect, useMemo, useState } from "react";

type State="checking"|"green"|"watch"|"alert"|"red";
type Warning={code?:string;severity?:string;message?:string;count?:number;ageMinutes?:number};
type HealthPayload={ok?:boolean;dataTrustOk?:boolean;trustLevel?:"green"|"amber"|"red";dataReady?:boolean;warnings?:Warning[];production?:{snapshotDate?:string;sourceAgeMinutes?:number;sourceName?:string};ftp?:{syncAgeMinutes?:number;lastSuccessAt?:string}};

function numericAge(value:unknown){
  const age=Number(value);
  return Number.isFinite(age)?Math.max(0,age):null;
}
function minuteLabel(value:unknown){
  const age=numericAge(value);
  if(age==null)return"durée inconnue";
  const rounded=Math.round(age);
  if(rounded<60)return`${rounded.toLocaleString("fr-FR")} min`;
  const hours=Math.floor(rounded/60);
  const minutes=rounded%60;
  return minutes?`${hours} h ${String(minutes).padStart(2,"0")}`:`${hours} h`;
}

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
        const ftpAge=numericAge(payload.ftp?.syncAgeMinutes);
        if(!response.ok||payload.dataReady!==true||payload.trustLevel==="red"||payload.dataTrustOk===false){setState("red");return;}
        if(payload.trustLevel==="amber"){
          setState(ftpAge!=null&&ftpAge>120?"alert":"watch");
          return;
        }
        setState("green");
      }catch{
        if(!cancelled){setHealth(null);setState("red");}
      }
    }
    void check();
    const timer=window.setInterval(()=>void check(),60000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[]);

  const signalWarnings=useMemo(()=>{
    const all=(health?.warnings??[]).filter(w=>w?.message);
    const important=all.filter(w=>w.severity==="critical"||w.severity==="warning");
    return (important.length?important:all).slice(0,4);
  },[health]);

  if(state==="checking"||state==="green")return null;

  const ftpAgeValue=numericAge(health?.ftp?.syncAgeMinutes);
  const ftpAge=minuteLabel(health?.ftp?.syncAgeMinutes);
  const sourceAge=minuteLabel(health?.production?.sourceAgeMinutes);
  const message=signalWarnings.map(w=>w.message).join("  •  ") || "Une source nécessite un contrôle de fraîcheur.";
  const tickerText=`${message}  •  Dernière synchronisation FTP : il y a ${ftpAge}  •  Âge de la source métier : ${sourceAge}`;
  const isRed=state==="red";
  const label=isRed
    ?(ftpAgeValue!=null&&ftpAgeValue>180?"DONNÉES NON CERTIFIÉES":"DONNÉES À RECONTRÔLER")
    :state==="alert"?"ALERTE FRAÎCHEUR":"VIGILANCE DONNÉES";

  return <aside className={`crvo-trust-ticker is-${state}`} role={isRed?"alert":"status"} aria-live={isRed?"assertive":"polite"}>
    <div className="crvo-trust-ticker__shell" title={tickerText}>
      <strong>{label}</strong>
      <div className="crvo-trust-ticker__viewport">
        <div className="crvo-trust-ticker__track">
          <span>{tickerText}</span><i aria-hidden="true">◆</i>
          <span aria-hidden="true">{tickerText}</span><i aria-hidden="true">◆</i>
        </div>
      </div>
      <small>CONTRÔLE AUTO · 60 S</small>
    </div>
    <style>{`
      .crvo-trust-ticker{position:fixed;z-index:190;left:0;right:0;bottom:0;padding:0;font-family:Exo,Arial,sans-serif;pointer-events:none}
      .crvo-trust-ticker__shell{pointer-events:auto;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;min-height:36px;padding:7px 18px;border-top:1px solid rgba(0,79,159,.22);background:rgba(247,251,254,.98);box-shadow:0 -8px 30px rgba(22,57,83,.12);backdrop-filter:blur(12px);color:#17364d}
      .crvo-trust-ticker.is-watch .crvo-trust-ticker__shell{border-top-color:#e6c261;background:rgba(255,249,231,.98)}
      .crvo-trust-ticker.is-alert .crvo-trust-ticker__shell{border-top:2px solid #df8b28;background:rgba(255,247,235,.99)}
      .crvo-trust-ticker.is-red .crvo-trust-ticker__shell{border-top:2px solid #eb5b56;background:rgba(255,245,244,.99)}
      .crvo-trust-ticker strong{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font-size:10px;letter-spacing:.09em;font-weight:800;color:#6c5918}
      .crvo-trust-ticker strong:before{content:"";width:8px;height:8px;border-radius:50%;background:#e4b93e;box-shadow:0 0 0 5px rgba(228,185,62,.13)}
      .crvo-trust-ticker.is-alert strong{color:#a55a13}.crvo-trust-ticker.is-alert strong:before{background:#df8b28;box-shadow:0 0 0 5px rgba(223,139,40,.14)}
      .crvo-trust-ticker.is-red strong{color:#b43c3a}.crvo-trust-ticker.is-red strong:before{background:#eb5b56;box-shadow:0 0 0 5px rgba(235,91,86,.13)}
      .crvo-trust-ticker__viewport{min-width:0;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent)}
      .crvo-trust-ticker__track{display:flex;align-items:center;width:max-content;white-space:nowrap;will-change:transform;animation:crvoTrustMarquee 28s linear infinite;font-size:11px;font-weight:600;color:#496b82}
      .crvo-trust-ticker.is-alert .crvo-trust-ticker__track{color:#805c31}.crvo-trust-ticker.is-red .crvo-trust-ticker__track{color:#7e5452}
      .crvo-trust-ticker__track span{padding-right:26px}.crvo-trust-ticker__track i{padding-right:26px;font-style:normal;font-size:7px;color:#009edb}
      .crvo-trust-ticker small{white-space:nowrap;font-size:8px;font-weight:700;letter-spacing:.08em;color:#7890a0}
      .crvo-trust-ticker__shell:hover .crvo-trust-ticker__track{animation-play-state:paused}
      @keyframes crvoTrustMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
      @media(max-width:760px){
        .crvo-trust-ticker{top:max(8px,env(safe-area-inset-top));bottom:auto;left:8px;right:8px}
        .crvo-trust-ticker__shell{grid-template-columns:auto minmax(0,1fr);gap:10px;min-height:38px;padding:8px 11px;border:1px solid rgba(0,79,159,.18);border-radius:11px;box-shadow:0 8px 26px rgba(22,57,83,.16)}
        .crvo-trust-ticker.is-watch .crvo-trust-ticker__shell{border-color:#e6c261}.crvo-trust-ticker.is-alert .crvo-trust-ticker__shell{border:1.5px solid #df8b28}.crvo-trust-ticker.is-red .crvo-trust-ticker__shell{border:1.5px solid #eb5b56}
        .crvo-trust-ticker strong{font-size:8px;letter-spacing:.07em}.crvo-trust-ticker strong:before{width:7px;height:7px;box-shadow:0 0 0 4px rgba(228,185,62,.13)}
        .crvo-trust-ticker.is-alert strong:before{box-shadow:0 0 0 4px rgba(223,139,40,.14)}.crvo-trust-ticker.is-red strong:before{box-shadow:0 0 0 4px rgba(235,91,86,.13)}
        .crvo-trust-ticker__track{font-size:9px;animation-duration:24s}.crvo-trust-ticker small{display:none}
      }
      @media(prefers-reduced-motion:reduce){.crvo-trust-ticker__viewport{overflow:auto;mask-image:none}.crvo-trust-ticker__track{width:auto;animation:none;white-space:normal}.crvo-trust-ticker__track span[aria-hidden="true"],.crvo-trust-ticker__track i{display:none}}
      @media print{.crvo-trust-ticker{display:none!important}}
    `}</style>
  </aside>;
}
