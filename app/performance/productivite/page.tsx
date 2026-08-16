"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./productivite.module.css";
import PolycompetenceSuggestions from "./polycompetence-suggestions";

type Row = { sectorKey:string; sectorLabel:string; workcenterKey:string; workcenterLabel:string; teamCode?:string; mechanicName?:string; boughtHours:number; soldHours:number|null; productivity:number|null; individualAvailable?:boolean };
type Payload = { month:string; availableMonths:string[]; allowedSectors?:string[]; totals:{boughtHours:number;soldHours:number;productivity:number|null}; sectors:Row[]; teams:Row[]; collaborators:Row[]; error?:string };
type View = "sector"|"team"|"person";

function currentMonth(){const parts=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(new Date());return `${parts.find(p=>p.type==="year")?.value}-${parts.find(p=>p.type==="month")?.value}`;}
function hours(value:number|null|undefined){return Number(value??0).toLocaleString("fr-FR",{minimumFractionDigits:1,maximumFractionDigits:1});}
function pct(value:number|null|undefined){return value==null?"—":`${Number(value).toLocaleString("fr-FR",{minimumFractionDigits:1,maximumFractionDigits:1})} %`;}
function monthLabel(value:string){const [year,month]=value.split("-").map(Number);return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric"}).format(new Date(year,month-1,1));}
function tone(value:number|null){if(value==null)return "";if(value>=100)return styles.good;if(value>=85)return styles.watch;return styles.low;}
function teamLabel(value:string){return value==="NON_AFFECTEE"?"Non affectée":`Équipe ${value}`;}

export default function ProductivitePage(){
  const [month,setMonth]=useState(currentMonth());
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [view,setView]=useState<View>("sector");
  const [sector,setSector]=useState("all");
  const [team,setTeam]=useState("all");
  const [collaborator,setCollaborator]=useState("all");

  useEffect(()=>{let active=true;setLoading(true);setError("");fetch(`/api/productivity?month=${encodeURIComponent(month)}`,{cache:"no-store"}).then(async r=>{const p=await r.json() as Payload;if(!r.ok||p.error)throw new Error(p.error||`HTTP ${r.status}`);if(active)setData(p);}).catch(e=>active&&setError(e instanceof Error?e.message:"Lecture impossible")).finally(()=>active&&setLoading(false));return()=>{active=false};},[month]);

  const sectorOptions=useMemo(()=>{const map=new Map<string,string>();(data?.sectors??[]).forEach(row=>map.set(row.sectorKey,row.sectorLabel));return [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],"fr"));},[data]);
  const teamOptions=useMemo(()=>{const values=new Set<string>();(data?.teams??[]).forEach(row=>{if((sector==="all"||row.sectorKey===sector)&&row.teamCode)values.add(row.teamCode);});return [...values].sort((a,b)=>a.localeCompare(b,"fr"));},[data,sector]);
  const collaboratorOptions=useMemo(()=>{const map=new Map<string,string>();(data?.collaborators??[]).forEach(row=>{if(sector!=="all"&&row.sectorKey!==sector)return;if(team!=="all"&&row.teamCode!==team)return;if(row.mechanicName)map.set(row.mechanicName,row.mechanicName);});return [...map.keys()].sort((a,b)=>a.localeCompare(b,"fr"));},[data,sector,team]);

  useEffect(()=>{if(sector!=="all"&&!sectorOptions.some(([key])=>key===sector)){setSector("all");setTeam("all");setCollaborator("all");}},[sectorOptions,sector]);
  useEffect(()=>{if(team!=="all"&&!teamOptions.includes(team)){setTeam("all");setCollaborator("all");}},[teamOptions,team]);
  useEffect(()=>{if(collaborator!=="all"&&!collaboratorOptions.includes(collaborator))setCollaborator("all");},[collaboratorOptions,collaborator]);

  const rows=useMemo(()=>{
    const source=view==="sector"?data?.sectors:view==="team"?data?.teams:data?.collaborators;
    return (source??[]).filter(row=>{
      if(sector!=="all"&&row.sectorKey!==sector)return false;
      if(team!=="all"&&row.teamCode!==team)return false;
      if(collaborator!=="all"&&row.mechanicName!==collaborator)return false;
      return true;
    });
  },[data,view,sector,team,collaborator]);

  const filteredTotals=useMemo(()=>{
    if(!data)return {boughtHours:0,soldHours:0,productivity:null as number|null,individualBlocked:false};
    if(sector==="all"&&team==="all"&&collaborator==="all")return {...data.totals,individualBlocked:false};
    let source:Row[];
    if(collaborator!=="all")source=data.collaborators;
    else if(team!=="all")source=data.teams;
    else source=data.sectors;
    const selected=source.filter(row=>(sector==="all"||row.sectorKey===sector)&&(team==="all"||row.teamCode===team)&&(collaborator==="all"||row.mechanicName===collaborator));
    const boughtHours=selected.reduce((sum,row)=>sum+Number(row.boughtHours||0),0);
    const individualBlocked=collaborator!=="all"&&selected.some(row=>row.individualAvailable===false);
    const soldHours=selected.reduce((sum,row)=>sum+Number(row.soldHours??0),0);
    const productivity=!individualBlocked&&boughtHours>0?soldHours/boughtHours*100:null;
    return {boughtHours,soldHours,productivity,individualBlocked};
  },[data,sector,team,collaborator]);

  const filterLabel=useMemo(()=>{
    const parts:string[]=[];
    if(sector!=="all")parts.push(sectorOptions.find(([key])=>key===sector)?.[1]??sector);
    if(team!=="all")parts.push(teamLabel(team));
    if(collaborator!=="all")parts.push(collaborator);
    return parts.length?parts.join(" · "):"Tous les périmètres autorisés";
  },[sector,team,collaborator,sectorOptions]);

  function changeSector(value:string){setSector(value);setTeam("all");setCollaborator("all");if(value!=="all")setView("sector");}
  function changeTeam(value:string){setTeam(value);setCollaborator("all");if(value!=="all")setView("team");}
  function changeCollaborator(value:string){setCollaborator(value);if(value!=="all")setView("person");}

  return <main className={styles.page}>
    <header className={styles.hero}><div><a href="/" className={styles.back}>← PERFORMANCE</a><span>PERFORMANCE MENSUELLE</span><h1>Productivité</h1><p>Heures vendues ÷ heures de présence. Les données affichées sont automatiquement limitées au périmètre autorisé pour le compte connecté.</p></div><div className={styles.filters}>
      <label>Mois<select value={month} onChange={e=>setMonth(e.target.value)}>{[...new Set([month,...(data?.availableMonths??[])])].sort().reverse().map(item=><option key={item} value={item}>{monthLabel(item)}</option>)}</select></label>
      <label>Secteur<select value={sector} onChange={e=>changeSector(e.target.value)}><option value="all">Tous les secteurs autorisés</option>{sectorOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Équipe<select value={team} onChange={e=>changeTeam(e.target.value)}><option value="all">Toutes les équipes</option>{teamOptions.map(item=><option key={item} value={item}>{teamLabel(item)}</option>)}</select></label>
      <label>Collaborateur<select value={collaborator} onChange={e=>changeCollaborator(e.target.value)}><option value="all">Tous les collaborateurs</option>{collaboratorOptions.map(item=><option key={item} value={item}>{item}</option>)}</select></label>
    </div></header>
    {error&&<div className={styles.error}>{error}</div>}
    <div className={styles.filterSummary}><span>PÉRIMÈTRE AFFICHÉ</span><strong>{filterLabel}</strong></div>
    <section className={styles.kpis}><article><span>HEURES ACHETÉES</span><strong>{loading?"…":hours(filteredTotals.boughtHours)} h</strong><small>Présence métier confirmée</small></article><article><span>HEURES VENDUES</span><strong>{loading?"…":filteredTotals.individualBlocked?"ÉQUIPE":`${hours(filteredTotals.soldHours)} h`}</strong><small>{filteredTotals.individualBlocked?"Fixline : mesure collective":"Interventions facturées"}</small></article><article><span>PRODUCTIVITÉ</span><strong className={tone(filteredTotals.productivity)}>{loading?"…":filteredTotals.individualBlocked?"Équipe uniquement":pct(filteredTotals.productivity)}</strong><small>Vendu / acheté</small></article></section>
    <PolycompetenceSuggestions month={month}/>
    <section className={styles.panel}><div className={styles.panelHead}><div><span>LECTURE</span><h2>{view==="sector"?"Par secteur":view==="team"?"Par équipe":"Par collaborateur"}</h2></div><div className={styles.tabs}><button className={view==="sector"?styles.active:""} onClick={()=>setView("sector")}>Secteurs</button><button className={view==="team"?styles.active:""} onClick={()=>setView("team")}>Équipes</button><button className={view==="person"?styles.active:""} onClick={()=>setView("person")}>Collaborateurs</button></div></div>
      <div className={styles.notice}><b>FIXLINE</b><span>Pas de productivité individuelle. Les heures facturées sont mesurées au niveau de l’équipe et attribuées aux superviseurs A / B / C ; les collaborateurs Fixline affichent donc « Équipe uniquement ».</span></div>
      <div className={styles.tableWrap}><table><thead><tr><th>{view==="person"?"Collaborateur":"Secteur / activité"}</th>{view!=="sector"&&<th>Équipe</th>}{view==="person"&&<th>Activité</th>}<th>Heures achetées</th><th>Heures vendues</th><th>Productivité</th></tr></thead><tbody>{!loading&&rows.map((row,index)=><tr key={`${row.mechanicName??row.workcenterKey}-${row.teamCode??""}-${index}`}><td><strong>{view==="person"?row.mechanicName:`${row.sectorLabel} · ${row.workcenterLabel}`}</strong></td>{view!=="sector"&&<td><span className={styles.team}>{row.teamCode==="NON_AFFECTEE"?"—":row.teamCode}</span></td>}{view==="person"&&<td>{row.sectorLabel} · {row.workcenterLabel}</td>}<td>{hours(row.boughtHours)} h</td><td>{view==="person"&&row.individualAvailable===false?<em>Équipe uniquement</em>:`${hours(row.soldHours)} h`}</td><td><b className={tone(row.productivity)}>{view==="person"&&row.individualAvailable===false?"Équipe uniquement":pct(row.productivity)}</b></td></tr>)}{!loading&&!rows.length&&<tr><td colSpan={6} className={styles.empty}>Aucune donnée pour ce filtre et ce mois.</td></tr>}</tbody></table></div>
    </section>
  </main>;
}
