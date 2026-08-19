"use client";

import { useCallback, useEffect, useState } from "react";

type NotificationRow={
  id:string;
  kind:string;
  severity:"info"|"warning"|"critical";
  title:string;
  message:string;
  workDate?:string|null;
  team?:string|null;
  sector?:string|null;
  createdAt:string;
  resolvedAt?:string|null;
  read:boolean;
  metadata?:Record<string,unknown>;
};
type Payload={notifications:NotificationRow[];unread:number};

export default function NotificationCenter(){
  const[toast,setToast]=useState<NotificationRow|null>(null);

  const load=useCallback(async()=>{
    try{
      const response=await fetch(`/api/notifications?limit=30&_=${Date.now()}`,{cache:"no-store"});
      if(!response.ok)return;
      const payload=await response.json() as Payload;
      const next=(payload.notifications??[]).find(item=>!item.read&&!item.resolvedAt&&(item.severity==="warning"||item.severity==="critical"));
      if(next&&typeof window!=="undefined"){
        const key=`crvo-notification-shown:${next.id}`;
        if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,"1");setToast(next);}
      }
    }catch{}
  },[]);

  useEffect(()=>{
    void load();
    const refresh=()=>{if(document.visibilityState==="visible")void load();};
    const timer=window.setInterval(refresh,120000);
    document.addEventListener("visibilitychange",refresh);
    window.addEventListener("focus",refresh);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);window.removeEventListener("focus",refresh);};
  },[load]);

  async function markRead(id:string){
    try{await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});}catch{}
  }

  if(!toast)return null;
  const capacity=toast.kind==="capacity_warning";
  const destination=capacity?"/notifications":"/temps-travail";
  const actionLabel=capacity?"OUVRIR LES NOTIFICATIONS":"OUVRIR TEMPS DE TRAVAIL";
  const kicker=capacity?"SURVEILLANCE CAPACITÉ":toast.severity==="critical"?"ACTION REQUISE":"RAPPEL FIN DE POSTE";

  return <div className={`crvo-notification-toast ${toast.severity}`} role="alert">
    <div><span>{kicker}</span><strong>{toast.title}</strong><p>{toast.message}</p></div>
    <div className="crvo-toast-actions">
      <button onClick={()=>setToast(null)}>FERMER</button>
      <button onClick={()=>{void markRead(toast.id);setToast(null);window.location.href=destination;}}>{actionLabel}</button>
    </div>
    <style>{`
      .crvo-notification-toast{position:fixed;right:22px;bottom:22px;z-index:9000;width:min(430px,calc(100vw - 32px));padding:18px;border:1px solid #f0d79d;border-radius:18px;background:#fffdf8;box-shadow:0 22px 70px rgba(70,45,7,.2);font-family:Exo,Arial,sans-serif}.crvo-notification-toast.critical{border-color:#efc3c3;background:#fffafa}.crvo-notification-toast span{display:block;color:#b87912;font-size:9px;font-weight:800;letter-spacing:.12em}.crvo-notification-toast.critical span{color:#c44242}.crvo-notification-toast strong{display:block;margin-top:4px;color:#18394e;font-size:17px}.crvo-notification-toast p{margin:7px 0 0;color:#526d7f;font-size:12px;line-height:1.5}.crvo-toast-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.crvo-toast-actions button{border:1px solid #d8e4ea;border-radius:10px;background:white;padding:9px 11px;color:#36566a;font:800 9px Exo,Arial,sans-serif;cursor:pointer}.crvo-toast-actions button:last-child{background:#004f9f;border-color:#004f9f;color:white}@media(max-width:760px){.crvo-notification-toast{right:16px;bottom:16px}}@media print{.crvo-notification-toast{display:none!important}}
    `}</style>
  </div>;
}
