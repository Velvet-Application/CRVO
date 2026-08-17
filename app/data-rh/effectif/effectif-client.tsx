"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./effectif.module.css";

type Skill = { skillKey:string; label:string; sectorKey:string; sectorLabel:string };
type Competency = Skill & {
  status:"active"|"training"|"inactive";
  validatedAt?:string|null; validFrom?:string|null; validUntil?:string|null; note?:string|null;
  lastUsedDate?:string|null; hours90d?:number; jobs90d?:number; days90d?:number;
  soldHours90d?:number|null; boughtHours90d?:number|null; productivity90d?:number|null;
};
type Staff = {
  employeeKey:string; matricule?:string|null; fullName:string; service?:string|null; teamCode?:string|null; jobTitle?:string|null;
  entryDate?:string|null; exitDate?:string|null; employmentStatus:string; active:boolean; primaryPopulation?:string|null; primaryJobKey?:string|null; primaryJobLabel?:string|null;
  primarySectorKey?:string|null; primarySectorLabel?:string|null; boughtHours?:number|null; soldHours?:number|null; productivity?:number|null;
  productivityMode:"individual"|"team_only"|"not_applicable"; jobs?:number; competencies:Competency[]; observedSkills:Competency[]; lastPolyUse?:string|null;
  neutralized?:boolean; neutralizedReason?:string|null; operationalUpdatedAt?:string|null; operationalOverride?:boolean;
  sourceFilename?:string|null; sourceImportedAt?:string|null;
};
type Directory = {
  month:string; availableMonths:string[]; coverage:{presenceThrough?:string|null;billedThrough?:string|null;payrollImportedAt?:string|null};
  counts:{total:number;active:number;exited:number;neutralized?:number;polycompetent:number;observedUnconfirmed:number;missingEntryDate:number;missingPrimaryJob:number};
  skills:Skill[]; staff:Staff[]; error?:string;
};
type StatusFilter = "active"|"neutralized"|"exited"|"all";
type Props = { context?:"data-rh"|"animation" };

function currentMonth(){const p=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).formatToParts(new Date());return `${p.find(x=>x.type==="year")?.value}-${p.find(x=>x.type==="month")?.value}`;}
function todayIso(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function dateLabel(value?:string|null){if(!value)return "—";return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(`${value}T12:00:00`));}
function dt(value?:string|null){if(!value)return "—";return new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
function monthLabel(value:string){const [y,m]=value.split("-").map(Number);return new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric"}).format(new Date(y,m-1,1));}
function hours(v?:number|null){return v==null?"—":`${Number(v).toLocaleString("fr-FR",{maximumFractionDigits:1})} h`;}
function pct(v?:number|null){return v==null?"—":`${Number(v).toLocaleString("fr-FR",{maximumFractionDigits:1})} %`;}
function primaryLabel(row:Staff){return row.primaryJobLabel||row.jobTitle||row.primarySectorLabel||row.primaryJobKey||"À qualifier";}
function productivityLabel(row:Staff){if(row.productivityMode==="team_only")return "Collectif";if(row.productivityMode==="not_applicable")return "N/A";return pct(row.productivity);}
function skillPerf(c:Competency){return c.productivity90d==null?"Performance non disponible":`${pct(c.productivity90d)} · ${hours(c.soldHours90d)} vendues / ${hours(c.boughtHours90d)} achetées`;}

export default function EffectifClient({context="data-rh"}:Props){
  const [month,setMonth]=useState(currentMonth());
  const [data,setData]=useState<Directory|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState<StatusFilter>("active");
  const [service,setService]=useState("all");
  const [team,setTeam]=useState("all");
  const [selectedKey,setSelectedKey]=useState<string|null>(null);
  const [skillKey,setSkillKey]=useState("");
  const [note,setNote]=useState("");
  const [validatedAt,setValidatedAt]=useState(todayIso());
  const [editEntry,setEditEntry]=useState("");
  const [editJob,setEditJob]=useState("");
  const [editTeam,setEditTeam]=useState("");
  const [editNeutralized,setEditNeutralized]=useState(false);
  const [editNeutralReason,setEditNeutralReason]=useState("");
  const [saving,setSaving]=useState(false);

  async function load(){
    setLoading(true);setError("");
    try{const r=await fetch(`/api/staff/directory?month=${encodeURIComponent(month)}`,{cache:"no-store"});const p=await r.json() as Directory;if(!r.ok||p.error)throw new Error(p.error||`HTTP ${r.status}`);setData(p);}
    catch(e){setError(e instanceof Error?e.message:"Lecture RH impossible.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[month]);

  const selected=useMemo(()=>data?.staff.find(x=>x.employeeKey===selectedKey)??null,[data,selectedKey]);
  const services=useMemo(()=>[...new Set((data?.staff??[]).map(x=>x.service).filter((x):x is string=>Boolean(x)))].sort((a,b)=>a.localeCompare(b,"fr")),[data]);
  const teams=useMemo(()=>[...new Set((data?.staff??[]).map(x=>x.teamCode).filter((x):x is string=>Boolean(x)))].sort(),[data]);
  const rows=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase("fr-FR");
    return (data?.staff??[]).filter(row=>{
      if(status==="active"&&(!row.active||row.neutralized))return false;
      if(status==="neutralized"&&(!row.active||!row.neutralized))return false;
      if(status==="exited"&&row.active)return false;
      if(service!=="all"&&row.service!==service)return false;if(team!=="all"&&row.teamCode!==team)return false;
      if(q&&!`${row.fullName} ${row.matricule??""} ${row.service??""} ${row.jobTitle??""} ${row.primaryJobLabel??""} ${row.primarySectorLabel??""}`.toLocaleLowerCase("fr-FR").includes(q))return false;
      return true;
    });
  },[data,status,service,team,search]);

  const availableSkills=useMemo(()=>{
    if(!selected)return [];
    const blocked=new Set([selected.primaryJobKey,...selected.competencies.filter(c=>c.status!=="inactive").map(c=>c.skillKey)].filter(Boolean));
    return (data?.skills??[]).filter(s=>!blocked.has(s.skillKey));
  },[data,selected]);

  function openStaff(row:Staff){
    setSelectedKey(row.employeeKey);setSkillKey("");setNote("");setValidatedAt(todayIso());
    setEditEntry(row.entryDate??"");setEditJob(row.primaryJobKey??"");setEditTeam(row.teamCode??"");
    setEditNeutralized(Boolean(row.neutralized));setEditNeutralReason(row.neutralizedReason??"");
  }

  async function setCompetency(employeeKey:string,targetSkill:string,nextStatus:"active"|"training"|"inactive"){
    setSaving(true);setError("");
    try{
      const r=await fetch("/api/staff/competencies",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employeeKey,skillKey:targetSkill,status:nextStatus,validatedAt:nextStatus==="active"?validatedAt||null:null,note:note||null})});
      const p=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new Error(p.error||"Mise à jour impossible.");setNote("");setSkillKey("");setValidatedAt(todayIso());await load();setSelectedKey(employeeKey);
    }catch(e){setError(e instanceof Error?e.message:"Mise à jour impossible.");}
    finally{setSaving(false);}
  }

  async function saveOperational(){
    if(!selected)return;
    setSaving(true);setError("");
    try{
      const r=await fetch("/api/staff/operational",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        employeeKey:selected.employeeKey,entryDate:editEntry||null,primaryJobKey:editJob||null,teamCode:editTeam||null,
        neutralized:editNeutralized,neutralizedReason:editNeutralized?editNeutralReason||null:null,
      })});
      const p=await r.json().catch(()=>({})) as {error?:string};if(!r.ok)throw new Error(p.error||"Mise à jour RH impossible.");await load();setSelectedKey(selected.employeeKey);
    }catch(e){setError(e instanceof Error?e.message:"Mise à jour RH impossible.");}
    finally{setSaving(false);}
  }

  const coverageWarning=Boolean(data && (data.counts.missingEntryDate>0||data.counts.missingPrimaryJob>0));
  const backHref=context==="animation"?"/":"/data-rh";
  const backLabel=context==="animation"?"← KPI CRVO":"← DATA RH";

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href={backHref} className={styles.back}>{backLabel}</a><span>ANIMATION DU CENTRE · RH & COMPÉTENCES</span><h1>Équipe & polycompétences</h1><p>Une vue opérationnelle de l'effectif : date d'embauche, métier, équipe, rendement, polycompétences et dernière utilisation. Les affectations peuvent être ajustées sans effacer l'historique.</p></div>
      <div className={styles.heroSide}><label>Mois<select value={month} onChange={e=>setMonth(e.target.value)}>{[...new Set([month,...(data?.availableMonths??[])])].sort().reverse().map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label><small>Référentiel RH : {dt(data?.coverage.payrollImportedAt)}</small><small>Pointage vendu : {dateLabel(data?.coverage.billedThrough)}</small><small>Présence : {dateLabel(data?.coverage.presenceThrough)}</small></div>
    </header>

    {error&&<div className={styles.error}>{error}</div>}
    {coverageWarning&&<div className={styles.warning}><strong>Référentiel à compléter.</strong><span>{data?.counts.missingEntryDate??0} date(s) d'embauche manquante(s) · {data?.counts.missingPrimaryJob??0} métier(s) principal(aux) à qualifier. Ces champs peuvent être complétés directement dans la fiche collaborateur.</span></div>}

    <section className={styles.kpis}>
      <article><span>ACTIFS KPI</span><strong>{loading?"…":Math.max(0,(data?.counts.active??0)-(data?.counts.neutralized??0))}</strong><small>Collaborateurs actifs et comptabilisés</small></article>
      <article><span>NEUTRALISÉS KPI</span><strong>{loading?"…":data?.counts.neutralized??0}</strong><small>Historique conservé, calculs opérationnels exclus</small></article>
      <article><span>POLYCOMPÉTENTS VALIDÉS</span><strong>{loading?"…":data?.counts.polycompetent??0}</strong><small>Au moins une compétence active</small></article>
      <article><span>COMPÉTENCES OBSERVÉES</span><strong>{loading?"…":data?.counts.observedUnconfirmed??0}</strong><small>Détectées dans le pointage, à confirmer RH</small></article>
      <article><span>SORTIS</span><strong>{loading?"…":data?.counts.exited??0}</strong><small>Historique conservé</small></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher nom, matricule, métier…"/>
        <select value={status} onChange={e=>setStatus(e.target.value as StatusFilter)}><option value="active">Actifs KPI</option><option value="neutralized">Neutralisés KPI</option><option value="exited">Sortis</option><option value="all">Tous</option></select>
        <select value={service} onChange={e=>setService(e.target.value)}><option value="all">Tous les services</option>{services.map(x=><option key={x} value={x}>{x}</option>)}</select>
        <select value={team} onChange={e=>setTeam(e.target.value)}><option value="all">Toutes les équipes</option>{teams.map(x=><option key={x} value={x}>Équipe {x}</option>)}</select>
        <button onClick={()=>void load()}>ACTUALISER</button>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Collaborateur</th><th>Statut</th><th>Embauche</th><th>Secteur / équipe</th><th>Métier principal</th><th>Performance {monthLabel(month)}</th><th>Polycompétences</th><th>Dernier passage</th><th/></tr></thead><tbody>
        {!loading&&rows.map(row=><tr key={row.employeeKey} className={row.neutralized?styles.neutralizedRow:""}><td><strong>{row.fullName}</strong><small>{row.matricule??"Sans matricule"}</small></td><td>{row.neutralized?<span className={styles.neutralized}>NEUTRALISÉ KPI</span>:<span className={row.active?styles.active:styles.exited}>{row.active?"ACTIF":"SORTI"}</span>}{row.operationalOverride&&<small>Affectation ajustée</small>}</td><td>{dateLabel(row.entryDate)}</td><td><strong>{row.primarySectorLabel??row.service??"—"}</strong><small>{row.teamCode?`Équipe ${row.teamCode}`:"Équipe —"}</small></td><td><strong>{primaryLabel(row)}</strong><small>{row.service??""}</small></td><td><b className={row.productivity!=null&&row.productivity>=100?styles.good:row.productivity!=null&&row.productivity<85?styles.low:""}>{productivityLabel(row)}</b><small>{row.productivityMode==="individual"?`${hours(row.soldHours)} vendues / ${hours(row.boughtHours)} achetées`:row.productivityMode==="team_only"?"Mesure équipe":"Non applicable"}</small></td><td>{row.competencies.length?<span className={styles.skillCount}>{row.competencies.length}</span>:"—"}{row.competencies.slice(0,2).map(c=><small key={c.skillKey}>{c.label} · {dateLabel(c.lastUsedDate)}{c.productivity90d!=null?` · ${pct(c.productivity90d)}`:""}</small>)}{row.observedSkills.length>0&&<small>{row.observedSkills.length} observée(s) à confirmer</small>}</td><td>{dateLabel(row.lastPolyUse)}</td><td><button className={styles.manage} onClick={()=>openStaff(row)}>GÉRER</button></td></tr>)}
        {!loading&&!rows.length&&<tr><td colSpan={9} className={styles.empty}>Aucun collaborateur pour ces filtres.</td></tr>}
      </tbody></table></div>
    </section>

    {selected&&<section className={styles.drawer}>
      <div className={styles.drawerHead}><div><span>FICHE COLLABORATEUR</span><h2>{selected.fullName}</h2><p>{selected.matricule??"Sans matricule"} · {selected.service??"Service non renseigné"} · {selected.teamCode?`Équipe ${selected.teamCode}`:"Équipe non renseignée"}{selected.neutralized?" · NEUTRALISÉ KPI":""}</p></div><button onClick={()=>setSelectedKey(null)}>FERMER</button></div>
      <div className={styles.detailGrid}>
        <article><span>EMBAUCHE</span><strong>{dateLabel(selected.entryDate)}</strong><small>{selected.active?"Collaborateur actif":`Sortie ${dateLabel(selected.exitDate)}`}</small></article>
        <article><span>MÉTIER PRINCIPAL</span><strong>{primaryLabel(selected)}</strong><small>{selected.primarySectorLabel??"À qualifier"}</small></article>
        <article><span>PERFORMANCE DU MOIS</span><strong>{productivityLabel(selected)}</strong><small>{selected.productivityMode==="individual"?`${hours(selected.soldHours)} / ${hours(selected.boughtHours)}`:selected.productivityMode==="team_only"?"Mesure collective":"Non applicable"}</small></article>
        <article><span>POLYCOMPÉTENCES</span><strong>{selected.competencies.length}</strong><small>Dernier passage : {dateLabel(selected.lastPolyUse)}</small></article>
        <article><span>STATUT KPI</span><strong>{selected.neutralized?"Neutralisé":"Comptabilisé"}</strong><small>{selected.neutralizedReason||`Dernière modification ${dt(selected.operationalUpdatedAt)}`}</small></article>
      </div>

      <div className={styles.assignmentBlock}>
        <div className={styles.blockHead}><div><span>AFFECTATION OPÉRATIONNELLE</span><h3>Déplacer, compléter ou neutraliser</h3></div><p>Les changements sont historisés. Neutraliser exclut la personne de Productivité, du Simulateur et des suggestions de polycompétence, sans supprimer son historique RH.</p></div>
        <div className={styles.assignmentGrid}>
          <label>Date d'embauche<input type="date" value={editEntry} onChange={e=>setEditEntry(e.target.value)} disabled={!selected.active||saving}/></label>
          <label>Métier principal<select value={editJob} onChange={e=>setEditJob(e.target.value)} disabled={!selected.active||saving}><option value="">À qualifier</option>{(data?.skills??[]).map(s=><option key={s.skillKey} value={s.skillKey}>{s.sectorLabel} · {s.label}</option>)}</select></label>
          <label>Équipe<select value={editTeam} onChange={e=>setEditTeam(e.target.value)} disabled={!selected.active||saving}><option value="">Non affectée</option><option value="A">Équipe A</option><option value="B">Équipe B</option><option value="C">Équipe C</option></select></label>
          <label className={styles.neutralizeToggle}><input type="checkbox" checked={editNeutralized} onChange={e=>setEditNeutralized(e.target.checked)} disabled={!selected.active||saving}/><span>Neutraliser dans les calculs KPI</span></label>
          {editNeutralized&&<label className={styles.reason}>Motif de neutralisation<input value={editNeutralReason} onChange={e=>setEditNeutralReason(e.target.value)} placeholder="Ex. formation longue, renfort ponctuel, situation à exclure…" disabled={saving}/></label>}
          <button className={styles.saveAssignment} disabled={!selected.active||saving} onClick={()=>void saveOperational()}>{saving?"ENREGISTREMENT…":"ENREGISTRER L'AFFECTATION"}</button>
        </div>
      </div>

      <div className={styles.skillsBlock}><div className={styles.blockHead}><div><span>POLYCOMPÉTENCES VALIDÉES</span><h3>Compétences activables en production</h3></div></div>
        {selected.competencies.length?<div className={styles.skillList}>{selected.competencies.map(c=><article key={c.skillKey}><div><strong>{c.label}</strong><small>{c.status==="training"?"En formation":"Validée"} · validation {dateLabel(c.validatedAt)} · dernier passage {dateLabel(c.lastUsedDate)}</small><small>{Number(c.hours90d??0).toLocaleString("fr-FR",{maximumFractionDigits:1})} h · {c.jobs90d??0} dossier(s) sur 90 jours</small><small className={c.productivity90d!=null&&c.productivity90d>=100?styles.skillGood:c.productivity90d!=null&&c.productivity90d<85?styles.skillLow:""}>Performance sur cette compétence : {skillPerf(c)}</small>{c.note&&<p>{c.note}</p>}</div><button disabled={saving} onClick={()=>void setCompetency(selected.employeeKey,c.skillKey,"inactive")}>DÉSACTIVER</button></article>)}</div>:<p className={styles.blank}>Aucune polycompétence validée.</p>}
      </div>

      {selected.observedSkills.length>0&&<div className={styles.skillsBlock}><div className={styles.blockHead}><div><span>OBSERVÉ DANS LE POINTAGE</span><h3>Compétences à confirmer</h3></div><p>Une observation n'est jamais activée automatiquement.</p></div><div className={styles.skillList}>{selected.observedSkills.map(c=><article key={c.skillKey}><div><strong>{c.label}</strong><small>Dernier passage {dateLabel(c.lastUsedDate)}</small><small>{Number(c.hours90d??0).toLocaleString("fr-FR",{maximumFractionDigits:1})} h · {c.jobs90d??0} dossier(s) sur 90 jours</small><small>Performance observée : {skillPerf(c)}</small></div><button className={styles.confirm} disabled={saving} onClick={()=>void setCompetency(selected.employeeKey,c.skillKey,"active")}>ACTIVER</button></article>)}</div></div>}

      <div className={styles.addSkill}><div><span>AJOUT MANUEL</span><h3>Ajouter une polycompétence</h3><p>La déclaration RH devient la référence. La dernière utilisation et la performance sont ensuite rapprochées automatiquement du pointage lorsqu'elles sont mesurables.</p></div><div><select value={skillKey} onChange={e=>setSkillKey(e.target.value)}><option value="">Choisir une compétence</option>{availableSkills.map(s=><option key={s.skillKey} value={s.skillKey}>{s.sectorLabel} · {s.label}</option>)}</select><input type="date" value={validatedAt} onChange={e=>setValidatedAt(e.target.value)}/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Note facultative : habilitation, restriction…"/><button disabled={!skillKey||saving} onClick={()=>skillKey&&void setCompetency(selected.employeeKey,skillKey,"active")}>ACTIVER LA POLYCOMPÉTENCE</button></div></div>
    </section>}
  </main>;
}
