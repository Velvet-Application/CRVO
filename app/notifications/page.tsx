"use client";

import { useEffect, useMemo, useState } from "react";

type NotificationRow={id:string;kind:string;severity:"info"|"warning"|"critical";title:string;message:string;workDate?:string|null;team?:string|null;sector?:string|null;createdAt:string;resolvedAt?:string|null;read:boolean;metadata?:Record<string,unknown>};
type Payload={notifications:NotificationRow[];unread:number;error?:string};

function dateTime(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}

export default function NotificationsPage(){
  const[data,setData]=useState<Payload>({notifications:[],unread:0});
  const[loading,setLoading]=useState(true);
  const[filter,setFilter]=useState<"active"|"all">("active");
  const[deletingId,setDeletingId]=useState<string|null>(null);
  const[purging,setPurging]=useState(false);
  const[error,setError]=useState<string|null>(null);

  async function load(markVisibleRead=false){
    setLoading(true);setError(null);
    try{
      if(markVisibleRead)await fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"});
      const r=await fetch(`/api/notifications?limit=100&_=${Date.now()}`,{cache:"no-store"});
      const p=await r.json() as Payload;
      if(!r.ok)throw new Error(p.error||"Chargement impossible.");
      setData(p);
    }catch(e){setError(e instanceof Error?e.message:"Chargement impossible.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load(true);},[]);

  const rows=useMemo(()=>filter==="active"?data.notifications.filter(item=>!item.resolvedAt):data.notifications,[data.notifications,filter]);
  const readCount=useMemo(()=>data.notifications.filter(item=>item.read).length,[data.notifications]);

  async function removeNotification(id:string){
    setDeletingId(id);setError(null);
    try{
      const r=await fetch("/api/notifications",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})});
      const p=await r.json().catch(()=>({})) as {error?:string};
      if(!r.ok)throw new Error(p.error||"Suppression impossible.");
      setData(current=>({...current,notifications:current.notifications.filter(item=>item.id!==id)}));
    }catch(e){setError(e instanceof Error?e.message:"Suppression impossible.");}
    finally{setDeletingId(null);}
  }

  async function purgeRead(){
    if(!readCount)return;
    if(!window.confirm(`Supprimer ${readCount} notification${readCount>1?"s":""} déjà lue${readCount>1?"s":""} de votre centre de notifications ?`))return;
    setPurging(true);setError(null);
    try{
      const r=await fetch("/api/notifications",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({readOnly:true})});
      const p=await r.json().catch(()=>({})) as {error?:string};
      if(!r.ok)throw new Error(p.error||"Purge impossible.");
      await load(false);
    }catch(e){setError(e instanceof Error?e.message:"Purge impossible.");}
    finally{setPurging(false);}
  }

  return <main className="notifications-page">
    <header><div><a href="/">← TABLEAU DE BORD</a><span>CENTRE D’ALERTES</span><h1>Notifications</h1><p>Suivi des alertes et actions à traiter. Une notification supprimée disparaît uniquement de votre espace.</p></div><div className="count"><strong>{data.unread}</strong><span>NON LUE(S)</span></div></header>
    <section className="toolbar">
      <button className={filter==="active"?"active":""} onClick={()=>setFilter("active")}>ACTIVES</button>
      <button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>TOUTES</button>
      <button className="purge" disabled={!readCount||purging} onClick={()=>void purgeRead()}>{purging?"PURGE…":`PURGER LES LUES${readCount?` · ${readCount}`:""}`}</button>
      <button className="refresh" disabled={loading} onClick={()=>void load(true)}>{loading?"CHARGEMENT…":"ACTUALISER"}</button>
    </section>
    {error&&<div className="error" role="alert">{error}</div>}
    <section className="list">
      {rows.map(item=><article key={item.id} className={`${item.severity} ${item.resolvedAt?"resolved":""}`}>
        <i/><div className="main"><div><span>{item.kind==="worktime_missing_validation"?"TEMPS DE TRAVAIL":"ALERTE"}</span>{item.read&&<b className="read">LUE</b>}{item.resolvedAt&&<b>RÉSOLUE</b>}</div><h2>{item.title}</h2><p>{item.message}</p><small>{dateTime(item.createdAt)}{item.workDate?` · journée ${item.workDate}`:""}{item.team?` · équipe ${item.team}`:""}{item.sector?` · ${item.sector}`:""}</small></div>
        <div className="actions"><a href={typeof item.metadata?.href==="string"?item.metadata.href:item.kind.includes("worktime")?"/temps-travail":"/notifications"}>OUVRIR →</a><button className="delete" disabled={deletingId===item.id} onClick={()=>void removeNotification(item.id)} title="Supprimer cette notification" aria-label={`Supprimer la notification ${item.title}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg></button></div>
      </article>)}
      {!loading&&!rows.length&&<div className="empty"><strong>Tout est propre.</strong><span>Aucune notification dans ce filtre.</span></div>}
      {loading&&<div className="empty">Chargement…</div>}
    </section>
    <style>{`
      .notifications-page{min-height:100vh;background:#f5f8fa;padding:34px;font-family:Exo,Arial,sans-serif;color:#17374c}.notifications-page header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;max-width:1180px;margin:0 auto 22px}.notifications-page header a{display:block;color:#708895;text-decoration:none;font-size:10px;font-weight:800;margin-bottom:20px}.notifications-page header span{display:block;color:#009edb;font-size:10px;font-weight:800;letter-spacing:.14em}.notifications-page h1{font-size:38px;margin:4px 0 6px}.notifications-page header p{margin:0;color:#657d8b;font-size:13px}.notifications-page .count{min-width:125px;background:white;border:1px solid #dce8ee;border-radius:18px;padding:16px;text-align:center}.notifications-page .count strong{display:block;color:#004f9f;font-size:28px}.notifications-page .count span{font-size:9px;color:#8295a1;letter-spacing:.08em}.toolbar{max-width:1180px;margin:0 auto 14px;display:flex;gap:8px;align-items:center}.toolbar button{border:1px solid #d4e1e8;background:white;color:#557180;border-radius:11px;padding:10px 13px;font:800 9px Exo,Arial,sans-serif;cursor:pointer;transition:.16s ease}.toolbar button:hover:not(:disabled){border-color:#9fcce4;color:#004f9f}.toolbar button.active{background:#004f9f;border-color:#004f9f;color:white}.toolbar button:disabled{opacity:.42;cursor:not-allowed}.toolbar .purge{margin-left:auto;color:#6e8390}.toolbar .purge:not(:disabled):hover{border-color:#eb5b56;color:#c84d49;background:#fff8f8}.toolbar .refresh{margin-left:0}.error{max-width:1180px;margin:0 auto 14px;padding:11px 13px;border:1px solid #efc0bd;border-radius:11px;background:#fff7f6;color:#a84743;font-size:10px;font-weight:700}.list{max-width:1180px;margin:0 auto;display:grid;gap:9px}.list article{display:flex;align-items:center;gap:14px;background:white;border:1px solid #dde8ee;border-radius:16px;padding:16px 18px;box-shadow:0 4px 16px rgba(24,61,82,.04)}.list article>i{width:10px;height:10px;border-radius:50%;background:#009edb;flex:0 0 auto}.list article.warning>i{background:#e9a324}.list article.critical>i{background:#dc4f4f}.list article.resolved{opacity:.58}.list .main{flex:1;min-width:0}.list .main>div{display:flex;gap:8px;align-items:center}.list .main span{font-size:8px;font-weight:800;letter-spacing:.12em;color:#8095a2}.list .main b{font-size:8px;color:#4f8d67;background:#edf7f0;padding:3px 6px;border-radius:7px}.list .main b.read{color:#477184;background:#edf6fa}.list h2{font-size:15px;margin:4px 0}.list p{font-size:12px;color:#536e7e;margin:0 0 5px;line-height:1.45}.list small{font-size:9px;color:#8a9ca6}.actions{display:flex;align-items:center;gap:9px}.actions>a{text-decoration:none;color:#004f9f;font-size:9px;font-weight:800;white-space:nowrap}.delete{width:34px;height:34px;display:grid;place-items:center;border:1px solid #dce7ed;border-radius:10px;background:#f9fbfc;color:#718996;cursor:pointer;transition:.16s ease}.delete:hover:not(:disabled){border-color:#efb4b1;background:#fff6f5;color:#d9534f}.delete:disabled{opacity:.4}.delete svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.empty{padding:60px;text-align:center;color:#81939e}.empty strong,.empty span{display:block}.empty strong{color:#004f9f;font-size:16px}.empty span{margin-top:5px;font-size:11px}@media(max-width:700px){.notifications-page{padding:20px 14px}.notifications-page header{align-items:flex-start}.notifications-page h1{font-size:30px}.notifications-page .count{min-width:90px}.toolbar{flex-wrap:wrap}.toolbar .purge{margin-left:0}.toolbar .refresh{margin-left:auto}.list article{align-items:flex-start}.actions>a{display:none}.delete{width:32px;height:32px}}
    `}</style>
  </main>;
}
