"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Person={employeeKey:string;name:string;matricule?:string|null;team?:string|null;service?:string|null;sector?:string|null;jobTitle?:string|null};
type LeaveRequest={id:string;employeeKey:string;employeeName:string;team?:string|null;service?:string|null;sector?:string|null;startDate:string;endDate:string;status:"pending"|"approved"|"refused"|"cancelled";requestComment?:string|null;requestedBy:string;submittedAt:string;decisionBy?:string|null;decisionComment?:string|null;decidedAt?:string|null;canDecide?:boolean};
type RiskLevel="ok"|"warning"|"critical"|"unknown";
type CalendarDay={date:string;weekend:boolean;total:number;unavailable:number;approvedLeave:number;pendingLeave:number;remaining:number;remainingIfAccepted:number;remainingPct:number|null;remainingIfAcceptedPct:number|null;productiveTotal?:number;productiveRemainingIfAccepted?:number;requiredVolume?:number|null;capacityVehicles?:number|null;loadPct?:number|null;riskPct?:number|null;risk:RiskLevel;riskBasis?:"activity"|"site";targetSource?:string|null;capacityReferenceHours?:number|null};
type ShiftDay={date:string;team:string;total:number;unavailable:number;pendingLeave:number;remaining:number;remainingIfAccepted:number;remainingIfAcceptedPct:number|null;risk:string};
type Payload={connected:boolean;from:string;to:string;team?:string|null;sector?:string|null;people:Person[];requests:LeaveRequest[];calendar:CalendarDay[];shiftComparison:ShiftDay[];teamOptions:string[];sectorOptions:string[];summary:{pending:number;approved:number;refused:number};rules:{warningRemainingPct:number;criticalRemainingPct:number};volumeRisk?:{enabled:boolean;effectiveSector?:string|null;method?:string};access:{role:string;profile:string;level?:string|null;positionKey?:string|null;canRequest:boolean;canDecide:boolean;teams:string[];sectors:string[]};organization?:{positionKey:string;name:string;title:string;parent?:string|null;teams:string[];sectors:string[]}|null;error?:string};
type DayPerson={employeeKey:string;name:string;matricule?:string|null;team?:string|null;service?:string|null;sector?:string|null;reason?:string|null};
type DayDetail={connected:boolean;date:string;team?:string|null;sector?:string|null;present:DayPerson[];leave:DayPerson[];otherAbsences:DayPerson[];pendingLeave:DayPerson[];counts:{present:number;leave:number;otherAbsences:number;pendingLeave:number};error?:string};
type DraftCapacity={minRemaining:number;minPct:number;risk:Exclude<RiskLevel,"unknown">;riskPct:number|null;requiredVolume:number|null;capacityVehicles:number|null};
type CompareSummary={team:string;total:number;minRemaining:number;minPct:number|null;risk:string};

const SECTOR_LABEL:Record<string,string>={expertise:"Expertise",mecanique:"Mécanique",dsp:"DSP",carrosserie:"Carrosserie",preparation:"Préparation",qualite:"Qualité",jantes:"Jantes",photo:"Photo",diagnostic:"Diagnostic",lavage:"Lavage",jockey:"Jockey",magasin:"Magasin / MPR",admin:"Administratif",encadrement:"Encadrement",autre:"Autre"};
const STATUS_LABEL:Record<string,string>={pending:"En attente",approved:"Accepté",refused:"Refusé",cancelled:"Annulé"};
const PROD_SECTORS=new Set(["expertise","mecanique","dsp","carrosserie","preparation","qualite","jantes","photo"]);

function parisToday(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function pad(value:number){return String(value).padStart(2,"0");}
function monthKey(date:string){return date.slice(0,7);}
function monthBounds(key:string){const[y,m]=key.split("-").map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${y}-${pad(m)}-01`,to:`${y}-${pad(m)}-${pad(last)}`};}
function addMonth(key:string,delta:number){const[y,m]=key.split("-").map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}`;}
function displayMonth(key:string){const[y,m]=key.split("-").map(Number);return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(y,m-1,1)));}
function displayDate(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function displayLongDate(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function dayLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function pct(value:number|null|undefined){return value==null?"—":`${Math.round(value)} %`;}
function fmt(value:number|null|undefined,digits=0){return value==null||!Number.isFinite(Number(value))?"—":Number(value).toLocaleString("fr-FR",{minimumFractionDigits:digits,maximumFractionDigits:digits});}
function riskFromPct(value:number|null|undefined):Exclude<RiskLevel,"unknown">{if(value==null)return"ok";return value>=90?"critical":value>=70?"warning":"ok";}
function scopeLabel(team:string,sector:string){const parts=[] as string[];if(team!=="*")parts.push(`Équipe ${team}`);if(sector!=="*")parts.push(SECTOR_LABEL[sector]??sector);return parts.length?parts.join(" · "):"Tout le périmètre autorisé";}

export default function LeavePlanningPage(){
  const today=parisToday();
  const[month,setMonth]=useState(monthKey(today));
  const[team,setTeam]=useState("*");
  const[sector,setSector]=useState("*");
  const[data,setData]=useState<Payload|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[notice,setNotice]=useState("");
  const[employeeKey,setEmployeeKey]=useState("");
  const[startDate,setStartDate]=useState(today);
  const[endDate,setEndDate]=useState(today);
  const[comment,setComment]=useState("");
  const[saving,setSaving]=useState(false);
  const[decisionComments,setDecisionComments]=useState<Record<string,string>>({});
  const[deciding,setDeciding]=useState<string|null>(null);
  const[selectedDate,setSelectedDate]=useState(today);
  const[dayDetail,setDayDetail]=useState<DayDetail|null>(null);
  const[detailLoading,setDetailLoading]=useState(false);

  const bounds=useMemo(()=>monthBounds(month),[month]);

  function filterParams(nextTeam:string,nextSector:string){const params=new URLSearchParams();if(nextTeam!=="*")params.set("team",nextTeam);if(nextSector!=="*")params.set("sector",nextSector);return params;}

  async function loadDetail(date:string,nextTeam=team,nextSector=sector){
    if(!date)return;
    setDetailLoading(true);
    try{
      const params=filterParams(nextTeam,nextSector);params.set("detailDate",date);params.set("_",String(Date.now()));
      const response=await fetch(`/api/worktime/leave?${params.toString()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
      const payload=await response.json() as DayDetail;
      if(!response.ok)throw new Error(payload.error||"Détail du jour indisponible.");
      setDayDetail(payload);
    }catch(cause){setDayDetail(null);setError(cause instanceof Error?cause.message:"Détail du jour indisponible.");}
    finally{setDetailLoading(false);}
  }

  async function load(nextMonth=month,nextTeam=team,nextSector=sector){
    const range=monthBounds(nextMonth);
    setLoading(true);setError("");
    try{
      const params=filterParams(nextTeam,nextSector);params.set("from",range.from);params.set("to",range.to);params.set("_",String(Date.now()));
      const response=await fetch(`/api/worktime/leave?${params.toString()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
      const payload=await response.json() as Payload;
      if(!response.ok)throw new Error(payload.error||"Chargement impossible.");
      setData(payload);
      const nextSelected=selectedDate>=range.from&&selectedDate<=range.to?selectedDate:(today>=range.from&&today<=range.to?today:range.from);
      setSelectedDate(nextSelected);
      void loadDetail(nextSelected,nextTeam,nextSector);
    }catch(cause){setError(cause instanceof Error?cause.message:"Chargement impossible.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[]);

  const people=useMemo(()=>data?.people??[],[data]);
  useEffect(()=>{if(employeeKey&&!people.some(person=>person.employeeKey===employeeKey))setEmployeeKey("");},[people,employeeKey]);

  const calendarMap=useMemo(()=>new Map((data?.calendar??[]).map(row=>[row.date,row])),[data]);
  const selectedDay=calendarMap.get(selectedDate)??null;
  const leading=useMemo(()=>{const d=new Date(`${bounds.from}T12:00:00Z`);return(d.getUTCDay()+6)%7;},[bounds.from]);
  const calendarCells=useMemo<(CalendarDay|null)[]>(()=>[...Array.from({length:leading},()=>null),...(data?.calendar??[])],[data,leading]);
  const draftRows=useMemo(()=>(data?.calendar??[]).filter(row=>startDate&&endDate&&row.date>=startDate&&row.date<=endDate&&!row.weekend),[data,startDate,endDate]);
  const selectedEmployee=useMemo(()=>people.find(person=>person.employeeKey===employeeKey)??null,[people,employeeKey]);

  const draftCapacity=useMemo<DraftCapacity|null>(()=>{
    if(!draftRows.length)return null;
    let minRemaining=Number.POSITIVE_INFINITY;
    let minPct=Number.POSITIVE_INFINITY;
    let worstRiskPct:number|null=null;
    let worstRequired:number|null=null;
    let worstCapacity:number|null=null;
    const employeeProductive=Boolean(selectedEmployee?.sector&&PROD_SECTORS.has(selectedEmployee.sector));
    for(const row of draftRows){
      const next=Math.max(0,row.remainingIfAccepted-1);
      const nextPct=row.total>0?100*next/row.total:100;
      minRemaining=Math.min(minRemaining,next);minPct=Math.min(minPct,nextPct);
      let riskPct=row.riskPct??null;
      let capacity=row.capacityVehicles??null;
      const required=row.requiredVolume??null;
      if(employeeProductive&&capacity!=null&&row.productiveRemainingIfAccepted&&row.productiveRemainingIfAccepted>0){
        const nextProductive=Math.max(0,row.productiveRemainingIfAccepted-1);
        capacity=capacity*nextProductive/row.productiveRemainingIfAccepted;
        riskPct=required!=null&&required>0?(capacity>0?Math.min(100,100*required/capacity):100):0;
      }
      if(riskPct!=null&&(worstRiskPct==null||riskPct>worstRiskPct)){worstRiskPct=riskPct;worstRequired=required;worstCapacity=capacity;}
    }
    const fallbackRisk=minPct<(data?.rules.criticalRemainingPct??70)?"critical":minPct<(data?.rules.warningRemainingPct??80)?"warning":"ok";
    return{minRemaining,minPct,risk:worstRiskPct==null?fallbackRisk:riskFromPct(worstRiskPct),riskPct:worstRiskPct,requiredVolume:worstRequired,capacityVehicles:worstCapacity};
  },[draftRows,data,selectedEmployee]);

  const comparePeriod=useMemo<CompareSummary[]>(()=>{
    const rows=data?.shiftComparison??[];
    if(!rows.length)return[];
    const from=startDate||bounds.from;const to=endDate||bounds.to;
    return["A","B","C"].map(teamCode=>{
      const list=rows.filter(row=>row.team===teamCode&&row.date>=from&&row.date<=to&&!calendarMap.get(row.date)?.weekend);
      if(!list.length)return{team:teamCode,total:0,minRemaining:0,minPct:null,risk:"unknown"};
      return{team:teamCode,total:Math.max(...list.map(row=>row.total)),minRemaining:Math.min(...list.map(row=>row.remainingIfAccepted)),minPct:Math.min(...list.map(row=>row.remainingIfAcceptedPct??100)),risk:list.some(row=>row.risk==="critical")?"critical":list.some(row=>row.risk==="warning")?"warning":"ok"};
    });
  },[data,startDate,endDate,bounds,calendarMap]);

  const requests=useMemo(()=>[...(data?.requests??[])].sort((a,b)=>{if(a.status===b.status)return a.startDate.localeCompare(b.startDate);if(a.status==="pending")return-1;if(b.status==="pending")return 1;return a.startDate.localeCompare(b.startDate);}),[data]);
  const criticalDays=useMemo(()=>(data?.calendar??[]).filter(day=>!day.weekend&&day.risk==="critical").length,[data]);
  const maxRiskDay=useMemo(()=>{
    const rows=(data?.calendar??[]).filter(day=>!day.weekend&&day.riskPct!=null);
    if(!rows.length)return null;
    return rows.reduce((current,row)=>(row.riskPct??-1)>(current.riskPct??-1)?row:current);
  },[data]);

  function changeFilter(nextTeam:string,nextSector:string){setTeam(nextTeam);setSector(nextSector);void load(month,nextTeam,nextSector);}
  function changeMonth(next:string){setMonth(next);const range=monthBounds(next);if(startDate<range.from||startDate>range.to){setStartDate(range.from);setEndDate(range.from);}void load(next,team,sector);}
  function selectDay(date:string){setSelectedDate(date);void loadDetail(date,team,sector);}

  async function submit(event:FormEvent){
    event.preventDefault();if(!employeeKey||!startDate||!endDate)return;
    setSaving(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/worktime/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"submit",employeeKey,startDate,endDate,comment})});
      const payload=await response.json() as{error?:string};if(!response.ok)throw new Error(payload.error||"Enregistrement impossible.");
      setNotice("Souhait enregistré et transmis au N+1.");setComment("");await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}finally{setSaving(false);}
  }

  async function decide(id:string,decision:"approve"|"refuse"){
    const decisionComment=(decisionComments[id]??"").trim();if(decision==="refuse"&&!decisionComment){setError("Ajoute un commentaire pour expliquer le refus.");return;}
    setDeciding(id);setError("");setNotice("");
    try{
      const response=await fetch("/api/worktime/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"decide",id,decision,comment:decisionComment||null})});
      const payload=await response.json() as{error?:string};if(!response.ok)throw new Error(payload.error||"Décision impossible.");
      setNotice(decision==="approve"?"Souhait de CP accepté.":"Souhait de CP refusé.");setDecisionComments(current=>({...current,[id]:""}));await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Décision impossible.");}finally{setDeciding(null);}
  }

  const showShiftComparison=sector!=="*"&&PROD_SECTORS.has(sector)&&comparePeriod.length>0;

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div><p className={styles.eyebrow}>Temps de travail · planification</p><h1>Souhaits de CP</h1><p>Dépose les souhaits, visualise immédiatement qui sera présent et mesure la tension capacitaire par rapport au volume à traiter.</p></div>
      <div className={styles.heroMeta}><strong>{data?.organization?.title??(data?.access.profile==="hr"?"Ressources humaines":"Vue management")}</strong><span>{data?.organization?.name??"Périmètre autorisé"}</span></div>
    </section>

    {error&&<div className={styles.error}>{error}</div>}
    {notice&&<div className={styles.notice}>{notice}</div>}

    <section className={styles.toolbar}>
      <div className={styles.monthNav}><button type="button" onClick={()=>changeMonth(addMonth(month,-1))}>‹</button><strong>{displayMonth(month)}</strong><button type="button" onClick={()=>changeMonth(addMonth(month,1))}>›</button></div>
      <label>Équipe<select value={team} onChange={event=>changeFilter(event.target.value,sector)}><option value="*">Toutes</option>{(data?.teamOptions??[]).map(value=><option key={value} value={value}>Équipe {value}</option>)}</select></label>
      <label>Secteur<select value={sector} onChange={event=>changeFilter(team,event.target.value)}><option value="*">Tous</option>{(data?.sectorOptions??[]).map(value=><option key={value} value={value}>{SECTOR_LABEL[value]??value}</option>)}</select></label>
      <button type="button" className={styles.refresh} onClick={()=>void load()} disabled={loading}>{loading?"Actualisation…":"Actualiser"}</button>
    </section>

    <section className={styles.kpis}>
      <article><span>Demandes en attente</span><strong>{data?.summary.pending??0}</strong><small>à arbitrer sur la période</small></article>
      <article><span>CP validés</span><strong>{data?.summary.approved??0}</strong><small>souhaits acceptés</small></article>
      <article data-risk={maxRiskDay?.risk??"unknown"}><span>Risque capacitaire max</span><strong>{maxRiskDay?pct(maxRiskDay.riskPct):"—"}</strong><small>{maxRiskDay?`${displayDate(maxRiskDay.date)} · ${fmt(maxRiskDay.requiredVolume,1)} VO à traiter / ${fmt(maxRiskDay.capacityVehicles,1)} VO de capacité`:"aucune donnée volume"}</small></article>
      <article data-risk={criticalDays>0?"critical":"ok"}><span>Jours critiques</span><strong>{criticalDays}</strong><small>risque capacitaire ≥ 90 %</small></article>
    </section>

    <div className={styles.grid}>
      <section className={styles.calendarCard}>
        <div className={styles.cardHead}><div><h2>Calendrier équipe</h2><p>Clique sur un jour pour voir les présents, les CP et les autres absences. Le risque intègre le volume théorique à traiter.</p></div><div className={styles.legend}><span data-risk="ok">Risque &lt; 70 %</span><span data-risk="warning">70–89 %</span><span data-risk="critical">≥ 90 %</span></div></div>
        <div className={styles.weekdays}>{["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(day=><span key={day}>{day}</span>)}</div>
        <div className={styles.calendar}>{calendarCells.map((row,index)=>row===null?<div className={styles.blank} key={`blank-${index}`}/>:<button type="button" className={`${styles.day} ${selectedDate===row.date?styles.daySelected:""}`} data-risk={row.risk} data-weekend={row.weekend} key={row.date} onClick={()=>selectDay(row.date)}><header><strong>{dayLabel(row.date)}</strong><span>{row.remainingIfAccepted}/{row.total}</span></header><div className={styles.capacityBar}><i style={{width:`${Math.max(0,Math.min(100,row.remainingIfAcceptedPct??0))}%`}}/></div><p><b>{row.approvedLeave}</b> CP · <b>{row.pendingLeave}</b> souhait{row.pendingLeave>1?"s":""}</p><div className={styles.riskLine}><span>Risque</span><strong>{pct(row.riskPct)}</strong></div>{row.requiredVolume!=null&&<small>{fmt(row.requiredVolume,1)} VO à traiter · capacité {fmt(row.capacityVehicles,1)} VO</small>}</button>)}</div>
      </section>

      <aside className={styles.side}>
        {data?.access.canRequest&&<form className={styles.requestCard} onSubmit={submit}>
          <div className={styles.cardHead}><div><h2>Déposer un souhait</h2><p>La demande est transmise automatiquement au N+1.</p></div></div>
          <label>Collaborateur<select value={employeeKey} onChange={event=>setEmployeeKey(event.target.value)} required><option value="">Choisir…</option>{people.map(person=><option value={person.employeeKey} key={person.employeeKey}>{person.name}{person.team?` · ${person.team}`:""}</option>)}</select></label>
          <div className={styles.twoCols}><label>Du<input type="date" value={startDate} onChange={event=>{setStartDate(event.target.value);if(endDate<event.target.value)setEndDate(event.target.value);}} required/></label><label>Au<input type="date" value={endDate} min={startDate} onChange={event=>setEndDate(event.target.value)} required/></label></div>
          <label>Commentaire<textarea value={comment} onChange={event=>setComment(event.target.value)} placeholder="Précision utile pour l’arbitrage…" rows={3}/></label>
          {draftCapacity&&<div className={styles.preview} data-risk={draftCapacity.risk}><span>Si ce souhait est accepté</span><strong>{draftCapacity.minRemaining} personne{draftCapacity.minRemaining>1?"s":""} minimum disponible{draftCapacity.minRemaining>1?"s":""}</strong><small>{draftCapacity.riskPct!=null?`Risque capacitaire jusqu’à ${pct(draftCapacity.riskPct)} · ${fmt(draftCapacity.requiredVolume,1)} VO à traiter / ${fmt(draftCapacity.capacityVehicles,1)} VO de capacité`:`${Math.round(draftCapacity.minPct)} % de capacité humaine au point le plus bas`}</small></div>}
          <button className={styles.primary} disabled={saving||!employeeKey}>{saving?"Transmission…":"Soumettre au N+1"}</button>
        </form>}

        {showShiftComparison&&<section className={styles.compareCard}><div className={styles.cardHead}><div><h2>Comparaison des shifts</h2><p>{SECTOR_LABEL[sector]??sector} · capacité minimale sur la période sélectionnée.</p></div></div><div className={styles.shiftList}>{comparePeriod.map(item=><div key={item.team} data-risk={item.risk}><span>Équipe {item.team}</span><strong>{item.minRemaining}/{item.total}</strong><small>{pct(item.minPct)}</small></div>)}</div></section>}
      </aside>
    </div>

    <section className={styles.dayDetailCard} data-risk={selectedDay?.risk??"unknown"}>
      <div className={styles.cardHead}><div><p className={styles.eyebrow}>DÉTAIL DU JOUR</p><h2>{displayLongDate(selectedDate)}</h2><p>{scopeLabel(team,sector)} · les listes suivent exactement les filtres actifs.</p></div>{selectedDay&&<div className={styles.dayRisk}><span>Risque capacitaire</span><strong>{pct(selectedDay.riskPct)}</strong><small>{fmt(selectedDay.requiredVolume,1)} VO à traiter · capacité {fmt(selectedDay.capacityVehicles,1)} VO</small></div>}</div>
      {detailLoading?<div className={styles.empty}>Chargement de l’équipe…</div>:dayDetail?<>
        <div className={styles.dayStats}><article><span>Présents</span><strong>{dayDetail.counts.present}</strong></article><article><span>CP / RTT</span><strong>{dayDetail.counts.leave}</strong></article><article><span>Autres absences</span><strong>{dayDetail.counts.otherAbsences}</strong></article><article><span>Souhaits en attente</span><strong>{dayDetail.counts.pendingLeave}</strong></article></div>
        <div className={styles.peopleGrid}>
          <PeopleList title="Présents" people={dayDetail.present} tone="present" empty="Aucun présent sur ce filtre."/>
          <PeopleList title="En CP / RTT" people={dayDetail.leave} tone="leave" empty="Aucun CP / RTT ce jour."/>
          {dayDetail.otherAbsences.length>0&&<PeopleList title="Autres absences" people={dayDetail.otherAbsences} tone="absence" empty=""/>}
          {dayDetail.pendingLeave.length>0&&<PeopleList title="Souhaits CP en attente" people={dayDetail.pendingLeave} tone="pending" empty=""/>}
        </div>
        {selectedDay&&<div className={styles.riskExplanation}><strong>Lecture du risque</strong><span>{selectedDay.targetSource??"Volume théorique du jour"}. L’indice compare la charge à traiter à la capacité disponible après absences et CP. Ce pourcentage mesure une tension capacitaire, pas une probabilité statistique.</span></div>}
      </>:<div className={styles.empty}>Détail indisponible.</div>}
    </section>

    <section className={styles.requestsCard}>
      <div className={styles.cardHead}><div><h2>Demandes du périmètre</h2><p>Les demandes en attente sont affichées en premier.</p></div></div>
      <div className={styles.requests}>{requests.length===0?<div className={styles.empty}>Aucune demande sur la période.</div>:requests.map(request=><article className={styles.request} data-status={request.status} key={request.id}><div className={styles.requestMain}><div><span className={styles.status}>{STATUS_LABEL[request.status]??request.status}</span><h3>{request.employeeName}</h3><p>{displayDate(request.startDate)} → {displayDate(request.endDate)}{request.team?` · Équipe ${request.team}`:""}{request.sector?` · ${SECTOR_LABEL[request.sector]??request.sector}`:""}</p>{request.requestComment&&<p>{request.requestComment}</p>}</div><div className={styles.requestMeta}><span>Demandé par {request.requestedBy}</span>{request.decisionBy&&<span>Décision : {request.decisionBy}</span>}{request.decisionComment&&<em>{request.decisionComment}</em>}</div></div>{request.status==="pending"&&request.canDecide&&<div className={styles.decision}><input value={decisionComments[request.id]??""} onChange={event=>setDecisionComments(current=>({...current,[request.id]:event.target.value}))} placeholder="Commentaire de décision"/><button type="button" className={styles.accept} onClick={()=>void decide(request.id,"approve")} disabled={deciding===request.id}>Accepter</button><button type="button" className={styles.refuse} onClick={()=>void decide(request.id,"refuse")} disabled={deciding===request.id}>Refuser</button></div>}</article>)}</div>
    </section>
  </main>;
}

function PeopleList({title,people,tone,empty}:{title:string;people:DayPerson[];tone:"present"|"leave"|"absence"|"pending";empty:string}){
  return <section className={styles.peopleList} data-tone={tone}><header><h3>{title}</h3><strong>{people.length}</strong></header><div>{people.length===0?<span className={styles.listEmpty}>{empty}</span>:people.map(person=><article key={person.employeeKey}><div><strong>{person.name}</strong><small>{person.team?`Équipe ${person.team}`:"Sans équipe"}{person.sector?` · ${SECTOR_LABEL[person.sector]??person.sector}`:""}</small></div>{person.reason&&<em>{person.reason}</em>}</article>)}</div></section>;
}
