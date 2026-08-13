"use client";

import { useEffect, useMemo, useState } from "react";
import "./dashboard-client.css";

type Row = Record<string, string | number | boolean | null>;
type History = { event_date:string; event_time:string|null; status:string|null; client?:string|null; work_order:string|null; registration:string|null; flow:string|null };
type ListPayload = { clients:Row[]; totalClients:number; totalVehicles:number; updatedAt:string|null };
type DetailPayload = { client:string; summary:Row; vehicles:Row[]; timeReady:boolean; timeMessage:string };
type FocusPayload = { vehicle:Row; history:History[] };
type BmwPayload = DetailPayload & { history:History[]; metrics:{ vehicleCount:number; urgentCount:number; averageAgeDays:number; medianAgeDays:number; oldestAgeDays:number; historyEventCount:number; positions:Array<{position:string;count:number}>; movements:Array<{registration:string|null;workOrder:string|null;lastEventDate:string|null;lastEventTime:string|null;lastStatus:string|null;eventCount:number}> } };
type Mode = "clients" | "bmw";
type SectorKey = typeof sectors[number][0];

const sectors = [
  ["pending_expertise","Expertise"],["pending_chiffrage","Chiffrage"],["pending_controle_technique","Contrôle technique"],["pending_dsp","DSP"],["pending_jantes","Jantes"],["pending_mecanique","Mécanique"],["pending_carrosserie","Carrosserie"],["pending_preparation","Préparation"],["pending_qualite","Qualité"],["pending_sortie_usine","Sortie usine"],
] as const;
const summarySectors = [
  ["expertise_count","pending_expertise","Expertise"],["chiffrage_count","pending_chiffrage","Chiffrage"],["controle_technique_count","pending_controle_technique","Contrôle technique"],["dsp_count","pending_dsp","DSP"],["jantes_count","pending_jantes","Jantes"],["mecanique_count","pending_mecanique","Mécanique"],["carrosserie_count","pending_carrosserie","Carrosserie"],["preparation_count","pending_preparation","Préparation"],["qualite_count","pending_qualite","Qualité"],["sortie_usine_count","pending_sortie_usine","Sortie usine"],
] as const;
function n(v:unknown){const x=Number(v);return Number.isFinite(x)?x:0;}
function fmt(v:unknown,max=1){return n(v).toLocaleString("fr-FR",{maximumFractionDigits:max});}
function age(v:unknown){const x=Number(v);return Number.isFinite(x)?`${x.toLocaleString("fr-FR",{maximumFractionDigits:1})} j`:"—";}
function km(v:unknown){const x=Number(v);return Number.isFinite(x)?`${Math.round(x).toLocaleString("fr-FR")} km`:"—";}
function frDateTime(date:string|null,time?:string|null){if(!date)return"—";const d=new Date(`${date}T${time||"00:00:00"}`);if(Number.isNaN(d.getTime()))return date;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:time?"2-digit":undefined,minute:time?"2-digit":undefined,timeZone:"Europe/Paris"}).format(d);}
function remaining(v:Row){return sectors.filter(([key])=>Boolean(v[key])).map(([,label])=>label);}
function csvCell(value:unknown){return `"${String(value??"").replaceAll('"','""')}"`;}

export default function DashboardClientPage(){
  const [mode,setMode]=useState<Mode>("clients");
  const [list,setList]=useState<ListPayload|null>(null);
  const [detail,setDetail]=useState<DetailPayload|null>(null);
  const [bmw,setBmw]=useState<BmwPayload|null>(null);
  const [selected,setSelected]=useState("");
  const [clientSearch,setClientSearch]=useState("");
  const [registration,setRegistration]=useState("");
  const [focus,setFocus]=useState<FocusPayload|null>(null);
  const [focusError,setFocusError]=useState("");
  const [sectorFilter,setSectorFilter]=useState<SectorKey|null>(null);
  const [loading,setLoading]=useState(true);

  async function get<T>(url:string){const r=await fetch(`${url}${url.includes("?")?"&":"?"}_=${Date.now()}`,{cache:"no-store"});const p=await r.json();if(!r.ok)throw new Error(p.error||"Donnée indisponible");return p as T;}
  async function loadList(){const p=await get<ListPayload>("/api/client-dashboard");setList(p);setSelected(s=>s||String(p.clients[0]?.client??""));}
  async function loadClient(client:string){if(!client)return;setLoading(true);try{setDetail(await get<DetailPayload>(`/api/client-dashboard?client=${encodeURIComponent(client)}`));}finally{setLoading(false);}}
  async function loadBmw(){setLoading(true);try{setBmw(await get<BmwPayload>("/api/client-dashboard?bmw=1"));}finally{setLoading(false);}}
  async function openRegistration(value:string){const q=value.trim().toUpperCase();if(!q)return;setRegistration(q);setFocusError("");try{const p=await get<FocusPayload>(`/api/client-dashboard?registration=${encodeURIComponent(q)}`);setFocus(p);window.setTimeout(()=>document.getElementById("dossier-focus")?.scrollIntoView({behavior:"smooth",block:"start"}),40);}catch(e){setFocus(null);setFocusError(e instanceof Error?e.message:"Dossier introuvable");}}
  async function searchRegistration(event?:React.FormEvent){event?.preventDefault();await openRegistration(registration);}
  function closeFocus(){setFocus(null);setFocusError("");window.setTimeout(()=>document.getElementById("vehicle-list")?.scrollIntoView({behavior:"smooth",block:"start"}),30);}

  useEffect(()=>{void loadList();const t=window.setInterval(()=>void loadList(),300000);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(mode==="clients"&&selected)void loadClient(selected);setSectorFilter(null);},[selected,mode]);
  useEffect(()=>{if(mode==="bmw")void loadBmw();},[mode]);
  useEffect(()=>{const t=window.setInterval(()=>{if(mode==="clients"&&selected)void loadClient(selected);if(mode==="bmw")void loadBmw();},60000);return()=>clearInterval(t);},[mode,selected]);

  const clients=useMemo(()=>{const q=clientSearch.trim().toLocaleLowerCase("fr");return [...(list?.clients??[])].sort((a,b)=>String(a.client).localeCompare(String(b.client),"fr",{sensitivity:"base"})).filter(c=>!q||String(c.client).toLocaleLowerCase("fr").includes(q));},[list,clientSearch]);
  const active=mode==="bmw"?bmw:detail;
  const summary=active?.summary;
  const vehicles=active?.vehicles??[];
  const total=n(summary?.vehicle_count);
  const filteredVehicles=useMemo(()=>sectorFilter?vehicles.filter(v=>Boolean(v[sectorFilter])):vehicles,[vehicles,sectorFilter]);
  const activeFilterLabel=sectorFilter?sectors.find(([key])=>key===sectorFilter)?.[1]??null:null;

  function exportCsv(){if(!active)return;const movementMap=new Map((bmw?.metrics.movements??[]).map(m=>[String(m.registration??""),m]));const rowsToExport=sectorFilter?filteredVehicles:vehicles;const headers=["Client","Immatriculation","OR","VIN","Modèle","Kilométrage","Position actuelle","Ancienneté usine","Ancienneté position","Travaux restant","Dernier mouvement"];
    const rows=rowsToExport.map(v=>{const m=movementMap.get(String(v.registration??""));return [active.client,v.registration,v.work_order,v.vin,v.model,v.mileage,v.status,v.factory_age_days,v.status_age_days,remaining(v).join(" | "),m?frDateTime(m.lastEventDate,m.lastEventTime):""].map(csvCell).join(";");});
    const blob=new Blob(["\ufeff"+[headers.map(csvCell).join(";"),...rows].join("\n")],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`CRVO_Dashboard_${mode==="bmw"?"BMW_France":active.client.replace(/[^a-z0-9]+/gi,"_")}${activeFilterLabel?`_${activeFilterLabel.replace(/[^a-z0-9]+/gi,"_")}`:""}.csv`;a.click();URL.revokeObjectURL(a.href);
  }

  return <main className={`dc-page ${mode==="bmw"?"dc-bmw-mode":""}`}>
    <header className="dc-header"><div><a href="/" className="dc-back">← REPORTING CRVO</a><span>REPORTING CLIENT · CRVO LENS</span><h1>Dashboard client</h1><p>Situation du parc, charge restante, position des véhicules et suivi détaillé des dossiers.</p></div><div className="dc-updated"><span>DERNIÈRE ACTUALISATION</span><strong>{active?.summary?.source_modified_at?frDateTime(String(active.summary.source_modified_at).slice(0,10),String(active.summary.source_modified_at).slice(11,19)):list?.updatedAt?new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit",timeZone:"Europe/Paris"}).format(new Date(list.updatedAt)):"—"}</strong><small>Mise à jour automatique chaque minute</small></div></header>

    <nav className="dc-tabs no-print"><button className={mode==="clients"?"active":""} onClick={()=>setMode("clients")}>Dashboard client</button><button className={mode==="bmw"?"active":""} onClick={()=>setMode("bmw")}>BMW France · suivi dédié</button></nav>

    <section className="dc-focus-search no-print"><div><span>RECHERCHE DOSSIER</span><h2>Focus par immatriculation</h2><p>Retrouver immédiatement la position, ce qu’il reste à faire et l’historique complet des mouvements.</p></div><form onSubmit={searchRegistration}><input value={registration} onChange={e=>setRegistration(e.target.value.toUpperCase())} placeholder="Ex. HH910QA" autoComplete="off" spellCheck={false}/><button>RECHERCHER</button></form></section>
    {focusError&&<div className="dc-error">{focusError}</div>}
    {focus&&<DossierFocus payload={focus} onClose={closeFocus}/>} 

    {mode==="clients"&&<section className="dc-toolbar no-print"><label><span>RECHERCHER UN CLIENT</span><input value={clientSearch} onChange={e=>setClientSearch(e.target.value)} placeholder="Nom du client…"/></label><label><span>CLIENT SÉLECTIONNÉ</span><select value={selected} onChange={e=>setSelected(e.target.value)}>{clients.map(c=><option key={String(c.client)} value={String(c.client)}>{String(c.client)}</option>)}</select></label><button onClick={()=>window.print()}>EXPORTER PDF</button><button onClick={exportCsv}>EXPORTER CSV</button></section>}
    {mode==="bmw"&&<section className="dc-toolbar dc-bmw-toolbar no-print"><div><span>PÉRIMÈTRE DÉDIÉ</span><strong>BMW FRANCE PRESTATIONS</strong></div><button onClick={()=>window.print()}>EXPORTER PDF CLIENT</button><button onClick={exportCsv}>EXPORTER CSV CLIENT</button></section>}

    {loading&&!active&&<div className="dc-loading">Préparation du dashboard…</div>}
    {active&&summary&&<>
      <section className="dc-client-title"><div><span>CLIENT</span><h2>{mode==="bmw"?"BMW France":active.client}</h2></div><div><span>VÉHICULES EN COURS</span><strong>{total}</strong></div>{mode==="bmw"&&bmw&&<><div><span>ÂGE MOYEN</span><strong>{fmt(bmw.metrics.averageAgeDays)} j</strong></div><div><span>PLUS ANCIEN</span><strong>{fmt(bmw.metrics.oldestAgeDays)} j</strong></div></>}</section>
      <section className="dc-age-grid"><article className="total"><span>PARC EN COURS</span><strong>{total}</strong><small>véhicules</small></article><article><span>0–15 JOURS</span><strong>{n(summary.age_0_15)}</strong><small>{total?Math.round(n(summary.age_0_15)/total*100):0}%</small></article><article><span>16–20 JOURS</span><strong>{n(summary.age_16_20)}</strong><small>{total?Math.round(n(summary.age_16_20)/total*100):0}%</small></article><article className="watch"><span>21–30 JOURS</span><strong>{n(summary.age_21_30)}</strong><small>{total?Math.round(n(summary.age_21_30)/total*100):0}%</small></article><article className="risk"><span>31 JOURS ET +</span><strong>{n(summary.age_31_plus)}</strong><small>{total?Math.round(n(summary.age_31_plus)/total*100):0}%</small></article></section>

      <section className="dc-section"><div className="dc-section-head"><div><span>CHARGE RESTANTE</span><h3>Travaux restant à réaliser</h3></div><p>Cliquez sur une activité pour filtrer immédiatement la liste des véhicules concernés. Cliquez une seconde fois pour retirer le filtre.</p></div><div className="dc-sector-grid">{summarySectors.map(([countKey,pendingKey,label])=><button type="button" key={countKey} className={sectorFilter===pendingKey?"active":""} onClick={()=>{setSectorFilter(current=>current===pendingKey?null:pendingKey);window.setTimeout(()=>document.getElementById("vehicle-list")?.scrollIntoView({behavior:"smooth",block:"start"}),20);}}><span>{label}</span><strong>{n(summary[countKey])}</strong><small>{sectorFilter===pendingKey?"FILTRE ACTIF":"FILTRER LE PARC"}</small></button>)}</div>{sectorFilter&&<div className="dc-filter-state"><strong>Filtre actif · {activeFilterLabel}</strong><span>{filteredVehicles.length} véhicule{filteredVehicles.length>1?"s":""} concerné{filteredVehicles.length>1?"s":""}</span><button className="no-print" onClick={()=>setSectorFilter(null)}>AFFICHER TOUT LE PARC</button></div>}</section>

      {mode==="bmw"&&bmw&&<BmwPrecision payload={bmw}/>} 

      <section className="dc-future"><div><span>CAPACITÉ PRÉVUE</span><h3>Heures & main-d’œuvre restantes</h3><p>{active.timeMessage}</p></div><div><span>HEURES RESTANTES</span><strong>À VENIR</strong></div><div><span>MO RESTANTE</span><strong>À VENIR</strong></div></section>

      <section className="dc-section" id="vehicle-list"><div className="dc-section-head"><div><span>DÉTAIL DU PARC</span><h3>{filteredVehicles.length} véhicule{filteredVehicles.length>1?"s":""}{activeFilterLabel?` · ${activeFilterLabel}`:" en cours"}</h3></div><p>Cliquez sur une immatriculation pour ouvrir immédiatement le journal complet du dossier.</p></div><div className="dc-table-wrap"><table><thead><tr><th>Véhicule</th><th>OR</th><th>Modèle</th><th>Km</th><th>Position du véhicule</th><th>Âge usine</th>{mode==="bmw"&&<th>Dernier mouvement</th>}<th>Point à traiter</th><th>Heures</th></tr></thead><tbody>{filteredVehicles.map((v,index)=>{const move=bmw?.metrics.movements.find(m=>String(m.registration??"")===String(v.registration??""));const reg=String(v.registration??"");return <tr key={`${v.registration}-${v.work_order}-${index}`}><td><button type="button" className="dc-registration-link no-print" onClick={()=>void openRegistration(reg)}>{reg||"—"}</button><strong className="dc-registration-print">{reg||"—"}</strong><small>{String(v.vin??"")}</small></td><td>{String(v.work_order??"—")}</td><td>{String(v.model??"—")}</td><td>{km(v.mileage)}</td><td><strong className="dc-position">{String(v.status??"—")}</strong><small>{age(v.status_age_days)} à cette position</small></td><td><strong>{age(v.factory_age_days??v.status_age_days)}</strong></td>{mode==="bmw"&&<td>{move?frDateTime(move.lastEventDate,move.lastEventTime):"—"}<small>{move?.eventCount??0} événements</small></td>}<td>{String(v.alert??"—")}</td><td className="dc-pending">À venir</td></tr>;})}</tbody></table></div></section>
      <footer className="dc-footer"><span>CRVO Lens · Dashboard client</span><span>{mode==="bmw"?"BMW France":active.client}</span><span>Situation actualisée · document limité au périmètre client sélectionné</span></footer>
    </>}
  </main>;
}

function DossierFocus({payload,onClose}:{payload:FocusPayload;onClose:()=>void}){const v=payload.vehicle;const todo=remaining(v);return <section className="dc-focus" id="dossier-focus"><header><div><span>FOCUS DOSSIER</span><h2>{String(v.registration??"—")}</h2><p>{String(v.client??"—")} · OR {String(v.work_order??"—")}</p></div><button onClick={onClose} className="dc-return-button no-print">← RETOUR AU DASHBOARD</button></header><div className="dc-focus-grid"><article><span>POSITION ACTUELLE</span><strong>{String(v.status??"—")}</strong><small>depuis {age(v.status_age_days)}</small></article><article><span>ANCIENNETÉ USINE</span><strong>{age(v.factory_age_days)}</strong><small>{String(v.model??"")}</small></article><article><span>RESTE À FAIRE</span><strong>{todo.length}</strong><small>{todo.join(" · ")||"Aucun passage identifié"}</small></article><article><span>POINT DE VIGILANCE</span><strong>{String(v.alert??"—")}</strong><small>{/^oui$/i.test(String(v.urgency??""))?"Priorité renforcée":"Suivi normal"}</small></article></div><div className="dc-log"><div className="dc-section-head"><div><span>HISTORIQUE DOSSIER</span><h3>Journal des mouvements</h3></div><p>{payload.history.length} événements disponibles · du plus récent au plus ancien</p></div>{payload.history.length?<ol>{payload.history.map((e,i)=><li key={`${e.event_date}-${e.event_time}-${i}`}><time>{frDateTime(e.event_date,e.event_time)}</time><div><strong>{e.status||"Événement"}</strong><small>{e.work_order?`OR ${e.work_order}`:""}{e.flow?` · ${e.flow}`:""}</small></div></li>)}</ol>:<div className="dc-empty">Aucun événement historique disponible pour ce dossier dans l’historique actuellement chargé.</div>}</div><div className="dc-log-return no-print"><button onClick={onClose}>← Retour à la liste des véhicules</button></div></section>}

function BmwPrecision({payload}:{payload:BmwPayload}){return <section className="dc-bmw-precision"><div className="dc-section-head"><div><span>BMW FRANCE · SUIVI RENFORCÉ</span><h3>Position, mouvement et stabilité des dossiers</h3></div><p>{payload.metrics.historyEventCount} événements historiques analysés sur le périmètre BMW France.</p></div><div className="dc-bmw-metrics"><article><span>ÂGE MÉDIAN</span><strong>{fmt(payload.metrics.medianAgeDays)} j</strong></article><article><span>ÉVÉNEMENTS HISTORIQUES</span><strong>{payload.metrics.historyEventCount}</strong></article><article><span>DOSSIERS SUIVIS</span><strong>{payload.metrics.vehicleCount}</strong></article></div><div className="dc-position-grid">{payload.metrics.positions.map(p=><article key={p.position}><span>{p.position}</span><strong>{p.count}</strong></article>)}</div></section>}
