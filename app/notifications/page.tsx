"use client";

import { useEffect, useMemo, useState } from "react";

type NotificationRow={id:string;kind:string;severity:"info"|"warning"|"critical";title:string;message:string;workDate?:string|null;team?:string|null;sector?:string|null;createdAt:string;resolvedAt?:string|null;read:boolean;metadata?:Record<string,unknown>};
type Payload={notifications:NotificationRow[];unread:number;error?:string};

function dateTime(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}

export default function NotificationsPage(){
  const[data,setData]=useState<Payload>({notifications:[],unread:0});
  const[loading,setLoading]=useState(true);
  const[filter,setFilter]=useState<"active"|"all">("active");

  async function load(){setLoading(true);try{const r=await fetch(`/api/notifications?limit=100&_=${Date.now()}`,{cache:"no-store"});const p=await r.json() as Payload;setData(p);}finally{setLoading(false);}}
  useEffect(()=>{void load();void fetch("/api/notifications",{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"});},[]);
  const rows=useMemo(()=>filter==="active"?data.notifications.filter(item=>!item.resolvedAt):data.notifications,[data.notifications,filter]);

  return <main className="notifications-page">
    <header><div><a href="/">← TABLEAU DE BORD</a><span>CENTRE D’ALERTES</span><h1>Notifications</h1><p>Suivi des oublis de clôture, alertes de fin de poste et actions à traiter.</p></div><div className="count"><strong>{data.unread}</strong><span>NON LUE(S)</span></div></header>
    <section className="toolbar"><button className={filter==="active"?"active":""} onClick={()=>setFilter("active")}>ACTIVES</button><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>TOUTES</button><button onClick={()=>void load()}>ACTUALISER</button></section>
    <section className="list">
      {rows.map(item=><article key={item.id} className={`${item.severity} ${item.resolvedAt?"resolved":""}`}>
        <i/><div className="main"><div><span>{item.kind==="worktime_missing_validation"?"TEMPS DE TRAVAIL":"ALERTE"}</span>{item.resolvedAt&&<b>RÉSOLUE</b>}</div><h2>{item.title}</h2><p>{item.message}</p><small>{dateTime(item.createdAt)}{item.workDate?` · journée ${item.workDate}`:""}{item.team?` · équipe ${item.team}`:""}{item.sector?` · ${item.sector}`:""}</small></div>
        <a href="/temps-travail">OUVRIR →</a>
      </article>)}
      {!loading&&!rows.length&&<div className="empty">Aucune notification dans ce filtre.</div>}
      {loading&&<div className="empty">Chargement…</div>}
    </section>
    <style>{`
      .notifications-page{min-height:100vh;background:#f5f8fa;padding:34px;font-family:Exo,Arial,sans-serif;color:#17374c}.notifications-page header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;max-width:1180px;margin:0 auto 22px}.notifications-page header a{display:block;color:#708895;text-decoration:none;font-size:10px;font-weight:800;margin-bottom:20px}.notifications-page header span{display:block;color:#009edb;font-size:10px;font-weight:800;letter-spacing:.14em}.notifications-page h1{font-size:38px;margin:4px 0 6px}.notifications-page header p{margin:0;color:#657d8b;font-size:13px}.notifications-page .count{min-width:125px;background:white;border:1px solid #dce8ee;border-radius:18px;padding:16px;text-align:center}.notifications-page .count strong{display:block;color:#004f9f;font-size:28px}.notifications-page .count span{font-size:9px;color:#8295a1;letter-spacing:.08em}.toolbar{max-width:1180px;margin:0 auto 14px;display:flex;gap:8px}.toolbar button{border:1px solid #d4e1e8;background:white;color:#557180;border-radius:11px;padding:10px 13px;font:800 9px Exo,Arial,sans-serif;cursor:pointer}.toolbar button.active{background:#004f9f;border-color:#004f9f;color:white}.toolbar button:last-child{margin-left:auto}.list{max-width:1180px;margin:0 auto;display:grid;gap:9px}.list article{display:flex;align-items:center;gap:14px;background:white;border:1px solid #dde8ee;border-radius:16px;padding:16px 18px;box-shadow:0 4px 16px rgba(24,61,82,.04)}.list article>i{width:10px;height:10px;border-radius:50%;background:#009edb;flex:0 0 auto}.list article.warning>i{background:#e9a324}.list article.critical>i{background:#dc4f4f}.list article.resolved{opacity:.58}.list .main{flex:1;min-width:0}.list .main>div{display:flex;gap:8px;align-items:center}.list .main span{font-size:8px;font-weight:800;letter-spacing:.12em;color:#8095a2}.list .main b{font-size:8px;color:#4f8d67;background:#edf7f0;padding:3px 6px;border-radius:7px}.list h2{font-size:15px;margin:4px 0}.list p{font-size:12px;color:#536e7e;margin:0 0 5px;line-height:1.45}.list small{font-size:9px;color:#8a9ca6}.list article>a{text-decoration:none;color:#004f9f;font-size:9px;font-weight:800;white-space:nowrap}.empty{padding:60px;text-align:center;color:#81939e}@media(max-width:700px){.notifications-page{padding:20px 14px}.notifications-page header{align-items:flex-start}.notifications-page h1{font-size:30px}.notifications-page .count{min-width:90px}.list article{align-items:flex-start}.list article>a{display:none}}
    `}</style>
  </main>;
}
