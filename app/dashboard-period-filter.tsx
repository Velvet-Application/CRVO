"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Production={name:string;value:number;tone:string};
type Snapshot={date:string;label:string;source:string;entries:number;exits:number;stock:number;over15:number;over20:number;production:Production[]};
type DashboardPayload={snapshot?:Snapshot;snapshots?:Snapshot[];connected?:boolean;error?:string};

function isoToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function fmt(value:number,digits=0){return Number(value).toLocaleString("fr-FR",{maximumFractionDigits:digits});}
function dateLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function hideNativeSummary(host:HTMLElement,active:boolean){
  for(const child of Array.from(host.children)){
    if(!(child instanceof HTMLElement)||child.id==="dashboard-period-summary"||child.tagName!=="SECTION")continue;
    if(active){
      if(child.dataset.periodHidden!=="1")child.dataset.periodPreviousDisplay=child.style.display;
      child.dataset.periodHidden="1";
      child.style.display="none";
    }else if(child.dataset.periodHidden==="1"){
      child.style.display=child.dataset.periodPreviousDisplay??"";
      delete child.dataset.periodHidden;
      delete child.dataset.periodPreviousDisplay;
    }
  }
}

export default function DashboardPeriodFilter(){
  const[host,setHost]=useState<HTMLElement|null>(null);
  const[active,setActive]=useState(false);
  const[snapshots,setSnapshots]=useState<Snapshot[]>([]);
  const[from,setFrom]=useState("");
  const[to,setTo]=useState("");
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");

  useEffect(()=>{
    const sync=()=>{
      const nextHost=document.querySelector<HTMLElement>(".main-workspace header + div");
      const nextActive=Boolean(document.getElementById("nav-yesterday")?.classList.contains("active"));
      if(nextHost!==host)setHost(nextHost);
      setActive(nextActive);
      if(nextHost)hideNativeSummary(nextHost,nextActive);
    };
    sync();
    const timer=window.setInterval(sync,250);
    return()=>{window.clearInterval(timer);if(host)hideNativeSummary(host,false);};
  },[host]);

  useEffect(()=>{
    if(!active)return;
    let cancelled=false;
    const load=async()=>{
      setLoading(true);setError("");
      try{
        const response=await fetch("/api/dashboard?history=1",{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
        const payload=await response.json().catch(()=>({})) as DashboardPayload;
        if(!response.ok)throw new Error(payload.error||"Historique du dashboard indisponible.");
        const rows=[...(payload.snapshots??(payload.snapshot?[payload.snapshot]:[]))].sort((a,b)=>a.date.localeCompare(b.date));
        if(cancelled)return;
        setSnapshots(rows);
        if(rows.length&&!from&&!to){
          const today=isoToday();
          const closed=[...rows].reverse().find(row=>row.date<today)??rows.at(-1)!;
          const sameMonth=rows.filter(row=>row.date.slice(0,7)===closed.date.slice(0,7)&&row.date<=closed.date);
          setFrom(sameMonth[0]?.date??closed.date);
          setTo(closed.date);
        }
      }catch(reason){if(!cancelled)setError(reason instanceof Error?reason.message:"Historique du dashboard indisponible.");}
      finally{if(!cancelled)setLoading(false);}
    };
    void load();
    const timer=window.setInterval(()=>void load(),60000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[active,from,to]);

  const availableMin=snapshots[0]?.date??"";
  const availableMax=snapshots.at(-1)?.date??"";
  const selected=useMemo(()=>snapshots.filter(row=>(!from||row.date>=from)&&(!to||row.date<=to)),[snapshots,from,to]);
  const model=useMemo(()=>{
    if(!selected.length)return null;
    const last=selected.at(-1)!;
    const previous=snapshots.filter(row=>row.date<(selected[0]?.date??"" )).at(-1)??null;
    const entries=selected.reduce((sum,row)=>sum+row.entries,0);
    const exits=selected.reduce((sum,row)=>sum+row.exits,0);
    const names=Array.from(new Set(selected.flatMap(row=>row.production.map(item=>item.name))));
    const production=names.map(name=>({name,total:selected.reduce((sum,row)=>sum+(row.production.find(item=>item.name===name)?.value??0),0)}));
    return{last,previous,entries,exits,days:selected.length,avgExits:exits/selected.length,stockDelta:previous?last.stock-previous.stock:null,oldDelta:previous?last.over20-previous.over20:null,production};
  },[selected,snapshots]);

  function chooseLast(days:number){
    if(!snapshots.length)return;
    const today=isoToday();
    const closed=snapshots.filter(row=>row.date<today);
    const base=closed.length?closed:snapshots;
    const slice=base.slice(-days);
    if(slice.length){setFrom(slice[0].date);setTo(slice.at(-1)!.date);}
  }
  function chooseMonth(){
    if(!snapshots.length)return;
    const today=isoToday();
    const closed=[...snapshots].reverse().find(row=>row.date<today)??snapshots.at(-1)!;
    const rows=snapshots.filter(row=>row.date.slice(0,7)===closed.date.slice(0,7)&&row.date<=closed.date);
    if(rows.length){setFrom(rows[0].date);setTo(rows.at(-1)!.date);}
  }
  function chooseAll(){if(snapshots.length){setFrom(snapshots[0].date);setTo(snapshots.at(-1)!.date);}}

  if(!host||!active)return null;
  return createPortal(<div id="dashboard-period-summary">
    <section className="dpf-filter">
      <div><span>FILTRE DE PÉRIODE</span><strong>Dashboard historique</strong><small>Les flux et productions sont cumulés sur la période. Le stock et le vieillissement correspondent à la dernière journée sélectionnée.</small></div>
      <div className="dpf-fields">
        <label>Du<input type="date" min={availableMin||undefined} max={to||availableMax||undefined} value={from} onChange={event=>{const value=event.target.value;setFrom(value);if(to&&value>to)setTo(value);}}/></label>
        <label>Au<input type="date" min={from||availableMin||undefined} max={availableMax||undefined} value={to} onChange={event=>{const value=event.target.value;setTo(value);if(from&&value<from)setFrom(value);}}/></label>
      </div>
      <div className="dpf-presets"><button onClick={()=>chooseLast(5)}>5 jours</button><button onClick={()=>chooseLast(10)}>10 jours</button><button onClick={chooseMonth}>Mois</button><button onClick={chooseAll}>Tout</button></div>
    </section>

    {error&&<div className="dpf-error">{error}</div>}
    {loading&&!model&&<div className="dpf-loading">Chargement de l'historique réel…</div>}
    {!loading&&!model&&!error&&<div className="dpf-loading">Aucune journée disponible sur cette période.</div>}
    {model&&<>
      <section className="dpf-hero"><div><span>SYNTHÈSE OPÉRATIONNELLE</span><h2>{selected.length===1?dateLabel(selected[0].date):`${dateLabel(selected[0].date)} → ${dateLabel(selected.at(-1)!.date)}`}</h2><p>{model.days} journée{model.days>1?"s":""} enregistrée{model.days>1?"s":""}. Les volumes sont calculés uniquement à partir des données réelles présentes dans le KPI.</p></div><div><small>DERNIÈRE JOURNÉE</small><strong>{model.last.label}</strong><small>SOURCE</small><strong>{model.last.source}</strong></div></section>
      <section className="dpf-kpis">
        <article><span>ENTRÉES CUMULÉES</span><strong>{fmt(model.entries)}</strong><small>{fmt(model.entries/model.days,1)} / jour</small></article>
        <article><span>SORTIES CUMULÉES</span><strong>{fmt(model.exits)}</strong><small>{fmt(model.avgExits,1)} / jour</small></article>
        <article><span>STOCK FIN DE PÉRIODE</span><strong>{fmt(model.last.stock)}</strong><small>{model.stockDelta==null?"pas de référence antérieure":`${model.stockDelta>0?"+":""}${fmt(model.stockDelta)} vs début de période`}</small></article>
        <article><span>STOCK &gt;20 J</span><strong>{fmt(model.last.over20)}</strong><small>{model.oldDelta==null?`${fmt(model.last.stock?model.last.over20/model.last.stock*100:0,1)} % du parc`:`${model.oldDelta>0?"+":""}${fmt(model.oldDelta)} vs début de période`}</small></article>
      </section>
      <section className="dpf-section"><div className="dpf-head"><div><span>PRODUCTION</span><h3>Cumul et moyenne par jour</h3></div><p>Le filtre agit immédiatement sur l'ensemble des chiffres du Dashboard.</p></div><div className="dpf-grid">{model.production.map(item=><article key={item.name}><span>{item.name.toUpperCase()}</span><strong>{fmt(item.total)}</strong><small>{fmt(item.total/model.days,1)} / jour · {model.days} j</small></article>)}</div></section>
    </>}
    <style>{`
      #dashboard-period-summary{display:grid;gap:16px}.dpf-filter{padding:16px 18px;display:grid;grid-template-columns:minmax(260px,1fr) auto auto;align-items:end;gap:18px;border:1px solid #dbe6ee;background:#fff}.dpf-filter>div:first-child>span,.dpf-head span{display:block;color:#009edb;font-size:8px;font-weight:900;letter-spacing:.12em}.dpf-filter>div:first-child>strong{display:block;margin-top:4px;color:#004f9f;font-size:18px;font-style:italic}.dpf-filter>div:first-child>small{display:block;margin-top:5px;max-width:650px;color:#718797;font-size:9px;line-height:1.45}.dpf-fields{display:flex;gap:8px}.dpf-fields label{display:grid;gap:4px;color:#60798a;font-size:8px;font-weight:800}.dpf-fields input{height:38px;padding:0 10px;border:1px solid #cddce6;border-radius:7px;background:#f9fcfd;color:#17364d;font:700 10px Exo,Arial,sans-serif}.dpf-presets{display:flex;gap:6px}.dpf-presets button{height:38px;padding:0 11px;border:1px solid #cddce6;border-radius:7px;background:#f7fbfd;color:#315c76;font:800 8px Exo,Arial,sans-serif;cursor:pointer}.dpf-presets button:hover{border-color:#009edb;color:#004f9f}.dpf-hero{padding:26px 30px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:24px;color:#fff;background:linear-gradient(112deg,#004f9f,#006ab9);position:relative;overflow:hidden}.dpf-hero:after{content:"";position:absolute;width:360px;height:360px;right:-110px;top:-120px;border:48px solid rgba(255,255,255,.07);border-radius:50%}.dpf-hero>div{position:relative;z-index:1}.dpf-hero span{display:block;color:#8be1ff;font-size:9px;font-weight:800;letter-spacing:.14em}.dpf-hero h2{margin:5px 0 0;font-size:29px;line-height:1.05;font-weight:800;font-style:italic}.dpf-hero p{margin:9px 0 0;max-width:720px;color:rgba(255,255,255,.74);font-size:10px;line-height:1.5}.dpf-hero>div:last-child{min-width:215px;padding:14px 17px;border:1px solid rgba(255,255,255,.2);background:rgba(0,37,76,.18)}.dpf-hero>div:last-child small,.dpf-hero>div:last-child strong{display:block}.dpf-hero>div:last-child small{margin-top:7px;color:#8be1ff;font-size:7px}.dpf-hero>div:last-child small:first-child{margin-top:0}.dpf-hero>div:last-child strong{margin-top:3px;font-size:11px}.dpf-kpis{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #dbe6ee;background:#fff}.dpf-kpis article{min-height:122px;padding:19px 21px;border-right:1px solid #dbe6ee}.dpf-kpis article:last-child{border-right:0}.dpf-kpis span,.dpf-grid span{display:block;color:#718797;font-size:8px;font-weight:800;letter-spacing:.08em}.dpf-kpis strong{display:block;margin-top:8px;color:#004f9f;font-size:34px;line-height:1;font-weight:800;font-style:italic}.dpf-kpis small,.dpf-grid small{display:block;margin-top:7px;color:#8194a0;font-size:9px}.dpf-section{margin-top:2px}.dpf-head{margin-bottom:11px;display:flex;justify-content:space-between;align-items:end;gap:18px}.dpf-head h3{margin:4px 0 0;color:#004f9f;font-size:21px;font-weight:800;font-style:italic}.dpf-head p{margin:0;color:#718797;font-size:9px}.dpf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}.dpf-grid article{padding:17px;border:1px solid #dbe6ee;border-radius:9px;background:#fff;box-shadow:0 7px 22px rgba(24,62,86,.04)}.dpf-grid strong{display:block;margin-top:6px;color:#17364d;font-size:22px}.dpf-error,.dpf-loading{padding:16px 18px;border:1px solid #dbe6ee;background:#fff;color:#718797;font-size:10px}.dpf-error{border-left:4px solid #eb5b56;color:#8b3331}@media(max-width:1050px){.dpf-filter{grid-template-columns:1fr}.dpf-fields,.dpf-presets{justify-content:flex-start}.dpf-kpis,.dpf-grid{grid-template-columns:repeat(2,1fr)}.dpf-kpis article:nth-child(2){border-right:0}.dpf-kpis article:nth-child(-n+2){border-bottom:1px solid #dbe6ee}}@media(max-width:760px){.dpf-filter{padding:14px}.dpf-fields{display:grid;grid-template-columns:1fr 1fr}.dpf-presets{display:grid;grid-template-columns:repeat(4,1fr)}.dpf-hero{grid-template-columns:1fr;padding:21px 18px}.dpf-kpis,.dpf-grid{grid-template-columns:1fr}.dpf-kpis article{border-right:0;border-bottom:1px solid #dbe6ee}.dpf-kpis article:last-child{border-bottom:0}.dpf-head{align-items:flex-start;flex-direction:column}}
    `}</style>
  </div>,host);
}
