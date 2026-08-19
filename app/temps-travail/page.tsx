"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./temps-travail.module.css";

type Person={employeeKey:string;matricule?:string|null;name:string;team?:string|null;service?:string|null;jobTitle?:string|null};
type Shift={team:string;label:string;startTime?:string|null;endTime?:string|null};
type EventRow={id:string;entity:string;employeeKey:string;employeeName:string;team?:string|null;service?:string|null;kind:"absence"|"late"|"early_departure";reason:string;startDate:string;endDate:string;eventTime?:string|null;justification:"received"|"pending"|"not_required";comment?:string|null;status:"open"|"closed";createdBy:string;createdAt:string;closedBy?:string|null;closedAt?:string|null};
type Access={profile:string;role:string;teams:string[];canClose:boolean;canConfigure:boolean;canManagePeople:boolean};
type Payload={entity:"CRVO"|"TRANSPHERE";from:string;to:string;people:Person[];events:EventRow[];shifts:Shift[];access:Access;summary:{absentToday:number;lateToday:number;earlyToday:number;pendingJustifications:number;openEvents:number};currentUser?:{name:string;profile:string}};

type Kind=EventRow["kind"];
const REASONS=[
  ["paid_leave","CP / congé payé"],["rtt_recovery","RTT / récupération"],["sick_received","Arrêt maladie - justificatif reçu"],["sick_pending","Arrêt maladie - justificatif en attente"],["unjustified","Absence injustifiée"],["authorized","Absence autorisée"],["training","Formation"],["work_accident","Accident travail / trajet"],["family_leave","Événement familial"],["other","Autre"],
] as const;
const LABELS:Record<string,string>=Object.fromEntries(REASONS);
const KIND_LABEL:Record<Kind,string>={absence:"Absence",late:"Retard",early_departure:"Départ anticipé"};

function parisToday(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function displayDate(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Europe/Paris"}).format(new Date(`${value}T12:00:00+02:00`));}
function inRange(date:string,event:EventRow){return event.startDate<=date&&event.endDate>=date;}
function statusTone(event:EventRow){if(event.status==="closed")return styles.closed;if(event.justification==="pending")return styles.pending;return event.kind==="absence"?styles.absent:event.kind==="late"?styles.late:styles.early;}
function safeFileDate(value:string){return value.replaceAll("-","");}

export default function WorktimePage(){
  const today=parisToday();
  const[entity,setEntity]=useState<"CRVO"|"TRANSPHERE">("CRVO");
  const[from,setFrom]=useState(today);const[to,setTo]=useState(today);const[focusDate,setFocusDate]=useState(today);
  const[data,setData]=useState<Payload|null>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState("");const[notice,setNotice]=useState("");const[search,setSearch]=useState("");
  const[selected,setSelected]=useState<Person|null>(null);const[kind,setKind]=useState<Kind>("absence");const[reason,setReason]=useState("paid_leave");const[startDate,setStartDate]=useState(today);const[endDate,setEndDate]=useState(today);const[eventTime,setEventTime]=useState("");const[comment,setComment]=useState("");const[saving,setSaving]=useState(false);
  const[settings,setSettings]=useState(false);const[personPanel,setPersonPanel]=useState(false);

  async function load(nextEntity=entity,nextFrom=from,nextTo=to){setLoading(true);setError("");try{const response=await fetch(`/api/worktime?entity=${nextEntity}&from=${nextFrom}&to=${nextTo}&_=${Date.now()}`,{cache:"no-store"});const payload=await response.json() as Payload&{error?:string};if(!response.ok)throw new Error(payload.error||"Chargement impossible.");setData(payload);if(payload.entity!==entity)setEntity(payload.entity);}catch(cause){setError(cause instanceof Error?cause.message:"Chargement impossible.");}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);

  const shiftMap=useMemo(()=>new Map((data?.shifts??[]).map(item=>[item.team,item])),[data]);
  const eventsByEmployee=useMemo(()=>{const map=new Map<string,EventRow[]>();for(const event of data?.events??[]){const list=map.get(event.employeeKey)??[];list.push(event);map.set(event.employeeKey,list);}return map;},[data]);
  const filteredPeople=useMemo(()=>{const q=search.trim().toLowerCase();return(data?.people??[]).filter(person=>!q||`${person.name} ${person.team??""} ${person.service??""} ${person.matricule??""}`.toLowerCase().includes(q));},[data,search]);
  const teams=useMemo(()=>[...new Set((data?.people??[]).map(p=>p.team).filter(Boolean) as string[])].sort(),[data]);

  function openEvent(person:Person,nextKind:Kind){const shift=shiftMap.get(person.team??"");setSelected(person);setKind(nextKind);setStartDate(focusDate);setEndDate(focusDate);setReason(nextKind==="absence"?"paid_leave":"other");setComment("");setEventTime(nextKind==="late"?(shift?.startTime??""):nextKind==="early_departure"?(shift?.endTime??""):"");}
  function closeModal(){setSelected(null);}
  async function submitEvent(event:FormEvent){event.preventDefault();if(!selected)return;setSaving(true);setError("");try{const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create",entity:data?.entity??entity,employeeKey:selected.employeeKey,kind,reason,startDate,endDate:kind==="absence"?endDate:startDate,eventTime:kind==="absence"?null:eventTime,comment})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok)throw new Error(payload.error||"Enregistrement impossible.");setNotice(`${KIND_LABEL[kind]} enregistré pour ${selected.name}.`);closeModal();await load();}catch(cause){setError(cause instanceof Error?cause.message:"Enregistrement impossible.");}finally{setSaving(false);}}
  async function setStatus(row:EventRow,action:"close"|"reopen"|"cancel"){if(action==="cancel"&&!confirm(`Annuler l'événement de ${row.employeeName} ?`))return;if(action==="close"&&!confirm(`Clôturer l'événement de ${row.employeeName} ? Le chef d'équipe ne pourra plus le modifier.`))return;const response=await fetch("/api/worktime",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,id:row.id})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok){setError(payload.error||"Modification impossible.");return;}setNotice(action==="close"?"Événement clôturé et verrouillé.":action==="reopen"?"Événement réouvert.":"Événement annulé.");await load();}
  async function updateShift(shift:Shift,start:string,end:string){const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"shift",entity:data?.entity??entity,team:shift.team,label:shift.label,startTime:start||null,endTime:end||null})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok){setError(payload.error||"Horaire impossible à enregistrer.");return;}setNotice(`Horaire ${shift.label} enregistré.`);await load();}
  async function addTranspherePerson(event:FormEvent<HTMLFormElement>){event.preventDefault();const fd=new FormData(event.currentTarget);const name=String(fd.get("name")??"").trim();const key=String(fd.get("key")??"").trim();const team=String(fd.get("team")??"TRANSPHERE").trim();const service=String(fd.get("service")??"").trim();const response=await fetch("/api/worktime",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"person",employeeKey:key,name,team,service,active:true})});const payload=await response.json().catch(()=>({})) as{error?:string};if(!response.ok){setError(payload.error||"Collaborateur impossible à créer.");return;}event.currentTarget.reset();setNotice(`${name} ajouté au référentiel Transphère.`);await load();}

  async function exportXlsx(){if(!data)return;const XLSX=await import("@e965/xlsx");const rows:Array<Record<string,unknown>>=[];for(const event of data.events){let cursor=new Date(`${event.startDate}T12:00:00Z`);const end=new Date(`${event.endDate}T12:00:00Z`);while(cursor<=end){rows.push({Entité:data.entity,Date:cursor.toISOString().slice(0,10),Matricule:data.people.find(p=>p.employeeKey===event.employeeKey)?.matricule??"",Collaborateur:event.employeeName,Équipe:event.team??"",Service:event.service??"",Événement:KIND_LABEL[event.kind],Motif:LABELS[event.reason]??event.reason,Heure:event.eventTime??"",Justificatif:event.justification==="received"?"Reçu":event.justification==="pending"?"En attente":"Non requis",Statut:event.status==="closed"?"Clôturé":"Ouvert",Commentaire:event.comment??"",Déclaré_par:event.createdBy,Déclaré_le:event.createdAt,Clôturé_par:event.closedBy??"",Clôturé_le:event.closedAt??""});cursor.setUTCDate(cursor.getUTCDate()+1);}}
    const sheet=XLSX.utils.json_to_sheet(rows);sheet["!cols"]=[12,12,14,28,10,12,18,32,10,14,12,36,20,20,20,20].map(w=>({wch:w}));const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,"Temps de travail");XLSX.writeFile(book,`Suivi_temps_${data.entity}_${safeFileDate(from)}_${safeFileDate(to)}.xlsx`);}

  function changePeriod(nextFrom:string,nextTo:string){setFrom(nextFrom);setTo(nextTo);if(focusDate<nextFrom||focusDate>nextTo)setFocusDate(nextFrom);void load(entity,nextFrom,nextTo);}
  function changeEntity(next:"CRVO"|"TRANSPHERE"){setEntity(next);void load(next,from,to);}

  if(loading&&!data)return <main className={styles.loading}><div/><strong>Chargement du suivi du temps…</strong></main>;
  if(!data)return <main className={styles.loading}><strong>Suivi du temps indisponible</strong><span>{error}</span></main>;

  const canAll=data.access.canClose||data.access.role==="admin";
  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.title}><span>SUIVI RH · TEMPS DE TRAVAIL</span><h1>Présences & événements</h1><p>{data.entity==="CRVO"?"CRVO Lens":"Transphère"} · déclaration terrain, contrôle RH et traçabilité</p></div>
      <div className={styles.headerActions}>
        {canAll&&<div className={styles.entitySwitch}><button className={data.entity==="CRVO"?styles.active:""} onClick={()=>changeEntity("CRVO")}>CRVO</button><button className={data.entity==="TRANSPHERE"?styles.active:""} onClick={()=>changeEntity("TRANSPHERE")}>TRANSPHÈRE</button></div>}
        {data.access.canClose&&<button className={styles.secondary} onClick={()=>void exportXlsx()}>EXPORT EXCEL</button>}
        {data.access.canConfigure&&<button className={styles.secondary} onClick={()=>setSettings(true)}>HORAIRES</button>}
        {data.entity==="TRANSPHERE"&&data.access.canManagePeople&&<button className={styles.secondary} onClick={()=>setPersonPanel(true)}>COLLABORATEURS</button>}
      </div>
    </header>

    {error&&<div className={styles.error}>{error}</div>}{notice&&<div className={styles.notice}>{notice}<button onClick={()=>setNotice("")}>×</button></div>}

    <section className={styles.summary}>
      <div><span>ABSENTS AUJOURD'HUI</span><strong>{data.summary.absentToday}</strong><small>sur le périmètre visible</small></div>
      <div><span>RETARDS</span><strong>{data.summary.lateToday}</strong><small>déclarés aujourd'hui</small></div>
      <div><span>DÉPARTS ANTICIPÉS</span><strong>{data.summary.earlyToday}</strong><small>déclarés aujourd'hui</small></div>
      <div className={data.summary.pendingJustifications?styles.warningCard:""}><span>JUSTIFICATIFS EN ATTENTE</span><strong>{data.summary.pendingJustifications}</strong><small>{data.summary.openEvents} événement(s) ouvert(s)</small></div>
    </section>

    <section className={styles.controls}>
      <div><label>DU<input type="date" value={from} max={to} onChange={e=>changePeriod(e.target.value,to)}/></label><label>AU<input type="date" value={to} min={from} onChange={e=>changePeriod(from,e.target.value)}/></label></div>
      <label className={styles.focus}>JOUR AFFICHÉ<input type="date" value={focusDate} min={from} max={to} onChange={e=>setFocusDate(e.target.value)}/></label>
      <label className={styles.search}>RECHERCHER<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom, matricule, service…"/></label>
      <div className={styles.scope}><span>PÉRIMÈTRE</span><strong>{data.access.teams.includes("*")?"Tous les collaborateurs":data.access.teams.map(team=>`Équipe ${team}`).join(" · ")}</strong></div>
    </section>

    <section className={styles.shiftStrip}>
      {data.shifts.map(shift=><div key={shift.team}><span>{shift.label}</span><strong>{shift.startTime&&shift.endTime?`${shift.startTime} → ${shift.endTime}`:"HORAIRE À PARAMÉTRER"}</strong></div>)}
    </section>

    <section className={styles.workspace}>
      <article className={styles.roster}>
        <div className={styles.sectionHead}><div><span>POSTE DU {displayDate(focusDate).toUpperCase()}</span><h2>{filteredPeople.length} collaborateurs</h2></div><small>Cliquer pour déclarer en quelques secondes</small></div>
        <div className={styles.peopleGrid}>
          {filteredPeople.map(person=>{const daily=(eventsByEmployee.get(person.employeeKey)??[]).filter(event=>inRange(focusDate,event));const absence=daily.find(e=>e.kind==="absence");return <div key={person.employeeKey} className={`${styles.personCard} ${absence?styles.personAbsent:""}`}>
            <div className={styles.personTop}><div><strong>{person.name}</strong><span>{person.team?`Équipe ${person.team}`:"Sans équipe"} · {person.service??"—"}</span></div>{absence?<b className={styles.absenceBadge}>{LABELS[absence.reason]??"Absent"}</b>:<b className={styles.presentBadge}>PRÉSENT</b>}</div>
            {daily.filter(e=>e.kind!=="absence").map(e=><div key={e.id} className={`${styles.inlineEvent} ${statusTone(e)}`}>{KIND_LABEL[e.kind]} {e.eventTime?`· ${e.eventTime}`:""}</div>)}
            <div className={styles.quick}><button onClick={()=>openEvent(person,"absence")}>ABSENT</button><button onClick={()=>openEvent(person,"late")}>RETARD</button><button onClick={()=>openEvent(person,"early_departure")}>DÉPART + TÔT</button></div>
          </div>})}
          {!filteredPeople.length&&<div className={styles.empty}>Aucun collaborateur dans ce périmètre.</div>}
        </div>
      </article>

      <article className={styles.history}>
        <div className={styles.sectionHead}><div><span>HISTORIQUE · {displayDate(from)} → {displayDate(to)}</span><h2>Événements déclarés</h2></div><small>{data.events.length} ligne(s)</small></div>
        <div className={styles.historyList}>{data.events.map(row=><div className={styles.historyRow} key={row.id}>
          <div className={`${styles.kindDot} ${statusTone(row)}`}/><div className={styles.historyMain}><strong>{row.employeeName}</strong><span>{KIND_LABEL[row.kind]} · {LABELS[row.reason]??row.reason}</span><small>{row.startDate===row.endDate?displayDate(row.startDate):`${displayDate(row.startDate)} → ${displayDate(row.endDate)}`}{row.eventTime?` · ${row.eventTime}`:""} · déclaré par {row.createdBy}</small>{row.comment&&<p>{row.comment}</p>}</div>
          <div className={styles.historyStatus}><b className={row.status==="closed"?styles.locked:""}>{row.status==="closed"?"CLÔTURÉ RH":"OUVERT"}</b>{row.justification==="pending"&&<em>JUSTIFICATIF ATTENDU</em>}{row.closedBy&&<small>{row.closedBy}</small>}</div>
          <div className={styles.rowActions}>{data.access.canClose?(row.status==="open"?<button onClick={()=>void setStatus(row,"close")}>CLÔTURER</button>:<button onClick={()=>void setStatus(row,"reopen")}>RÉOUVRIR</button>):row.status==="open"&&<button onClick={()=>void setStatus(row,"cancel")}>ANNULER</button>}</div>
        </div>)}{!data.events.length&&<div className={styles.empty}>Aucun événement sur cette période.</div>}</div>
      </article>
    </section>

    {selected&&<div className={styles.modalBackdrop} onMouseDown={e=>{if(e.target===e.currentTarget)closeModal();}}><form className={styles.modal} onSubmit={submitEvent}><div className={styles.modalHead}><div><span>DÉCLARER · {KIND_LABEL[kind].toUpperCase()}</span><h2>{selected.name}</h2><p>{selected.team?`Équipe ${selected.team}`:""} {shiftMap.get(selected.team??"")?.startTime?`· poste ${shiftMap.get(selected.team??"")?.startTime} → ${shiftMap.get(selected.team??"")?.endTime}`:"· horaire de poste non paramétré"}</p></div><button type="button" onClick={closeModal}>×</button></div><div className={styles.kindTabs}>{(["absence","late","early_departure"] as Kind[]).map(value=><button type="button" className={kind===value?styles.active:""} onClick={()=>setKind(value)} key={value}>{KIND_LABEL[value]}</button>)}</div><label>MOTIF<select value={reason} onChange={e=>setReason(e.target.value)}>{REASONS.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><div className={styles.modalDates}><label>DU<input type="date" value={startDate} onChange={e=>{setStartDate(e.target.value);if(kind!=="absence")setEndDate(e.target.value);}}/></label>{kind==="absence"&&<label>AU<input type="date" min={startDate} value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>}{kind!=="absence"&&<label>HEURE RÉELLE<input type="time" value={eventTime} onChange={e=>setEventTime(e.target.value)} required/></label>}</div><label>COMMENTAIRE<textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Information utile pour RH…" rows={3}/></label><div className={styles.modalFoot}><button type="button" className={styles.secondary} onClick={closeModal}>ANNULER</button><button disabled={saving}>{saving?"ENREGISTREMENT…":"VALIDER LA DÉCLARATION"}</button></div></form></div>}

    {settings&&<ShiftSettings shifts={data.shifts} onClose={()=>setSettings(false)} onSave={updateShift}/>} 
    {personPanel&&<div className={styles.modalBackdrop}><div className={styles.modal}><div className={styles.modalHead}><div><span>TRANSPHÈRE</span><h2>Référentiel collaborateurs</h2><p>À utiliser tant qu'aucune source RH Transphère n'est raccordée.</p></div><button onClick={()=>setPersonPanel(false)}>×</button></div><form className={styles.personForm} onSubmit={addTranspherePerson}><label>NOM<input name="name" required/></label><label>IDENTIFIANT / MATRICULE<input name="key" required/></label><label>ÉQUIPE<input name="team" defaultValue="TRANSPHERE" required/></label><label>SERVICE<input name="service"/></label><button>AJOUTER</button></form><div className={styles.simpleList}>{data.people.map(p=><div key={p.employeeKey}><strong>{p.name}</strong><span>{p.employeeKey} · {p.team}</span></div>)}</div></div></div>}
  </main>;
}

function ShiftSettings({shifts,onClose,onSave}:{shifts:Shift[];onClose:()=>void;onSave:(shift:Shift,start:string,end:string)=>Promise<void>}){
  const[values,setValues]=useState<Record<string,{start:string;end:string}>>(()=>Object.fromEntries(shifts.map(s=>[s.team,{start:s.startTime??"",end:s.endTime??""}])));
  return <div className={styles.modalBackdrop}><div className={styles.modal}><div className={styles.modalHead}><div><span>PARAMÉTRAGE RH</span><h2>Horaires de poste</h2><p>Ces horaires servent de référence pour les retards et départs anticipés.</p></div><button onClick={onClose}>×</button></div><div className={styles.shiftEditor}>{shifts.map(shift=><div key={shift.team}><strong>{shift.label}</strong><label>Début<input type="time" value={values[shift.team]?.start??""} onChange={e=>setValues(v=>({...v,[shift.team]:{...(v[shift.team]??{end:""}),start:e.target.value}}))}/></label><label>Fin<input type="time" value={values[shift.team]?.end??""} onChange={e=>setValues(v=>({...v,[shift.team]:{...(v[shift.team]??{start:""}),end:e.target.value}}))}/></label><button onClick={()=>void onSave(shift,values[shift.team]?.start??"",values[shift.team]?.end??"")}>ENREGISTRER</button></div>)}</div></div></div>;
}
