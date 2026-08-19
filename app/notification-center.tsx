"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NotificationRow={id:string;kind:string;severity:"info"|"warning"|"critical";title:string;message:string;workDate?:string|null;team?:string|null;sector?:string|null;createdAt:string;resolvedAt?:string|null;read:boolean;metadata?:Record<string,unknown>};
type Payload={notifications:NotificationRow[];unread:number};

export default function NotificationCenter(){
  const[data,setData]=useState<Payload>({notifications:[],unread:0});
  const[open,setOpen]=useState(false);
  const[toast,setToast]=useState<NotificationRow|null>(null);

  const load=useCallback(async()=>{
    try{
      const response=await fetch(`/api/notifications?limit=30&_=${Date.now()}`,{cache:"no-store"});
      if(!response.ok)return;
      const payload=await response.json() as Payload;
      setData(payload);
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

  async function markRead(id?:string){
    try{await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(id?{id}:{})});}catch{}
    setData(current=>({unread:id?Math.max(0,current.unread-1):0,notifications:current.notifications.map(item=>!id||item.id===id?{...item,read:true}:item)}));
  }

  const active=useMemo(()=>(data.notifications??[]).filter(item=>!item.resolvedAt),[data.notifications]);

  return <>
    <button className="crvo-notification-bell" aria-label={`Notifications${data.unread?` · ${data.unread} non lue(s)`:""}`} onClick={()=>{const next=!open;setOpen(next);if(next)void load();if(next&&data.unread)void markRead();}}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>
      {data.unread>0&&<b>{data.unread>99?"99+":data.unread}</b>}
    </button>

    {open&&<aside className="crvo-notification-panel" aria-label="Centre de notifications">
      <div className="crvo-notification-head"><div><span>CENTRE D’ALERTES</span><strong>Notifications</strong></div><button onClick={()=>setOpen(false)}>×</button></div>
      <div className="crvo-notification-list">
        {active.slice(0,8).map(item=><button key={item.id} className={`crvo-notification-item ${item.severity}`} onClick={()=>{void markRead(item.id);window.location.href="/temps-travail";}}>
          <i/><div><strong>{item.title}</strong><p>{item.message}</p><small>{item.workDate?`${item.workDate} · `:""}{item.team?`Équipe ${item.team} · `:""}{item.read?"lu":"non lu"}</small></div>
        </button>)}
        {!active.length&&<div className="crvo-notification-empty">Aucune alerte active.</div>}
      </div>
      <a className="crvo-notification-all" href="/notifications">VOIR TOUTES LES NOTIFICATIONS →</a>
    </aside>}

    {toast&&<div className={`crvo-notification-toast ${toast.severity}`} role="alert">
      <div><span>{toast.severity==="critical"?"ACTION REQUISE":"RAPPEL FIN DE POSTE"}</span><strong>{toast.title}</strong><p>{toast.message}</p></div>
      <div className="crvo-toast-actions"><button onClick={()=>setToast(null)}>FERMER</button><button onClick={()=>{void markRead(toast.id);setToast(null);window.location.href="/temps-travail";}}>OUVRIR TEMPS DE TRAVAIL</button></div>
    </div>}

    <style>{`
      .crvo-notification-bell{position:fixed;right:235px;top:10px;z-index:8500;width:38px;height:38px;border:1px solid #d6e3ea;border-radius:13px;background:rgba(255,255,255,.92);backdrop-filter:blur(14px);box-shadow:0 6px 22px rgba(19,58,82,.09);display:grid;place-items:center;cursor:pointer;color:#004f9f}
      .crvo-notification-bell svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .crvo-notification-bell b{position:absolute;right:-5px;top:-5px;min-width:18px;height:18px;padding:0 4px;display:grid;place-items:center;border-radius:10px;background:#e14f4f;color:white;border:2px solid white;font:700 9px Exo,Arial,sans-serif}
      .crvo-notification-panel{position:fixed;right:18px;top:58px;z-index:8501;width:min(390px,calc(100vw - 30px));max-height:min(610px,calc(100vh - 82px));overflow:hidden;border:1px solid #dce8ee;border-radius:20px;background:rgba(255,255,255,.98);box-shadow:0 24px 70px rgba(17,52,75,.2);font-family:Exo,Arial,sans-serif}
      .crvo-notification-head{display:flex;align-items:center;justify-content:space-between;padding:18px 19px;border-bottom:1px solid #e8eff3}.crvo-notification-head span{display:block;color:#009edb;font-size:9px;font-weight:800;letter-spacing:.12em}.crvo-notification-head strong{display:block;color:#14354b;font-size:18px;margin-top:2px}.crvo-notification-head button{border:0;background:#f1f6f8;width:30px;height:30px;border-radius:10px;color:#557184;font-size:20px;cursor:pointer}
      .crvo-notification-list{padding:8px;max-height:475px;overflow:auto}.crvo-notification-item{width:100%;display:flex;gap:11px;text-align:left;padding:13px 12px;border:0;border-bottom:1px solid #edf2f5;background:white;cursor:pointer;border-radius:12px}.crvo-notification-item:hover{background:#f7fbfd}.crvo-notification-item>i{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:0 0 auto;background:#009edb}.crvo-notification-item.warning>i{background:#f1a629}.crvo-notification-item.critical>i{background:#e14f4f}.crvo-notification-item strong{display:block;color:#163a52;font-size:12px}.crvo-notification-item p{margin:4px 0;color:#526d7f;font-size:11px;line-height:1.45}.crvo-notification-item small{color:#879ba8;font-size:9px}.crvo-notification-empty{padding:34px;text-align:center;color:#718897;font-size:12px}.crvo-notification-all{display:block;padding:14px 18px;border-top:1px solid #e8eff3;text-decoration:none;color:#004f9f;font-size:10px;font-weight:800;letter-spacing:.04em}
      .crvo-notification-toast{position:fixed;right:22px;bottom:22px;z-index:9000;width:min(430px,calc(100vw - 32px));padding:18px;border:1px solid #f0d79d;border-radius:18px;background:#fffdf8;box-shadow:0 22px 70px rgba(70,45,7,.2);font-family:Exo,Arial,sans-serif}.crvo-notification-toast.critical{border-color:#efc3c3;background:#fffafa}.crvo-notification-toast span{display:block;color:#b87912;font-size:9px;font-weight:800;letter-spacing:.12em}.crvo-notification-toast.critical span{color:#c44242}.crvo-notification-toast strong{display:block;margin-top:4px;color:#18394e;font-size:17px}.crvo-notification-toast p{margin:7px 0 0;color:#526d7f;font-size:12px;line-height:1.5}.crvo-toast-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.crvo-toast-actions button{border:1px solid #d8e4ea;border-radius:10px;background:white;padding:9px 11px;color:#36566a;font:800 9px Exo,Arial,sans-serif;cursor:pointer}.crvo-toast-actions button:last-child{background:#004f9f;border-color:#004f9f;color:white}
      @media(max-width:760px){.crvo-notification-bell{right:122px;top:8px}.crvo-notification-panel{right:10px;top:54px}.crvo-notification-toast{right:16px;bottom:16px}}
      @media print{.crvo-notification-bell,.crvo-notification-panel,.crvo-notification-toast{display:none!important}}
    `}</style>
  </>;
}
