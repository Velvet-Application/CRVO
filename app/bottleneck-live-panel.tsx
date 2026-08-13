"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Point = { date:string; value:number; source:string };
type Sector = { key:string; label:string; color:string; points:Point[]; actual:number; max:number; cadence:number; workDays:number; evolution:number; aboveMax:number };
type Payload = { latestDate:string; operationalLatestDate:string; stale:boolean; source:string; sourceMode:"ftp"|"sftp"|"book"|"embedded"; critical:number; sectors:Sector[]; windowStart?:string; windowEnd?:string; freezeRule?:string; sourceModifiedAt?:string|null };

function dateLabel(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"short", timeZone:"UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function longDate(value:string) {
  return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"long", year:"numeric", timeZone:"UTC" }).format(new Date(`${value}T12:00:00Z`));
}
function timeParis(value?:string|null) {
  if(!value) return "—";
  const parsed=new Date(value); if(Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(parsed);
}

function Trend({ sector }:{ sector:Sector }) {
  const width=1000, height=330, left=54, right=22, top=26, bottom=42;
  const usableW=width-left-right, usableH=height-top-bottom;
  const values=sector.points.map((point)=>point.value);
  const maxValue=Math.max(1, sector.max*1.18, ...values)*1.05;
  const x=(index:number)=>left+(sector.points.length<=1?0:index/(sector.points.length-1))*usableW;
  const y=(value:number)=>top+(1-value/maxValue)*usableH;
  const line=sector.points.map((point,index)=>`${index===0?"M":"L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area=sector.points.length ? `${line} L${x(sector.points.length-1)},${top+usableH} L${x(0)},${top+usableH} Z` : "";
  const thresholdY=y(sector.max);
  const latest=sector.points.at(-1);
  const gradientId=`live-area-${sector.key}`;
  return <div className="live-bottleneck-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Évolution réelle de l’encours ${sector.label}`}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sector.color} stopOpacity=".25"/><stop offset="1" stopColor={sector.color} stopOpacity=".02"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map((tick)=>{ const gy=top+usableH*tick; return <g key={tick}><line x1={left} x2={width-right} y1={gy} y2={gy} className="live-grid"/><text x={left-10} y={gy+4} textAnchor="end">{Math.round(maxValue*(1-tick))}</text></g>; })}
    <line x1={left} x2={width-right} y1={thresholdY} y2={thresholdY} className="live-threshold"/><text x={width-right} y={Math.max(top+12,thresholdY-8)} textAnchor="end" className="live-threshold-label">SEUIL MAX {sector.max}</text>
    {area && <path d={area} fill={`url(#${gradientId})`}/>} {line && <path d={line} fill="none" stroke={sector.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>}
    {sector.points.map((point,index)=><circle key={point.date} cx={x(index)} cy={y(point.value)} r={index===sector.points.length-1?5:2.2} fill={sector.color}/>) }
    {latest && <text x={x(sector.points.length-1)-7} y={Math.max(top+13,y(latest.value)-12)} textAnchor="end" className="live-last-value">{latest.value}</text>}
    {sector.points.length>0 && <text x={left} y={height-11}>{dateLabel(sector.points[0].date)}</text>}
    {sector.points.length>2 && <text x={left+usableW/2} y={height-11} textAnchor="middle">{dateLabel(sector.points[Math.floor(sector.points.length/2)].date)}</text>}
    {latest && <text x={width-right} y={height-11} textAnchor="end">{dateLabel(latest.date)}</text>}
  </svg></div>;
}

export default function BottleneckLivePanel() {
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [data,setData]=useState<Payload|null>(null);
  const [selected,setSelected]=useState("carrosserie");
  const [error,setError]=useState("");

  useEffect(()=>{
    const locate=()=>{
      const old=document.querySelector<HTMLElement>(".bottleneck-layout");
      if (!old?.parentElement) { document.body.classList.remove("crvo-live-bottlenecks"); setHost(null); return; }
      let root=document.getElementById("bottleneck-live-root");
      if (!root) { root=document.createElement("div"); root.id="bottleneck-live-root"; old.parentElement.insertBefore(root,old); }
      document.body.classList.add("crvo-live-bottlenecks"); setHost(root);
    };
    locate(); const observer=new MutationObserver(locate); observer.observe(document.body,{childList:true,subtree:true});
    return()=>{ observer.disconnect(); document.body.classList.remove("crvo-live-bottlenecks"); };
  },[]);

  useEffect(()=>{
    if (!host) return;
    let active=true;
    const load=async()=>{
      try {
        const response=await fetch(`/api/bottlenecks?_=${Date.now()}`,{cache:"no-store"});
        const payload=await response.json() as Payload & {error?:string};
        if (!response.ok) throw new Error(payload.error||"Goulots indisponibles");
        if (active) { setData(payload); setSelected((current)=>payload.sectors.some((s)=>s.key===current)?current:(payload.sectors[0]?.key||"")); setError(""); }
      } catch(reason) { if(active) setError(reason instanceof Error?reason.message:"Impossible d’actualiser les goulots"); }
    };
    void load(); const timer=window.setInterval(()=>void load(),60000);
    return()=>{ active=false; window.clearInterval(timer); };
  },[host]);

  const current=useMemo(()=>data?.sectors.find((sector)=>sector.key===selected)??data?.sectors[0]??null,[data,selected]);
  if (!host || !host.isConnected) return null;
  const sourceLabel=data?.sourceMode==="ftp"?"SOURCE FTP":data?.sourceMode==="sftp"?"SOURCE SFTP":"SOURCE BOOK";

  return createPortal(<section className="live-bottleneck-panel">
    {!data && <div className="live-bottleneck-loading">Actualisation des encours réels…</div>}
    {data && current && <>
      <div className={data.stale?"live-source stale":"live-source"}>
        <div><span>{sourceLabel}</span><strong>Jour J dynamique · {longDate(data.latestDate)}</strong></div>
        <div><small>Historique 30 jours</small><b>J-1 et antérieurs figés à 20h</b></div>
        <div><small>Dernière photo FTP</small><b>{timeParis(data.sourceModifiedAt)}</b></div>
      </div>
      {data.freezeRule && <div className="live-stale-warning" style={{borderColor:"#9fd7ea",background:"#f2fbff",color:"#27566c"}}><strong>RÈGLE DE PHOTO QUOTIDIENNE</strong><span>{data.freezeRule}</span></div>}
      {data.stale && <div className="live-stale-warning"><strong>DONNÉE ENCOURS EN RETARD</strong><span>Les goulots sont arrêtés au {longDate(data.latestDate)} alors que la production est disponible au {longDate(data.operationalLatestDate)}.</span></div>}
      <div className="live-bottleneck-grid">
        <article className="live-main-card">
          <header><div><span>SECTEUR SÉLECTIONNÉ</span><h3>{current.label}</h3></div><div className="live-kpis"><div><span>ENCOURS ACTUEL</span><strong>{current.actual}</strong></div><div><span>VS PHOTO PRÉCÉDENTE</span><strong className={current.evolution>0?"bad":"good"}>{current.evolution>0?"+":""}{current.evolution}%</strong></div><div><span>JOURS DE STOCK</span><strong>{current.workDays.toLocaleString("fr-FR",{maximumFractionDigits:2})}</strong></div></div></header>
          <Trend sector={current}/>
          <footer><span className="legend-real" style={{background:current.color}}/><b>Photos quotidiennes EtatduParc</b><i/><span>Seuil maximum configuré</span><em>J = live · clôture quotidienne = 20h</em></footer>
        </article>
        <aside className="live-priority-card"><span>LECTURE DE PILOTAGE</span><strong>{current.aboveMax}</strong><b>véhicule{current.aboveMax>1?"s":""} au-dessus du seuil</b><div><small>Seuil maximum</small><strong>{current.max}</strong></div><div><small>Cadence de référence</small><strong>{current.cadence} / jour</strong></div><p>{current.actual>current.max?`Encours supérieur au seuil de ${current.aboveMax} véhicules. À la cadence de référence, la charge représente ${current.workDays.toLocaleString("fr-FR",{maximumFractionDigits:2})} jours.`:`Encours sous le seuil maximum. Charge estimée : ${current.workDays.toLocaleString("fr-FR",{maximumFractionDigits:2})} jours.`}</p></aside>
      </div>
      <div className="live-sector-cards">{data.sectors.map((sector)=>{
        const ratio=sector.max>0?sector.actual/sector.max:0;
        return <button key={sector.key} onClick={()=>setSelected(sector.key)} className={`${selected===sector.key?"active":""} ${ratio>1.5?"danger":ratio>1?"warning":"healthy"}`}><i style={{background:sector.color}}/><div><strong>{sector.label}</strong><small>{ratio>1.5?"CRITIQUE":ratio>1?"À SURVEILLER":"MAÎTRISÉ"}</small></div><b>{sector.actual}<span>/ max {sector.max}</span></b><em className={sector.evolution>0?"up":"down"}>{sector.evolution>0?"+":""}{sector.evolution}%</em><span>{sector.workDays.toLocaleString("fr-FR",{maximumFractionDigits:2})} j</span></button>;
      })}</div>
    </>}
    {error && <div className="live-bottleneck-error">{error}</div>}
  </section>,host);
}
