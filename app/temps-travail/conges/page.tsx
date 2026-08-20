"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Person={employeeKey:string;name:string;matricule?:string|null;team?:string|null;service?:string|null;sector?:string|null;jobTitle?:string|null};
type LeaveRequest={id:string;employeeKey:string;employeeName:string;team?:string|null;service?:string|null;sector?:string|null;startDate:string;endDate:string;status:"pending"|"approved"|"refused"|"cancelled";requestComment?:string|null;requestedBy:string;submittedAt:string;decisionBy?:string|null;decisionComment?:string|null;decidedAt?:string|null;canDecide?:boolean};
type CalendarDay={date:string;weekend:boolean;total:number;unavailable:number;approvedLeave:number;pendingLeave:number;remaining:number;remainingIfAccepted:number;remainingPct:number|null;remainingIfAcceptedPct:number|null;risk:"ok"|"warning"|"critical"|"unknown"};
type ShiftDay={date:string;team:string;total:number;unavailable:number;pendingLeave:number;remaining:number;remainingIfAccepted:number;remainingIfAcceptedPct:number|null;risk:string};
type Payload={connected:boolean;from:string;to:string;team?:string|null;sector?:string|null;people:Person[];requests:LeaveRequest[];calendar:CalendarDay[];shiftComparison:ShiftDay[];teamOptions:string[];sectorOptions:string[];summary:{pending:number;approved:number;refused:number};rules:{warningRemainingPct:number;criticalRemainingPct:number};access:{role:string;profile:string;level?:string|null;positionKey?:string|null;canRequest:boolean;canDecide:boolean;teams:string[];sectors:string[]};organization?:{positionKey:string;name:string;title:string;parent?:string|null;teams:string[];sectors:string[]}|null;error?:string};

const SECTOR_LABEL:Record<string,string>={expertise:"Expertise",mecanique:"Mécanique",dsp:"DSP",carrosserie:"Carrosserie",preparation:"Préparation",qualite:"Qualité",jantes:"Jantes",jockey:"Jockey",magasin:"Magasin / MPR",admin:"Administratif",encadrement:"Encadrement",autre:"Autre"};
const STATUS_LABEL:Record<string,string>={pending:"En attente",approved:"Accepté",refused:"Refusé",cancelled:"Annulé"};
const PROD_SECTORS=new Set(["expertise","mecanique","dsp","carrosserie","preparation","qualite","jantes"]);

function parisToday(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function pad(value:number){return String(value).padStart(2,"0");}
function monthKey(date:string){return date.slice(0,7);}
function monthBounds(key:string){const[y,m]=key.split("-").map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${y}-${pad(m)}-01`,to:`${y}-${pad(m)}-${pad(last)}`};}
function addMonth(key:string,delta:number){const[y,m]=key.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;}
function displayMonth(key:string){const[y,m]=key.split("-").map(Number);return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(y,m-1,1)));}
function displayDate(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function dayLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function pct(value:number|null){return value==null?"—":`${Math.round(value)} %`;}

export default function LeavePlanningPage(){
  const today=parisToday();
  const[month,setMonth]=useState(monthKey(today));
  const[team,setTeam]=useState("*");const[sector,setSector]=useState("*");
  const[data,setData]=useState<Payload|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState("");const[notice,setNotice]=useState("");
  const[employeeKey,setEmployeeKey]=useState("");const[startDate,setStartDate]=useState(today);const[endDate,setEndDate]=useState(today);const[comment,setComment]=useState("");const[saving,setSaving]=useState(false);
  const[decisionComments,setDecisionComments]=useState<Record<string,string>>({});const[deciding,setDeciding]=useState<string|null>(null);
  const bounds=useMemo(()=>monthBounds(month),[month]);

  async function load(nextMonth=month,nextTeam=team,nextSector=sector){
    const range=monthBounds(nextMonth);setLoading(true);setError("");
    try{
      const params=new URLSearchParams({from:range.from,to:range.to});if(nextTeam!=="*")params.set("team",nextTeam);if(nextSector!=="*")params.set("sector",nextSector);
      const response=await fetch(`/api/worktime/leave?${params.toString()}&_=${Date.now()}`,{cache:"no-store"});const payload=await response.json() as Payload;
      if(!response.ok)throw new Error(payload.error||"Chargement impossible.");setData(payload);
    }catch(cause){setError(cause instanceof Error?cause.message:"Chargement impossible.");}finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  const people=useMemo(()=>data?.people??[],[data]);
  useEffect(()=>{if(employeeKey&&!people.some(p=>p.employeeKey===employeeKey))setEmployeeKey("");},[people,employeeKey]);

  const calendarMap=useMemo(()=>new Map((data?.calendar??[]).map(row=>[row.date,row])),[data]);
  const leading=useMemo(()=>{const d=new Date(`${bounds.from}T12:00:00Z`);return (d.getUTCDay()+6)%7;},[bounds.from]);
  const calendarCells=useMemo(()=>[...Array.from({length:leading},()=>null),...(data?.calendar??[])],[data,leading]);
  const draftRows=useMemo(()=>startDate&&endDate?(data?.calendar??[]).filter(row=>row.date>=startDate&&row.date<=endDate&&!row.weekend):[],[data,startDate,endDate]);
  const draftCapacity=useMemo(()=>{
    if(!draftRows.length)return null;let minRemaining=Infinity,minPct=Infinity,worst:"ok"|"warning"|"critical"="ok";
    for(const row of draftRows){const next=Math.max(0,row.remainingIfAccepted-1);const nextPct=row.total?100*next/row.total:100;minRemaining=Math.min(minRemaining,next);minPct=Math.min(minPct,nextPct);if(nextPct<(data?.rules.criticalRemainingPct??70))worst="critical";else if(nextPct<(data?.rules.warningRemainingPct??80)&&worst!=="critical")worst="warning";}
    return{minRemaining,minPct,worst};
  },[draftRows,data]);

  const comparePeriod=useMemo(()=>{const rows=data?.shiftComparison??[];if(!rows.length)return[];const from=startDate&&endDate?startDate:bounds.from;const to=startDate&&endDate?endDate:bounds.to;return["A","B","C"].map(teamCode=>{const list=rows.filter(r=>r.team===teamCode&&r.date>=from&&r.date<=to&&!calendarMap.get(r.date)?.weekend);if(!list.length)return{team:teamCode,total:0,minRemaining:0,minPct:null as number|null,risk:"unknown"};return{team:teamCode,total:Math.max(...list.map(r=>r.total)),minRemaining:Math.min(...list.map(r=>r.remainingIfAccepted)),minPct:Math.min(...list.map(r=>r.remainingIfAcceptedPct??100)),risk:list.some(r=>r.risk==="critical")?"critical":list.some(r=>r.risk==="warning")?"warning":"ok"};}),[data,startDate,endDate,bounds,calendarMap]);

  const pendingRequests=useMemo(()=>[...(data?.requests??[])].sort((a,b)=>a.status===b.status?a.startDate.localeCompare(b.startDate):a.status==="pending"?-1:b.status==="pending"?1:0),[data]);
  const criticalDays=useMemo(()=>(data?.calendar??[]).filter(d=>!d.weekend&&d.risk==="critical").length,[data]);
  const minCapacity=useMemo(()=>{const rows=(data?.calendar??[]).filter(d=>!d.weekend&&d.total>0);return rows.length?rows.reduce((a,b)=>(a.remainingIfAcceptedPct??101)<=(b.remainingIfAcceptedPct??101)?a:b):null;},[data]);

  function changeFilter(nextTeam:string,nextSector:string){setTeam(nextTeam);setSector(nextSector);void load(month,nextTeam,nextSector);}
  function changeMonth(next:string){setMonth(next);const range=monthBounds(next);if(startDate<range.from||startDate>range.to){setStartDate(range.from);setEndDate(range.from);}void load(next,team,sector);}

  async function submit(event:FormEvent){event.preventDefault();if(!employeeKey||!startDate||!endDate)return;setSaving(true);setError("");setNotice("");try{const response=await fetch("/api/worktime/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"submit",employeeKey,startDate,endDate,comment})});const payload=await response.json() as{error?:string};if(!response.ok)throw new Error(payload.error||"Enregistrement impossible.");setNotice("Souhait enregistré et transmis au N+1.");setComment("");await load();}catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}finally{setSaving(false);}}
  async function decide(id:string,decision:"approve"|"refuse"){const decisionComment=(decisionComments[id]??"").trim();if(decision==="refuse"&&!decisionComment){setError("Ajoute un commentaire pour expliquer le refus.");return;}setDeciding(id);setError("");setNotice("");try{const response=await fetch("/api/worktime/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"decide",id,decision,comment:decisionComment||null})});const payload=await response.json() as{error?:string};if(!response.ok)throw new Error(payload.error||"Décision impossible.");setNotice(decision==="approve"?"Souhait de CP accepté.":"Souhait de CP refusé.");setDecisionComments(current=>({...current,[id]:""}));await load();}catch(cause){setError(cause instanceof Error?cause.message:"Décision impossible.");}finally{setDeciding(null);}}

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>Temps de travail · planification</p><h1>Souhaits de CP</h1><p>Un calendrier simple pour déposer les souhaits, mesurer la capacité restante et décider au bon niveau hiérarchique.</p></div>
      <div className={styles.heroMeta}><strong>{data?.organization?.title??(data?.access.profile==="hr"?"Ressources humaines":"Vue management")}</strong><span>{data?.organization?.name??"Périmètre autorisé"}</span></div>
    </section>

    {error&&<div className={styles.error}>{error}</div>}{notice&&<div className={styles.notice}>{notice}</div>}

    <section className={styles.toolbar}>
      <div className={styles.monthNav}><button onClick={()=>changeMonth(addMonth(month,-1))} aria-label="Mois précédent">‹</button><strong>{displayMonth(month)}</strong><button onClick={()=>changeMonth(addMonth(month,1))} aria-label="Mois suivant">›</button></div>
      <label>Équipe<select value={team} onChange={e=>changeFilter(e.target.value,sector)}><option value="*">Toutes</option>{(data?.teamOptions??[]).map(value=><option key={value} value={value}>Équipe {value}</option>)}</select></label>
      <label>Secteur<select value={sector} onChange={e=>changeFilter(team,e.target.value)}><option value="*">Tous</option>{(data?.sectorOptions??[]).map(value=><option key={value} value={value}>{SECTOR_LABEL[value]??value}</option>)}</select></label>
      <button className={styles.refresh} onClick={()=>void load()} disabled={loading}>{loading?"Actualisation…":"Actualiser"}</button>
    </section>

    <section className={styles.kpis}>
      <article><span>Demandes en attente</span><strong>{data?.summary.pending??0}</strong><small>à arbitrer sur la période</small></article>
      <article><span>CP validés</span><strong>{data?.summary.approved??0}</strong><small>souhaits acceptés</small></article>
      <article data-risk={minCapacity?.risk??"unknown"}><span>Capacité minimale</span><strong>{minCapacity?`${minCapacity.remainingIfAccepted}/${minCapacity.total}`:"—"}</strong><small>{minCapacity?pct(minCapacity.remainingIfAcceptedPct):"aucune donnée"}</small></article>
      <article data-risk={criticalDays?"critical":"ok"}><span>Jours critiques</span><strong>{criticalDays}</strong><small>seuil &lt; {data?.rules.criticalRemainingPct??70} %</small></article>
    </section>

    <div className={styles.grid}>
      <section className={styles.calendarCard}>
        <div className={styles.cardHead}><div><h2>Calendrier équipe</h2><p>Capacité disponible après absences connues et souhaits déjà en attente.</p></div><div className={styles.legend}><span data-risk="ok">Confortable</span><span data-risk="warning">À surveiller</span><span data-risk="critical">Critique</span></div></div>
        <div className={styles.weekdays}>{["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(day=><span key={day}>{day}</span>)}</div>
        <div className={styles.calendar}>{calendarCells.map((row,index)=>row===null?<div className={styles.blank} key={`blank-${index}`}/>:<article className={styles.day} data-risk={row.risk} data-weekend={row.weekend} key={row.date}><header><strong>{dayLabel(row.date)}</strong><span>{row.remainingIfAccepted}/{row.total}</span></header><div className={styles.capacityBar}><i style={{width:`${Math.max(0,Math.min(100,row.remainingIfAcceptedPct??0))}%`}}/></div><p><b>{row.approvedLeave}</b> CP · <b>{row.pendingLeave}</b> souhait{row.pendingLeave>1?"s":""}</p>{row.unavailable>row.approvedLeave&&<small>{row.unavailable-row.approvedLeave} autre{row.unavailable-row.approvedLeave>1?"s":""} absence{row.unavailable-row.approvedLeave>1?"s":""}</small>}</article>)}</div>
      </section>

      <aside className={styles.side}>
        {data?.access.canRequest&&<form className={styles.requestCard} onSubmit={submit}><div className={styles.cardHead}><div><h2>Déposer un souhait</h2><p>La demande part automatiquement au N+1.</p></div></div><label>Collaborateur<select value={employeeKey} onChange={e=>setEmployeeKey(e.target.value)} required><option value="">Choisir…</option>{people.map(person=><option value={person.employeeKey} key={person.employeeKey}>{person.name}{person.team?` · ${person.team}`:""}</option>)}</select></label><div className={styles.twoCols}><label>Du<input type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);if(endDate<e.target.value)setEndDate(e.target.value);}} required/></label><label>Au<input type="date" value={endDate} min={startDate} onChange={e=>setEndDate(e.target.value)} required/></label></div><label>Commentaire<textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Contrainte personnelle, priorité, précision utile…" rows={3}/></label>{draftCapacity&&<div className={styles.preview} data-risk={draftCapacity.worst}><span>Si ce souhait est accepté</span><strong>minimum {draftCapacity.minRemaining} présents · {Math.round(draftCapacity.minPct)} %</strong><small>{draftCapacity.worst==="critical"?"Capacité critique sur au moins une journée":draftCapacity.worst==="warning"?"Période à surveiller":"Capacité compatible"}</small></div>}<button className={styles.primary} disabled={saving||!employeeKey}>{saving?"Envoi…":"Soumettre au N+1"}</button></form>}

        {sector!=="*"&&PROD_SECTORS.has(sector)&&comparePeriod.length>0&&<section className={styles.compareCard}><div className={styles.cardHead}><div><h2>Comparaison shifts</h2><p>{SECTOR_LABEL[sector]??sector} · minimum sur la période sélectionnée</p></div></div><div className={styles.shiftList}>{comparePeriod.map(item=><div key={item.team} data-risk={item.risk}><span>Shift {item.team}</span><strong>{item.minRemaining}/{item.total}</strong><small>{pct(item.minPct)}</small></div>)}</div></section>}
      </aside>
    </div>

    <section className={styles.requestsCard}>
      <div className={styles.cardHead}><div><h2>Demandes et décisions</h2><p>Les demandes en attente restent en tête. RH et administration disposent de la même vue de suivi.</p></div></div>
      {pendingRequests.length===0?<div className={styles.empty}>Aucune demande sur cette période.</div>:<div className={styles.requests}>{pendingRequests.map(request=><article className={styles.request} data-status={request.status} key={request.id}><div className={styles.requestMain}><div><span className={styles.status}>{STATUS_LABEL[request.status]??request.status}</span><h3>{request.employeeName}</h3><p>{displayDate(request.startDate)} → {displayDate(request.endDate)} · Équipe {request.team??"—"} · {SECTOR_LABEL[request.sector??""]??request.sector??"—"}</p></div><div className={styles.requestMeta}><span>Demandé par {request.requestedBy}</span>{request.requestComment&&<em>« {request.requestComment} »</em>}{request.decisionBy&&<span>Décision : {request.decisionBy}</span>}{request.decisionComment&&<em>« {request.decisionComment} »</em>}</div></div>{request.status==="pending"&&request.canDecide&&<div className={styles.decision}><input value={decisionComments[request.id]??""} onChange={e=>setDecisionComments(current=>({...current,[request.id]:e.target.value}))} placeholder="Commentaire de décision (obligatoire en cas de refus)"/><button className={styles.accept} disabled={deciding===request.id} onClick={()=>void decide(request.id,"approve")}>Accepter</button><button className={styles.refuse} disabled={deciding===request.id} onClick={()=>void decide(request.id,"refuse")}>Refuser</button></div>}</article>)}</div>}
    </section>
  </main>;
}
