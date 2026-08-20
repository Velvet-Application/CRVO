"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./temps-travail.module.css";

type Person={employeeKey:string;matricule?:string|null;name:string;team?:string|null;service?:string|null;sector?:string|null;jobTitle?:string|null};
type Shift={team:string;label:string;rotationMode?:"fixed"|"weekly_alternate";startTime?:string|null;endTime?:string|null;breakStart?:string|null;breakEnd?:string|null;alternateStartTime?:string|null;alternateEndTime?:string|null;rotationAnchorMonday?:string|null;rotationAnchorPrimary?:boolean|null;rotationPending?:boolean;currentStartTime?:string|null;currentEndTime?:string|null};
type EventRow={id:string;entity:string;employeeKey:string;employeeName:string;team?:string|null;service?:string|null;sector?:string|null;kind:"absence"|"late"|"early_departure";reason:string;startDate:string;endDate:string;eventTime?:string|null;durationHours?:number|null;source?:"manual"|"data_rh"|string|null;justification:"received"|"pending"|"not_required";comment?:string|null;status:"open"|"closed";createdBy:string;createdAt:string;closedBy?:string|null;closedAt?:string|null};
type Access={profile:string;role:string;teams:string[];sectors?:string[];canClose:boolean;canConfigure:boolean;canManagePeople:boolean;level?:string|null;positionKey?:string|null};
type Organization={positionKey:string;name:string;title:string;level:string;parent?:string|null;teams:string[];sectors:string[];shiftGroup?:string|null};
type ProductiveRef={employeeKey:string;sectorKey:string;team?:string|null};
type ImpactReference={connected?:boolean;source?:string;period?:{start?:string;end?:string}|null;avgExitsPerDay?:number|null;avgAvailableEtp?:number|null;hoursPerSiteVop?:number|null;siteVopPerProductiveHour?:number|null;productivePeople?:ProductiveRef[];method?:string;error?:string};
type ValidationState="data_rh"|"event"|"no_event"|"pending";
type ValidationPerson={employeeKey:string;state:ValidationState;locked:boolean;source:string};
type ValidationScope={positionKey:string;title:string;teams:string[];sectors:string[];total:number;validated:number;pending:number;complete:boolean};
type ValidationPayload={date:string;people:ValidationPerson[];scope?:ValidationScope|null;canConfirm:boolean};
type Payload={entity:"CRVO"|"TRANSPHERE";from:string;to:string;people:Person[];events:EventRow[];shifts:Shift[];organization?:Organization|null;access:Access;summary:{absentToday:number;lateToday:number;earlyToday:number;pendingJustifications:number;openEvents:number};impactReference?:ImpactReference;validation?:ValidationPayload;currentUser?:{name:string;profile:string}};
type Kind=EventRow["kind"];
type EventFilter="all"|"absence"|"late"|"early_departure"|"pending";

type EffectiveShift={start:string;end:string;breakStart:string;breakEnd:string;pending:boolean};
type ImpactRow={sector:string;label:string;events:number;people:number;lostHours:number;siteVopLost:number|null};

const REASONS=[
  ["paid_leave","CP / congé payé"],["rtt_recovery","RTT / récupération"],["sick_received","Arrêt maladie - justificatif reçu"],["sick_pending","Arrêt maladie - justificatif en attente"],["long_absence","Absence longue durée"],["parental_leave","Congé parental"],["unpaid_leave","Congé sans solde"],["authorized_unpaid","Absence justifiée non rémunérée"],["authorized_paid","Absence autorisée rémunérée"],["medical_visit","Visite médicale"],["therapeutic_part_time","Temps partiel thérapeutique"],["pending_qualification","Absence à qualifier"],["unjustified","Absence injustifiée"],["authorized","Absence autorisée"],["training","Formation"],["work_accident","Accident travail / trajet"],["family_leave","Événement familial"],["late","Retard"],["late_night","Retard nuit"],["early_departure_night","Départ anticipé nuit"],["other","Autre"],
] as const;
const LABELS:Record<string,string>=Object.fromEntries(REASONS);
const KIND_LABEL:Record<Kind,string>={absence:"Absence",late:"Retard",early_departure:"Départ anticipé"};
const SECTOR_LABEL:Record<string,string>={expertise:"Expertise",mecanique:"Mécanique",dsp:"DSP",carrosserie:"Carrosserie",preparation:"Préparation",qualite:"Qualité",photo:"Photo",magasin:"Magasin / MPR",admin:"Administratif",jantes:"Jantes",jockey:"Jockey",encadrement:"Encadrement",autre:"Autre",transphere:"Transphère"};

function parisToday(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function displayDate(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Europe/Paris"}).format(new Date(`${value}T12:00:00Z`));}
function inRange(date:string,event:EventRow){return event.startDate<=date&&event.endDate>=date;}
function safeFileDate(value:string){return value.replaceAll("-","");}
function num(value:number,digits=1){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);}
function toMinutes(value?:string|null){if(!value)return null;const match=value.match(/^(\d{1,2}):(\d{2})/);if(!match)return null;return Number(match[1])*60+Number(match[2]);}
function effectiveShift(shift:Shift|undefined,date:string):EffectiveShift{
  if(!shift)return{start:"",end:"",breakStart:"",breakEnd:"",pending:false};
  if(shift.rotationMode!=="weekly_alternate")return{start:shift.startTime??"",end:shift.endTime??"",breakStart:shift.breakStart??"",breakEnd:shift.breakEnd??"",pending:false};
  if(!shift.rotationAnchorMonday||typeof shift.rotationAnchorPrimary!=="boolean")return{start:"",end:"",breakStart:"",breakEnd:"",pending:true};
  const d=new Date(`${date}T12:00:00Z`).getTime();const a=new Date(`${shift.rotationAnchorMonday}T12:00:00Z`).getTime();const weeks=Math.floor((d-a)/(7*86400000));const primary=(Math.abs(weeks)%2===0)===shift.rotationAnchorPrimary;
  return{start:primary?(shift.startTime??""):(shift.alternateStartTime??""),end:primary?(shift.endTime??""):(shift.alternateEndTime??""),breakStart:shift.breakStart??"",breakEnd:shift.breakEnd??"",pending:false};
}
function shiftText(shift:Shift){if(shift.rotationMode==="weekly_alternate")return`${shift.currentStartTime??"—"}–${shift.currentEndTime??"—"} cette semaine · alternance hebdo`;if(shift.breakStart&&shift.breakEnd)return`${shift.startTime}–${shift.breakStart} · ${shift.breakEnd}–${shift.endTime}`;return shift.startTime&&shift.endTime?`${shift.startTime}–${shift.endTime}`:"Horaire à paramétrer";}
function timeline(shift:EffectiveShift){const start=toMinutes(shift.start),rawEnd=toMinutes(shift.end);if(start==null||rawEnd==null)return null;const end=rawEnd<=start?rawEnd+1440:rawEnd;let breakStart=toMinutes(shift.breakStart),breakEnd=toMinutes(shift.breakEnd);if(breakStart!=null&&breakEnd!=null){if(breakStart<start&&end>1440)breakStart+=1440;if(breakEnd<=start&&end>1440)breakEnd+=1440;if(breakEnd<=breakStart)breakEnd+=1440;}else{breakStart=null;breakEnd=null;}return{start,end,breakStart,breakEnd};}
function normalizeClock(value:string,start:number,end:number){const raw=toMinutes(value);if(raw==null)return null;if(end>1440&&raw<start)return raw+1440;return raw;}
function overlap(a1:number,a2:number,b1:number,b2:number){return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1));}
function workMinutesBetween(shift:EffectiveShift,from:number,to:number){const t=timeline(shift);if(!t)return 0;const a=Math.max(t.start,from),b=Math.min(t.end,to);if(b<=a)return 0;let minutes=b-a;if(t.breakStart!=null&&t.breakEnd!=null)minutes-=overlap(a,b,t.breakStart,t.breakEnd);return Math.max(0,minutes);}
function lostMinutes(event:EventRow,shift:EffectiveShift,date:string){if(!inRange(date,event))return 0;const t=timeline(shift);if(!t)return 0;const sourceHours=Number(event.durationHours);if(Number.isFinite(sourceHours)&&sourceHours>0){const full=workMinutesBetween(shift,t.start,t.end);return Math.min(full,Math.round(sourceHours*60));}if(event.kind==="absence")return workMinutesBetween(shift,t.start,t.end);if(event.startDate!==date||!event.eventTime)return 0;const at=normalizeClock(event.eventTime,t.start,t.end);if(at==null)return 0;if(event.kind==="late")return workMinutesBetween(shift,t.start,at);return workMinutesBetween(shift,at,t.end);}
function scopeText(data:Payload){if(data.organization)return`${data.organization.title} · ${data.organization.teams.includes("*")?"toutes équipes":data.organization.teams.map(t=>`Équipe ${t}`).join(" / ")} · ${data.organization.sectors.includes("*")?"tous secteurs":data.organization.sectors.map(s=>SECTOR_LABEL[s]??s).join(" / ")}`;return data.access.teams.includes("*")?"Tous les collaborateurs":data.access.teams.map(team=>`Équipe ${team}`).join(" · ");}

export default function WorktimePage(){
  const today=parisToday();
  const[entity,setEntity]=useState<"CRVO"|"TRANSPHERE">("CRVO");
  const[from,setFrom]=useState(today);const[to,setTo]=useState(today);const[focusDate,setFocusDate]=useState(today);
  const[data,setData]=useState<Payload|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState("");const[notice,setNotice]=useState("");
  const[search,setSearch]=useState("");const[teamFilter,setTeamFilter]=useState("*");const[sectorFilter,setSectorFilter]=useState("*");const[eventFilter,setEventFilter]=useState<EventFilter>("all");
  const[selected,setSelected]=useState<Person|null>(null);const[kind,setKind]=useState<Kind>("absence");const[reason,setReason]=useState("paid_leave");const[startDate,setStartDate]=useState(today);const[endDate,setEndDate]=useState(today);const[eventTime,setEventTime]=useState("");const[comment,setComment]=useState("");const[saving,setSaving]=useState(false);
  const[settings,setSettings]=useState(false);const[personPanel,setPersonPanel]=useState(false);const[validating,setValidating]=useState(false);

  async function load(nextEntity=entity,nextFrom=from,nextTo=to,nextFocus=focusDate){setLoading(true);setError("");try{const response=await fetch(`/api/worktime?entity=${nextEntity}&from=${nextFrom}&to=${nextTo}&focus=${nextFocus}&_=${Date.now()}`,{cache:"no-store"});const payload=await response.json() as Payload&{error?:string};if(!response.ok)throw new Error(payload.error||"Chargement impossible.");setData(payload);setEntity(payload.entity);}catch(cause){setError(cause instanceof Error?cause.message:"Chargement impossible.");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  useEffect(()=>{setTeamFilter("*");setSectorFilter("*");setEventFilter("all");},[data?.entity]);

  const fullScopeAccess=Boolean(data&&(data.access.role==="admin"||data.access.profile==="hr"));
  const teamOptions=useMemo(()=>Array.from(new Set((data?.people??[]).map(person=>person.team).filter((value):value is string=>Boolean(value)))).sort((a,b)=>a.localeCompare(b,"fr")),[data]);
  const sectorOptions=useMemo(()=>Array.from(new Set((data?.people??[]).map(person=>person.sector).filter((value):value is string=>Boolean(value)))).sort((a,b)=>(SECTOR_LABEL[a]??a).localeCompare(SECTOR_LABEL[b]??b,"fr")),[data]);
  const matchesScope=(person:{team?:string|null;sector?:string|null})=>(teamFilter==="*"||person.team===teamFilter)&&(sectorFilter==="*"||person.sector===sectorFilter);
  const scopedEvents=useMemo(()=>(data?.events??[]).filter(item=>matchesScope(item)),[data,teamFilter,sectorFilter]);
  const basePeople=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.people??[]).filter(person=>matchesScope(person)&&(!q||`${person.name} ${person.team??""} ${person.service??""} ${person.matricule??""} ${person.sector??""}`.toLowerCase().includes(q)));},[data,search,teamFilter,sectorFilter]);
  const shiftMap=useMemo(()=>new Map((data?.shifts??[]).map(item=>[item.team,item])),[data]);
  const validationMap=useMemo(()=>new Map((data?.validation?.people??[]).map(item=>[item.employeeKey,item])),[data?.validation]);
  const personShift=(person:Person)=>{const key=person.sector==="admin"||person.sector==="magasin"?"J":person.team??"";return effectiveShift(shiftMap.get(key),focusDate);};
  const focusEvents=useMemo(()=>scopedEvents.filter(item=>item.kind==="absence"?inRange(focusDate,item):item.startDate===focusDate),[scopedEvents,focusDate]);
  const matchingEvent=(item:EventRow,filter:EventFilter)=>filter==="all"?true:filter==="pending"?item.status==="open"&&item.justification==="pending":filter==="absence"?item.kind==="absence"&&inRange(focusDate,item):item.kind===filter&&item.startDate===focusDate;
  const eventKeys=useMemo(()=>new Set(scopedEvents.filter(item=>matchingEvent(item,eventFilter)).map(item=>item.employeeKey)),[scopedEvents,eventFilter,focusDate]);
  const displayedPeople=useMemo(()=>eventFilter==="all"?basePeople:basePeople.filter(person=>eventKeys.has(person.employeeKey)),[basePeople,eventFilter,eventKeys]);
  const historyEvents=useMemo(()=>eventFilter==="all"?scopedEvents:scopedEvents.filter(item=>matchingEvent(item,eventFilter)),[scopedEvents,eventFilter,focusDate]);
  const eventsByEmployee=useMemo(()=>{const map=new Map<string,EventRow[]>();for(const item of scopedEvents){const list=map.get(item.employeeKey)??[];list.push(item);map.set(item.employeeKey,list);}return map;},[scopedEvents]);

  const visibleSummary=useMemo(()=>({
    absent:focusEvents.filter(item=>item.kind==="absence").length,
    late:focusEvents.filter(item=>item.kind==="late").length,
    early:focusEvents.filter(item=>item.kind==="early_departure").length,
    pending:scopedEvents.filter(item=>item.status==="open"&&item.justification==="pending").length,
  }),[focusEvents,scopedEvents]);

  const productiveMap=useMemo(()=>new Map((data?.impactReference?.productivePeople??[]).map(item=>[item.employeeKey,item])),[data?.impactReference?.productivePeople]);
  const impactRows=useMemo<ImpactRow[]>(()=>{
    const byPerson=new Map<string,{sector:string;minutes:number;events:number;fullMinutes:number}>();
    for(const item of focusEvents){
      const productive=productiveMap.get(item.employeeKey);if(!productive)continue;
      const person=(data?.people??[]).find(p=>p.employeeKey===item.employeeKey);if(!person)continue;
      const shift=effectiveShift(shiftMap.get(person.team??productive.team??""),focusDate);const t=timeline(shift);if(!t)continue;
      const minutes=lostMinutes(item,shift,focusDate);if(minutes<=0)continue;
      const fullMinutes=workMinutesBetween(shift,t.start,t.end);if(fullMinutes<=0)continue;
      const current=byPerson.get(item.employeeKey)??{sector:productive.sectorKey,minutes:0,events:0,fullMinutes};
      current.minutes=Math.min(current.fullMinutes,current.minutes+minutes);current.events+=1;byPerson.set(item.employeeKey,current);
    }
    const bySector=new Map<string,{events:number;people:number;minutes:number}>();
    for(const item of byPerson.values()){const current=bySector.get(item.sector)??{events:0,people:0,minutes:0};current.events+=item.events;current.people+=1;current.minutes+=item.minutes;bySector.set(item.sector,current);}
    const hoursPerSiteVop=Number(data?.impactReference?.hoursPerSiteVop);
    return Array.from(bySector.entries()).map(([sector,value])=>{const lostHours=value.minutes/60;return{sector,label:SECTOR_LABEL[sector]??sector,events:value.events,people:value.people,lostHours,siteVopLost:Number.isFinite(hoursPerSiteVop)&&hoursPerSiteVop>0?lostHours/hoursPerSiteVop:null};}).sort((a,b)=>(b.siteVopLost??0)-(a.siteVopLost??0)||b.lostHours-a.lostHours);
  },[focusEvents,data?.people,data?.impactReference?.hoursPerSiteVop,shiftMap,focusDate,productiveMap]);
  const totalLostHours=impactRows.reduce((sum,row)=>sum+row.lostHours,0);
  const siteVopLost=impactRows.reduce((sum,row)=>sum+(row.siteVopLost??0),0);

  function toggleEventFilter(next:EventFilter){setEventFilter(current=>current===next?"all":next);}
  function openEvent(person:Person,nextKind:Kind){const validation=validationMap.get(person.employeeKey);if(validation?.locked){setError(validation.state==="data_rh"?"Journée verrouillée par Data RH.":"Présence déjà validée RAS. Une réouverture RH est nécessaire.");return;}const shift=personShift(person);setSelected(person);setKind(nextKind);setStartDate(focusDate);setEndDate(focusDate);setReason(nextKind==="absence"?"paid_leave":"other");setComment("");setEventTime(nextKind==="late"?shift.start:nextKind==="early_departure"?shift.end:"");}
  function closeModal(){setSelected(null);}
  async function confirmPresence(person:Person){if(!confirm(`Confirmer qu'aucun événement n'est à signaler pour ${person.name} le ${focusDate} ? Cette validation verrouille la présence.`))return;setValidating(true);setError("");try{const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm-presence",entity:data?.entity??entity,date:focusDate,employeeKey:person.employeeKey})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok)throw new Error(payload.error||"Validation impossible.");setNotice(`Présence de ${person.name} validée et verrouillée.`);await load(entity,from,to,focusDate);}catch(cause){setError(cause instanceof Error?cause.message:"Validation impossible.");}finally{setValidating(false);}}
  async function confirmTeam(){const scope=data?.validation?.scope;if(!scope||scope.pending<=0)return;if(!confirm(`Valider « aucun événement à signaler » pour les ${scope.pending} collaborateur(s) restant(s) de votre périmètre le ${focusDate} ? Les présences seront verrouillées.`))return;setValidating(true);setError("");try{const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm-team",entity:data?.entity??entity,date:focusDate})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok)throw new Error(payload.error||"Clôture impossible.");setNotice("Périmètre clôturé : tous les collaborateurs sont désormais validés.");await load(entity,from,to,focusDate);}catch(cause){setError(cause instanceof Error?cause.message:"Clôture impossible.");}finally{setValidating(false);}}
  async function submitEvent(event:FormEvent){event.preventDefault();if(!selected)return;setSaving(true);setError("");try{const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",entity:data?.entity??entity,employeeKey:selected.employeeKey,kind,reason,startDate,endDate:kind==="absence"?endDate:startDate,eventTime:kind==="absence"?null:eventTime,comment})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok)throw new Error(payload.error||"Enregistrement impossible.");setNotice(`${KIND_LABEL[kind]} enregistré pour ${selected.name}.`);closeModal();await load(entity,from,to,focusDate);}catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}finally{setSaving(false);}}
  async function setStatus(row:EventRow,action:"close"|"reopen"|"cancel"){if(row.source==="data_rh")return;if(action==="cancel"&&!confirm(`Annuler l'événement de ${row.employeeName} ?`))return;if(action==="close"&&!confirm(`Clôturer l'événement de ${row.employeeName} ? Le terrain ne pourra plus le modifier.`))return;const response=await fetch("/api/worktime",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,id:row.id})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok){setError(payload.error||"Modification impossible.");return;}setNotice(action==="close"?"Événement clôturé et verrouillé.":action==="reopen"?"Événement réouvert.":"Événement annulé.");await load(entity,from,to,focusDate);}
  async function setRotation(aMorning:boolean){const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"rotation-anchor",anchorDate:today,aMorning})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok){setError(payload.error||"Rotation impossible à enregistrer.");return;}setNotice(`Rotation enregistrée : équipe ${aMorning?"A":"B"} du matin cette semaine.`);setSettings(false);await load(entity,from,to,focusDate);}
  async function addTranspherePerson(event:FormEvent<HTMLFormElement>){event.preventDefault();const fd=new FormData(event.currentTarget);const name=String(fd.get("name")??"").trim();const key=String(fd.get("key")??"").trim();const team=String(fd.get("team")??"TRANSPHERE").trim();const service=String(fd.get("service")??"").trim();const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"person",employeeKey:key,name,team,service,active:true})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok){setError(payload.error||"Collaborateur impossible à créer.");return;}event.currentTarget.reset();setNotice(`${name} ajouté au référentiel Transphère.`);await load(entity,from,to,focusDate);}

  async function exportXlsx(){if(!data)return;const XLSX=await import("@e965/xlsx");const rows:Array<Record<string,unknown>>=[];for(const item of historyEvents){let cursor=new Date(`${item.startDate}T12:00:00Z`);const end=new Date(`${item.endDate}T12:00:00Z`);while(cursor<=end){rows.push({Entité:data.entity,Date:cursor.toISOString().slice(0,10),Matricule:data.people.find(p=>p.employeeKey===item.employeeKey)?.matricule??"",Collaborateur:item.employeeName,Équipe:item.team??"",Secteur:SECTOR_LABEL[item.sector??""]??item.sector??"",Service:item.service??"",Événement:KIND_LABEL[item.kind],Motif:LABELS[item.reason]??item.reason,"Durée h":item.durationHours??"",Heure:item.eventTime??"",Source:item.source==="data_rh"?"Data RH":"Saisie Temps de travail",Justificatif:item.justification==="received"?"Reçu":item.justification==="pending"?"En attente":"Non requis",Statut:item.status==="closed"?"Clôturé":"Ouvert",Commentaire:item.comment??"",Déclaré_par:item.createdBy,Déclaré_le:item.createdAt,Clôturé_par:item.closedBy??"",Clôturé_le:item.closedAt??""});cursor.setUTCDate(cursor.getUTCDate()+1);}}
    const sheet=XLSX.utils.json_to_sheet(rows);sheet["!cols"]=[12,12,14,28,10,18,12,18,32,12,10,18,14,12,36,20,20,20,20].map(w=>({wch:w}));const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,"Temps de travail");
    const impactSheet=XLSX.utils.json_to_sheet(impactRows.map(row=>({Date:focusDate,Secteur:row.label,"Productifs impactés":row.people,"Heures productives perdues":Number(row.lostHours.toFixed(2)),"Référence h productives / VO site":data.impactReference?.hoursPerSiteVop??null,"VO site perdues estimées":row.siteVopLost==null?null:Number(row.siteVopLost.toFixed(2))})));XLSX.utils.book_append_sheet(book,impactSheet,"Impact capacité");
    XLSX.writeFile(book,`Suivi_temps_${data.entity}_${safeFileDate(from)}_${safeFileDate(to)}.xlsx`);
  }

  function changePeriod(nextFrom:string,nextTo:string){setFrom(nextFrom);setTo(nextTo);const nextFocus=focusDate<nextFrom||focusDate>nextTo?nextFrom:focusDate;if(nextFocus!==focusDate)setFocusDate(nextFocus);void load(entity,nextFrom,nextTo,nextFocus);}
  function changeFocus(next:string){setFocusDate(next);void load(entity,from,to,next);}
  function changeEntity(next:"CRVO"|"TRANSPHERE"){setEntity(next);setEventFilter("all");void load(next,from,to,focusDate);}

  if(loading&&!data)return <main className={styles.loading}><div/><strong>Chargement du suivi du temps…</strong></main>;
  if(!data)return <main className={styles.loading}><strong>Suivi du temps indisponible</strong><span>{error}</span></main>;

  const selectedShift=selected?personShift(selected):null;
  const closure=data.validation?.scope??null;
  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.title}><span>SUIVI RH · TEMPS DE TRAVAIL</span><h1>Présences & capacité</h1><p>{data.entity==="CRVO"?"CRVO Lens":"Transphère"} · déclaration terrain, contrôle RH et impact production</p></div>
      <div className={styles.headerActions}>
        {fullScopeAccess&&<div className={styles.entitySwitch}><button className={data.entity==="CRVO"?styles.active:""} onClick={()=>changeEntity("CRVO")}>CRVO</button><button className={data.entity==="TRANSPHERE"?styles.active:""} onClick={()=>changeEntity("TRANSPHERE")}>TRANSPHÈRE</button></div>}
        {data.access.canClose&&<button className={styles.secondary} onClick={()=>void exportXlsx()}>EXPORT EXCEL</button>}
        {data.access.canConfigure&&<button className={styles.secondary} onClick={()=>setSettings(true)}>HORAIRES & ROTATION</button>}
        {data.entity==="TRANSPHERE"&&data.access.canManagePeople&&<button className={styles.secondary} onClick={()=>setPersonPanel(true)}>COLLABORATEURS</button>}
      </div>
    </header>

    {error&&<div className={styles.error}>{error}</div>}{notice&&<div className={styles.notice}>{notice}<button onClick={()=>setNotice("")}>×</button></div>}

    <section className={styles.summary}>
      <button className={`${eventFilter==="absence"?styles.summaryActive:""}`} onClick={()=>toggleEventFilter("absence")}><span>ABSENTS {focusDate===today?"AUJOURD'HUI":"LE JOUR AFFICHÉ"}</span><strong>{visibleSummary.absent}</strong><small>Cliquer pour afficher uniquement les absents</small></button>
      <button className={`${eventFilter==="late"?styles.summaryActive:""}`} onClick={()=>toggleEventFilter("late")}><span>RETARDS</span><strong>{visibleSummary.late}</strong><small>Cliquer pour filtrer les collaborateurs</small></button>
      <button className={`${eventFilter==="early_departure"?styles.summaryActive:""}`} onClick={()=>toggleEventFilter("early_departure")}><span>DÉPARTS ANTICIPÉS</span><strong>{visibleSummary.early}</strong><small>Cliquer pour filtrer les collaborateurs</small></button>
      <button className={`${visibleSummary.pending?styles.warningCard:""} ${eventFilter==="pending"?styles.summaryActive:""}`} onClick={()=>toggleEventFilter("pending")}><span>JUSTIFICATIFS EN ATTENTE</span><strong>{visibleSummary.pending}</strong><small>Cliquer pour voir les dossiers concernés</small></button>
    </section>

    <section className={styles.impactHero}>
      <div className={styles.impactMain}><span>HEURES PRODUCTIVES PERDUES · {displayDate(focusDate).toUpperCase()}</span><div><strong>{num(totalLostHours,1)} h</strong><small>productifs directs / Fixline uniquement</small></div></div>
      <div className={styles.vopRisk}><span>VO DE PRODUCTION PERDUES (EST.)</span><strong>≈ {num(siteVopLost,1)}</strong><small>baisse de capacité estimée liée à l’absentéisme du jour</small></div>
      <div className={styles.reference}><span>RÉFÉRENCE DÉBIT SITE</span><strong>{data.impactReference?.source??"Non disponible"}</strong><small>{data.impactReference?.connected&&data.impactReference?.hoursPerSiteVop?`${num(Number(data.impactReference.avgExitsPerDay??0),1)} sorties/j · ${num(Number(data.impactReference.avgAvailableEtp??0),1)} ETP · ${num(Number(data.impactReference.hoursPerSiteVop),2)} h productives / VO`:(data.impactReference?.error??"Référence de production indisponible")}</small></div>
    </section>

    {impactRows.length>0&&<section className={styles.impactGrid}>{impactRows.map(row=><article key={row.sector}><span>{row.label.toUpperCase()}</span><strong>{num(row.lostHours,1)} h productives perdues</strong><p>{row.people} productif{row.people>1?"s":""} impacté{row.people>1?"s":""}</p><div><b>{data.impactReference?.hoursPerSiteVop?`${num(Number(data.impactReference.hoursPerSiteVop),2)} h/VO site`:`Référence site indisponible`}</b><em>{row.siteVopLost==null?"VO —":`≈ ${num(row.siteVopLost,1)} VO site`}</em></div></article>)}</section>}

    <section className={styles.controls}>
      <div className={styles.period}><label>DU<input type="date" value={from} max={to} onChange={e=>changePeriod(e.target.value,to)}/></label><label>AU<input type="date" value={to} min={from} onChange={e=>changePeriod(from,e.target.value)}/></label></div>
      <label className={styles.focus}>JOUR AFFICHÉ<input type="date" value={focusDate} min={from} max={to} onChange={e=>changeFocus(e.target.value)}/></label>
      {fullScopeAccess&&<div className={styles.scopeFilters}><label>SECTEUR<select value={sectorFilter} onChange={e=>{setSectorFilter(e.target.value);setEventFilter("all");}}><option value="*">Tous les secteurs</option>{sectorOptions.map(value=><option key={value} value={value}>{SECTOR_LABEL[value]??value}</option>)}</select></label><label>ÉQUIPE<select value={teamFilter} onChange={e=>{setTeamFilter(e.target.value);setEventFilter("all");}}><option value="*">Toutes les équipes</option>{teamOptions.map(value=><option key={value} value={value}>Équipe {value}</option>)}</select></label></div>}
      <label className={styles.search}>RECHERCHER<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, matricule, service…"/></label>
      <div className={styles.scope}><span>PÉRIMÈTRE</span><strong>{scopeText(data)}</strong></div>
    </section>

    <section className={styles.shiftStrip}>{data.shifts.map(shift=><div key={shift.team}><span>{shift.label}</span><strong>{shiftText(shift)}</strong></div>)}</section>

    {closure&&<section style={{margin:"14px 0 18px",padding:"18px 20px",borderRadius:18,border:`1px solid ${closure.complete?"#b9dfc5":"#f0d39d"}`,background:closure.complete?"#f4fbf6":"#fffaf1",display:"flex",alignItems:"center",gap:18,justifyContent:"space-between",flexWrap:"wrap"}}>
      <div><span style={{display:"block",fontSize:9,fontWeight:800,letterSpacing:".1em",color:closure.complete?"#39835a":"#b1781c"}}>CLÔTURE QUOTIDIENNE · {displayDate(focusDate).toUpperCase()}</span><strong style={{display:"block",fontSize:22,marginTop:3,color:"#17384d"}}>{closure.validated}/{closure.total} collaborateurs validés</strong><small style={{color:"#667d8b"}}>{closure.complete?"Journée sécurisée : tous les collaborateurs sont couverts par un événement, Data RH ou une validation de présence.":`${closure.pending} collaborateur(s) restant(s) à traiter avant la fin de poste.`}</small></div>
      <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:150,height:8,borderRadius:8,background:"#e4ecef",overflow:"hidden"}}><i style={{display:"block",height:"100%",width:`${closure.total?Math.round(closure.validated/closure.total*100):0}%`,background:closure.complete?"#4da46e":"#e3a13b"}}/></div>{data.validation?.canConfirm&&closure.pending>0&&<button disabled={validating} onClick={()=>void confirmTeam()} style={{border:0,borderRadius:11,padding:"11px 14px",background:"#004f9f",color:"#fff",font:"800 9px Exo,Arial,sans-serif",cursor:"pointer"}}>{validating?"VALIDATION…":`RAS · VALIDER LES ${closure.pending} RESTANTS`}</button>}</div>
    </section>}

    <section className={styles.workspace}>
      <article className={styles.roster}>
        <div className={styles.sectionHead}><div><span>POSTE DU {displayDate(focusDate).toUpperCase()}</span><h2>{displayedPeople.length} {eventFilter==="all"?"collaborateur(s)":"concerné(s)"}</h2></div><small>{eventFilter==="all"?"Chaque collaborateur doit être validé avec ou sans événement":`Filtre actif : ${eventFilter==="pending"?"justificatif en attente":KIND_LABEL[eventFilter as Kind]}`}</small></div>
        <div className={styles.peopleGrid}>
          {displayedPeople.map(person=>{const daily=(eventsByEmployee.get(person.employeeKey)??[]).filter(item=>item.kind==="absence"?inRange(focusDate,item):item.startDate===focusDate);const absence=daily.find(item=>item.kind==="absence");const validation=validationMap.get(person.employeeKey);const state=validation?.state??"pending";const locked=Boolean(validation?.locked);return <div key={person.employeeKey} className={`${styles.personCard} ${absence?styles.personAbsent:""}`}>
            <div className={styles.personTop}><div><strong>{person.name}</strong><span>{person.team?`Équipe ${person.team}`:"Journée"} · {SECTOR_LABEL[person.sector??""]??person.service??"—"}</span></div>{absence?<b className={styles.absenceBadge}>{LABELS[absence.reason]??"Absent"}{absence.durationHours?` · ${num(Number(absence.durationHours),1)} h`:""}</b>:state==="data_rh"?<b className={styles.presentBadge}>DATA RH · VERROUILLÉ</b>:state==="no_event"?<b className={styles.presentBadge}>PRÉSENCE VALIDÉE</b>:state==="event"?<b className={styles.presentBadge}>ÉVÉNEMENT SAISI</b>:<b style={{fontSize:9,padding:"5px 8px",borderRadius:8,background:"#fff2da",color:"#a36b14"}}>À VALIDER</b>}</div>
            {daily.filter(item=>item.kind!=="absence").map(item=><div key={item.id} className={`${styles.inlineEvent} ${item.kind==="late"?styles.late:styles.early}`}>{KIND_LABEL[item.kind]} {item.eventTime?`· ${item.eventTime}`:item.durationHours?`· ${num(Number(item.durationHours),1)} h`:""}</div>)}
            <div className={styles.quick}>{data.validation?.canConfirm&&state==="pending"&&<button disabled={validating} onClick={()=>void confirmPresence(person)}>✓ PRÉSENCE OK</button>}{locked?<button disabled>{state==="data_rh"?"VERROUILLÉ DATA RH":"PRÉSENCE VERROUILLÉE"}</button>:<><button onClick={()=>openEvent(person,"absence")}>ABSENT</button><button onClick={()=>openEvent(person,"late")}>RETARD</button><button onClick={()=>openEvent(person,"early_departure")}>DÉPART + TÔT</button></>}</div>
          </div>})}
          {!displayedPeople.length&&<div className={styles.empty}>Aucun collaborateur dans ce périmètre et ce filtre.</div>}
        </div>
      </article>

      <article className={styles.history}>
        <div className={styles.sectionHead}><div><span>HISTORIQUE · {displayDate(from)} → {displayDate(to)}</span><h2>Événements & historique Data RH</h2></div><small>{historyEvents.length} événement(s)</small></div>
        <div className={styles.historyList}>{historyEvents.map(row=><div className={styles.historyRow} key={row.id}>
          <div className={`${styles.kindDot} ${row.kind==="absence"?styles.absent:row.kind==="late"?styles.late:styles.early}`}/><div className={styles.historyMain}><strong>{row.employeeName}</strong><span>{KIND_LABEL[row.kind]} · {LABELS[row.reason]??row.reason}{row.durationHours?` · ${num(Number(row.durationHours),1)} h`:""}</span><small>{row.startDate===row.endDate?displayDate(row.startDate):`${displayDate(row.startDate)} → ${displayDate(row.endDate)}`}{row.eventTime?` · ${row.eventTime}`:""} · {SECTOR_LABEL[row.sector??""]??row.sector??"—"} · {row.source==="data_rh"?"source Data RH":`déclaré par ${row.createdBy}`}</small>{row.comment&&<p>{row.comment}</p>}</div>
          <div className={styles.historyStatus}><b className={row.status==="closed"?styles.locked:""}>{row.status==="closed"?"CLÔTURÉ RH":"OUVERT"}</b>{row.justification==="pending"&&<em>JUSTIFICATIF ATTENDU</em>}{row.source==="data_rh"?<small>DATA RH</small>:row.closedBy&&<small>{row.closedBy}</small>}</div>
          <div className={styles.rowActions}>{row.source==="data_rh"?null:data.access.canClose?(row.status==="open"?<button onClick={()=>void setStatus(row,"close")}>CLÔTURER</button>:<button onClick={()=>void setStatus(row,"reopen")}>RÉOUVRIR</button>):row.status==="open"&&<button onClick={()=>void setStatus(row,"cancel")}>ANNULER</button>}</div>
        </div>)}{!historyEvents.length&&<div className={styles.empty}>Aucun événement sur cette période.</div>}</div>
      </article>
    </section>

    {selected&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.target===e.currentTarget)closeModal();}}><form className={styles.modal} onSubmit={submitEvent}><div className={styles.modalHead}><div><span>DÉCLARER · {KIND_LABEL[kind].toUpperCase()}</span><h2>{selected.name}</h2><p>{selected.team?`Équipe ${selected.team}`:"Journée"} · {SECTOR_LABEL[selected.sector??""]??selected.service??"—"} · {selectedShift?.start?`poste ${selectedShift.start} → ${selectedShift.end}`:"horaire de poste non disponible"}</p></div><button type="button" onClick={closeModal}>×</button></div><div className={styles.kindTabs}>{(["absence","late","early_departure"] as Kind[]).map(value=><button type="button" className={kind===value?styles.active:""} onClick={()=>{setKind(value);const shift=selectedShift;if(value==="late")setEventTime(shift?.start??"");else if(value==="early_departure")setEventTime(shift?.end??"");else setEventTime("");}} key={value}>{KIND_LABEL[value]}</button>)}</div><label>MOTIF<select value={reason} onChange={e=>setReason(e.target.value)}>{REASONS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><div className={styles.modalDates}><label>DU<input type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);if(kind!=="absence")setEndDate(e.target.value);}}/></label>{kind==="absence"&&<label>AU<input type="date" min={startDate} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>}{kind!=="absence"&&<label>HEURE RÉELLE<input type="time" value={eventTime} onChange={e=>setEventTime(e.target.value)} required/></label>}</div><label>COMMENTAIRE<textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Information utile pour RH…" rows={3}/></label><div className={styles.modalFoot}><button type="button" className={styles.secondary} onClick={closeModal}>ANNULER</button><button disabled={saving}>{saving?"ENREGISTREMENT…":"VALIDER LA DÉCLARATION"}</button></div></form></div>}

    {settings&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false);}}><section className={styles.modal}><div className={styles.modalHead}><div><span>PARAMÉTRAGE RH</span><h2>Horaires & rotation</h2><p>Cette semaine est actuellement calculée automatiquement depuis l’ancre A/B.</p></div><button onClick={()=>setSettings(false)}>×</button></div><div className={styles.rotationBox}><strong>Rotation A / B</strong><p>Choisir l’équipe du matin pour la semaine en cours. Les semaines suivantes alternent automatiquement.</p><div><button onClick={()=>void setRotation(true)}>A MATIN CETTE SEMAINE</button><button onClick={()=>void setRotation(false)}>B MATIN CETTE SEMAINE</button></div></div><div className={styles.simpleList}>{data.shifts.map(shift=><div key={shift.team}><strong>{shift.label}</strong><span>{shiftText(shift)}</span></div>)}</section></div>}

    {personPanel&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.target===e.currentTarget)setPersonPanel(false);}}><section className={styles.modal}><div className={styles.modalHead}><div><span>TRANSPHÈRE</span><h2>Référentiel collaborateurs</h2><p>Utilisé tant qu’aucune source RH Transphère n’est raccordée.</p></div><button onClick={()=>setPersonPanel(false)}>×</button></div><form className={styles.personForm} onSubmit={addTranspherePerson}><label>NOM<input name="name" required/></label><label>IDENTIFIANT / MATRICULE<input name="key" required/></label><label>ÉQUIPE<input name="team" defaultValue="TRANSPHERE" required/></label><label>SERVICE<input name="service"/></label><button>AJOUTER</button></form><div className={styles.simpleList}>{data.people.map(person=><div key={person.employeeKey}><strong>{person.name}</strong><span>{person.employeeKey} · {person.team}</span></div>)}</div></section></div>}
  </main>;
}
