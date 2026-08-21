"use client";

import {useCallback,useEffect,useState} from "react";

type NotificationRow={id:string;kind:string;severity:"info"|"warning"|"critical";title:string;message:string;createdAt:string;resolvedAt?:string|null;read:boolean;metadata?:Record<string,unknown>};
type Payload={notifications:NotificationRow[];unread:number};
const POPUP_KINDS=new Set(["quality_claim_received","quality_claim_message","internal_chat_message"]);

export default function NotificationCenter(){
  const[toast,setToast]=useState<NotificationRow|null>(null);
  const load=useCallback(async()=>{
    try{
      const response=await fetch(`/api/notifications?limit=40&_=${Date.now()}`,{cache:"no-store"});
      if(!response.ok)return;
      const payload=await response.json() as Payload;
      const next=(payload.notifications??[]).find(item=>!item.read&&!item.resolvedAt&&(POPUP_KINDS.has(item.kind)||item.severity==="warning"||item.severity==="critical"));
      if(next){const key=`crvo-notification-shown:${next.id}`;if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,"1");setToast(next)}}
    }catch{}
  },[]);
  useEffect(()=>{void load();const refresh=()=>{if(document.visibilityState==="visible")void load()};const timer=window.setInterval(refresh,12000);document.addEventListener("visibilitychange",refresh);window.addEventListener("focus",refresh);return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);window.removeEventListener("focus",refresh)}},[load]);
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(null),8500);return()=>window.clearTimeout(timer)},[toast?.id]);
  async function markRead(id:string){try{await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})})}catch{}}
  if(!toast)return null;
  const href=typeof toast.metadata?.href==="string"?toast.metadata.href:toast.kind==="capacity_warning"?"/notifications":toast.kind.includes("worktime")?"/temps-travail":"/notifications";
  const kicker=toast.kind==="quality_claim_received"?"NOUVELLE RÉCLAMATION":toast.kind==="quality_claim_message"?"MESSAGE RÉSEAU":toast.kind==="internal_chat_message"?"MESSAGERIE INTERNE":toast.severity==="critical"?"ACTION REQUISE":"NOTIFICATION";
  const action=toast.kind==="internal_chat_message"?"OUVRIR LE CHAT":toast.kind.startsWith("quality_claim")?"OUVRIR LE DOSSIER":"OUVRIR";
  return <div className={`crvo-notification-toast ${toast.severity}`} role="alert" aria-live="polite">
    <div className="crvo-toast-icon">{toast.kind==="internal_chat_message"?"✦":toast.kind.startsWith("quality_claim")?"RQ":"!"}</div>
    <div className="crvo-toast-copy"><span>{kicker}</span><strong>{toast.title}</strong><p>{toast.message}</p></div>
    <button className="crvo-toast-close" onClick={()=>setToast(null)} aria-label="Fermer">×</button>
    <div className="crvo-toast-actions"><button onClick={()=>{void markRead(toast.id);setToast(null);location.href=href}}>{action}</button></div>
    <style>{`
      .crvo-notification-toast{position:fixed;right:22px;bottom:88px;z-index:10020;width:min(430px,calc(100vw - 32px));display:grid;grid-template-columns:46px 1fr auto;gap:12px;padding:15px 15px 12px;border:1px solid #c8dfed;border-radius:18px;background:rgba(255,255,255,.97);box-shadow:0 22px 70px rgba(19,56,82,.22);backdrop-filter:blur(12px);font-family:Exo,Arial,sans-serif;animation:crvo-toast-in .25s ease-out}.crvo-notification-toast.warning{border-color:#ecd28e}.crvo-notification-toast.critical{border-color:#e7b4b4}.crvo-toast-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:linear-gradient(145deg,#004f9f,#009edb);color:#fff;font-size:13px;font-weight:900}.warning .crvo-toast-icon{background:#b9850a}.critical .crvo-toast-icon{background:#bd4545}.crvo-toast-copy span{display:block;color:#009edb;font-size:8px;font-weight:900;letter-spacing:.11em}.warning .crvo-toast-copy span{color:#9b6e00}.critical .crvo-toast-copy span{color:#b33f3f}.crvo-toast-copy strong{display:block;margin-top:3px;color:#17394f;font-size:15px}.crvo-toast-copy p{margin:4px 0 0;color:#5d7485;font-size:10px;line-height:1.45}.crvo-toast-close{border:0;background:transparent;color:#718493;font-size:20px;cursor:pointer}.crvo-toast-actions{grid-column:2/4;display:flex;justify-content:flex-end;margin-top:2px}.crvo-toast-actions button{border:0;border-radius:9px;background:#004f9f;padding:8px 10px;color:white;font:800 8px Exo,Arial,sans-serif;cursor:pointer}@keyframes crvo-toast-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}@media(max-width:760px){.crvo-notification-toast{right:12px;bottom:78px;width:calc(100vw - 24px);box-sizing:border-box}}@media print{.crvo-notification-toast{display:none!important}}
    `}</style>
  </div>;
}
