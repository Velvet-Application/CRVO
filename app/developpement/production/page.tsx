"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./production-dev.module.css";

type Vehicle = {
  snapshotAt:string|null; sourceModifiedAt:string|null; registration:string|null; workOrder:string|null; client:string|null; vin:string|null;
  model:string|null; mileage:number; status:string; statusAt:string|null; statusAgeDays:number; factoryAgeDays:number; alert:string|null; urgency:string|null;
  mechanics:string|null; bodywork:string|null; technicalControl:string|null; dsp:string|null; wheels:string|null; partAvailable:string|null; partOrderedDays:number;
  sourceType:string; processProfile:"EFF"|"BMW"|"AUTRE"|"EXCLU"; inFactory:boolean;
};
type ApiEvent = { source_modified_at:string|null; status:string|null; event_date:string|null; event_time:string|null };
type Payload = {
  connected:boolean; mode:string; sourceModifiedAt:string|null; snapshotAt:string|null; excludedBcaVom:number;
  stats:{totalMirror:number;inFactory:number;inbound:number;partBlocked:number;urgent:number;stale:number};
  vehicles:Vehicle[]; detail?:{vehicle:Vehicle;events:ApiEvent[]}|null; error?:string;
};
type Rule = { threshold:number|null; ctMode:"conditionnel"|"systematique"|"sans_ct"|"a_definir"; partsRequired:boolean; qualityRequired:boolean; photosRequired:boolean };
type LocalEvent = { id:string; at:string; label:string; actor:string; kind:"status"|"task"|"mpr"|"comment" };
type VehicleOverlay = { simulatedStatus?:string; partStatus?:string; tasks?:Record<string,string>; comments?:Array<{id:string;at:string;text:string;actor:string}>; events?:LocalEvent[] };
type SandboxStore = { overlays:Record<string,VehicleOverlay>; rules:{EFF:Rule;BMW:Rule} };
type Tab = "control"|"dossiers"|"mpr"|"rules";

const STORE_KEY="crvo-production-sandbox-v1";
const DEFAULT_RULES:SandboxStore["rules"]={
  EFF:{threshold:1500,ctMode:"conditionnel",partsRequired:true,qualityRequired:true,photosRequired:true},
  BMW:{threshold:null,ctMode:"a_definir",partsRequired:true,qualityRequired:true,photosRequired:true},
};
const STATUS_OPTIONS=[
  "Réceptionné en usine","En attente d'expertise dynamique","En attente de lavage rapide","En attente d'expertise statique",
  "Stocké sur parc d'attente chiffrage","Stocké sur parc d'attente (Départ CT)","Contrôle technique en cours","Stocké sur parc d'attente travaux",
  "En attente de jantes","En attente de DSP","En attente de carrosserie","Carrosserie en cours","En attente de Fixline 1","Fixline 1 en cours",
  "En attente de Fixline 2","Fixline 2 en cours","En attente de Fixline 3","Fixline 3 en cours","En attente de mécanique","Mécanique en cours",
  "En attente de préparation","Préparation en cours","Contrôle qualité en cours","En attente de photo","Photo en cours","Demande de convoyage vers Sortie Usine",
];
const MPR_OPTIONS=["NON RENSEIGNÉ FTP","A COMMANDER","PIECE COMMANDEE","RECEPTION PARTIELLE","PIECE DISPONIBLE","NON CONCERNE"];
const TASK_STATES=["À faire","En cours","Terminé","Non concerné"];
const STAGES=[
  ["expertise","Expertise"],["chiffrage","Chiffrage / validation"],["ct","Contrôle technique"],["mpr","MPR / pièces"],
  ["travaux","Travaux"],["preparation","Préparation"],["qualite","Qualité"],["sortie","Photos / sortie"],["anomalie","Anomalies"],
] as const;

function num(value:unknown){const n=Number(value);return Number.isFinite(n)?n:0;}
function fmtDate(value?:string|null){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function fmtKm(value:number){return `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} km`;}
function vehicleKey(v:Vehicle){return String(v.vin||v.registration||v.workOrder||`${v.client}-${v.model}`);}
function activeStatus(v:Vehicle,store:SandboxStore){return store.overlays[vehicleKey(v)]?.simulatedStatus||v.status;}
function activePart(v:Vehicle,store:SandboxStore){return store.overlays[vehicleKey(v)]?.partStatus||v.partAvailable||"NON RENSEIGNÉ FTP";}
function isYes(value?:string|null){return Boolean(value&&/oui|yes|true|1/i.test(value));}
function stageOf(status:string,partStatus?:string|null){
  const s=status.toLowerCase(),p=(partStatus||"").toLowerCase();
  if(/anomal/.test(s))return "anomalie";
  if(/photo|sortie usine/.test(s))return "sortie";
  if(/qualit/.test(s))return "qualite";
  if(/prépar|prepar/.test(s))return "preparation";
  if(/mécan|mecan|carross|fixline|dsp|jante|restor|travaux/.test(s))return /command|a commander|indisponible|pas d'engagement/.test(p)?"mpr":"travaux";
  if(/contrôle technique|controle technique|départ ct|depart ct/.test(s))return "ct";
  if(/chiffr|devis|validation/.test(s))return "chiffrage";
  if(/expert|lavage|réceptionné|receptionne/.test(s))return "expertise";
  if(/command|a commander|indisponible|pas d'engagement/.test(p))return "mpr";
  return "travaux";
}
function taskStateFromSource(v:Vehicle,label:string){
  const s=v.status.toLowerCase(),key=label.toLowerCase();
  const tokens:Record<string,string[]>={"mécanique":["mécan","mecan"],"carrosserie":["carross"],"fixline":["fixline"],"dsp":["dsp"],"jantes":["jante"],"contrôle technique":["contrôle technique","controle technique","ct"],"préparation":["prépar","prepar"],"qualité":["qualit"],"photos":["photo"]};
  const hit=(tokens[key]||[key]).some(t=>s.includes(t));
  if(hit&&s.includes("en cours"))return "En cours";
  if(hit&&(s.includes("attente")||s.includes("départ")||s.includes("depart")))return "À faire";
  return "À faire";
}
function tasksFor(v:Vehicle){
  const alerts=(v.alert||"").toLowerCase(),status=v.status.toLowerCase();
  const tasks:Array<{label:string;source:string}>=[];
  const add=(label:string,source:string)=>{if(!tasks.some(t=>t.label===label))tasks.push({label,source});};
  if(isYes(v.mechanics)||/mécan|mecan/.test(status)||/mécan|mecan/.test(alerts))add("Mécanique",v.mechanics?`FTP: ${v.mechanics}`:"Déduit du statut / alerte FTP");
  if(isYes(v.bodywork)||/carross/.test(status)||/carross/.test(alerts))add("Carrosserie",v.bodywork?`FTP: ${v.bodywork}`:"Déduit du statut / alerte FTP");
  if(/fixline/.test(status)||/fixline/.test(alerts))add("Fixline","Déduit du statut / alerte FTP");
  if(isYes(v.dsp)||/dsp/.test(status)||/dsp/.test(alerts))add("DSP",v.dsp?`FTP: ${v.dsp}`:"Déduit du statut / alerte FTP");
  if(isYes(v.wheels)||/jante/.test(status)||/jante/.test(alerts))add("Jantes",v.wheels?`FTP: ${v.wheels}`:"Déduit du statut / alerte FTP");
  if(isYes(v.technicalControl)||/contrôle technique|controle technique|départ ct|depart ct/.test(status))add("Contrôle technique",v.technicalControl?`FTP: ${v.technicalControl}`:"Déduit du statut FTP");
  if(/prépar|prepar/.test(status))add("Préparation","Déduit du statut FTP");
  if(/qualit/.test(status))add("Qualité","Déduit du statut FTP");
  if(/photo/.test(status))add("Photos","Déduit du statut FTP");
  if(!tasks.length)add("Travail à qualifier","Le FTP ne détaille pas encore les opérations de ce dossier");
  return tasks;
}
function statusTone(status:string){const s=status.toLowerCase();if(/anomal|urgence/.test(s))return styles.red;if(/en cours/.test(s))return styles.blue;if(/attente|stocké|stocke/.test(s))return styles.amber;if(/sortie|photo|qualit/.test(s))return styles.green;return styles.neutral;}
function partTone(status:string){if(/DISPONIBLE/i.test(status))return styles.green;if(/COMMANDEE|PARTIELLE/i.test(status))return styles.amber;if(/A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT/i.test(status))return styles.red;return styles.neutral;}

export default function ProductionDevelopmentPage(){
  const [payload,setPayload]=useState<Payload|null>(null);
  const [tab,setTab]=useState<Tab>("control");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<Vehicle|null>(null);
  const [detailEvents,setDetailEvents]=useState<ApiEvent[]>([]);
  const [detailLoading,setDetailLoading]=useState(false);
  const [query,setQuery]=useState("");
  const [statusFilter,setStatusFilter]=useState("ALL");
  const [processFilter,setProcessFilter]=useState("ALL");
  const [onlyFactory,setOnlyFactory]=useState(true);
  const [store,setStore]=useState<SandboxStore>({overlays:{},rules:DEFAULT_RULES});
  const [storeReady,setStoreReady]=useState(false);
  const [actor,setActor]=useState("Utilisateur DEV");
  const [comment,setComment]=useState("");
  const [statusDraft,setStatusDraft]=useState("");
  const [partDraft,setPartDraft]=useState("");

  async function load(){
    setLoading(true);
    try{
      const r=await fetch(`/api/development/production?_=${Date.now()}`,{cache:"no-store"});
      const data=await r.json() as Payload;
      if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
      setPayload(data);setError("");
    }catch(e){setError(e instanceof Error?e.message:"Reflet FTP indisponible");}
    finally{setLoading(false);}
  }
  async function openVehicle(v:Vehicle){
    setSelected(v);setStatusDraft(activeStatus(v,store));setPartDraft(activePart(v,store));setDetailEvents([]);setDetailLoading(true);
    try{
      const r=await fetch(`/api/development/production?vehicle=${encodeURIComponent(vehicleKey(v))}&_=${Date.now()}`,{cache:"no-store"});
      const data=await r.json() as Payload;
      setDetailEvents(data.detail?.events||[]);
    }catch{}finally{setDetailLoading(false);}
  }

  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(STORE_KEY);
      if(raw){
        const parsed=JSON.parse(raw) as Partial<SandboxStore>;
        setStore({
          overlays:parsed.overlays||{},
          rules:{
            EFF:{...DEFAULT_RULES.EFF,...(parsed.rules?.EFF||{})},
            BMW:{...DEFAULT_RULES.BMW,...(parsed.rules?.BMW||{})},
          },
        });
      }
    }catch{}
    setStoreReady(true);
    fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(p=>{if(p?.user?.displayName)setActor(p.user.displayName);}).catch(()=>{});
  },[]);
  useEffect(()=>{if(storeReady)localStorage.setItem(STORE_KEY,JSON.stringify(store));},[store,storeReady]);

  const vehicles=payload?.vehicles||[];
  const statuses=useMemo<string[]>(()=>Array.from(new Set<string>(vehicles.map(v=>v.status))).sort((a,b)=>a.localeCompare(b,"fr")),[vehicles]);
  const filtered=useMemo(()=>vehicles.filter(v=>{
    if(onlyFactory&&!v.inFactory)return false;
    if(statusFilter!=="ALL"&&v.status!==statusFilter)return false;
    if(processFilter!=="ALL"&&v.processProfile!==processFilter)return false;
    const hay=`${v.registration||""} ${v.workOrder||""} ${v.client||""} ${v.vin||""} ${v.model||""} ${v.status}`.toLowerCase();
    return !query.trim()||hay.includes(query.trim().toLowerCase());
  }),[vehicles,onlyFactory,statusFilter,processFilter,query]);
  const stageCounts=useMemo(()=>{
    const base=vehicles.filter(v=>v.inFactory);
    return Object.fromEntries(STAGES.map(([key])=>[key,base.filter(v=>stageOf(activeStatus(v,store),activePart(v,store))===key).length])) as Record<string,number>;
  },[vehicles,store]);
  const blockers=useMemo(()=>vehicles.filter(v=>v.inFactory).map(v=>({
    v,
    score:(/oui|urgence/i.test(`${v.urgency||""} ${v.alert||""}`)?100:0)+(v.statusAgeDays>=2?30:0)+(/COMMANDEE|A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT/i.test(activePart(v,store))?40:0)+Math.min(v.factoryAgeDays,60),
  })).sort((a,b)=>b.score-a.score).slice(0,12),[vehicles,store]);
  const partGroups=useMemo(()=>{
    const map=new Map<string,Vehicle[]>();
    for(const v of vehicles.filter(v=>v.inFactory)){const key=activePart(v,store);map.set(key,[...(map.get(key)||[]),v]);}
    return [...map.entries()].sort((a,b)=>b[1].length-a[1].length);
  },[vehicles,store]);

  function updateOverlay(v:Vehicle,patch:(current:VehicleOverlay)=>VehicleOverlay){const key=vehicleKey(v);setStore(s=>({...s,overlays:{...s.overlays,[key]:patch(s.overlays[key]||{})}}));}
  function addLocalEvent(v:Vehicle,label:string,kind:LocalEvent["kind"]){updateOverlay(v,o=>({...o,events:[{id:crypto.randomUUID(),at:new Date().toISOString(),label,actor,kind},...(o.events||[])]}));}
  function simulateStatus(){if(!selected||!statusDraft)return;updateOverlay(selected,o=>({...o,simulatedStatus:statusDraft}));addLocalEvent(selected,`Statut simulé → ${statusDraft}`,"status");}
  function simulatePart(){if(!selected||!partDraft)return;updateOverlay(selected,o=>({...o,partStatus:partDraft}));addLocalEvent(selected,`MPR simulé → ${partDraft}`,"mpr");}
  function setTask(v:Vehicle,label:string,state:string){updateOverlay(v,o=>({...o,tasks:{...(o.tasks||{}),[label]:state}}));addLocalEvent(v,`${label} → ${state}`,"task");}
  function addComment(){if(!selected||!comment.trim())return;const text=comment.trim();const item={id:crypto.randomUUID(),at:new Date().toISOString(),text,actor};updateOverlay(selected,o=>({...o,comments:[item,...(o.comments||[])]}));addLocalEvent(selected,`Commentaire ajouté : ${text}`,"comment");setComment("");}
  function resetVehicle(v:Vehicle){const key=vehicleKey(v);setStore(s=>{const next={...s.overlays};delete next[key];return{...s,overlays:next};});setStatusDraft(v.status);setPartDraft(v.partAvailable||"NON RENSEIGNÉ FTP");}
  function updateRule(profile:"EFF"|"BMW",patch:Partial<Rule>){setStore(s=>({...s,rules:{...s.rules,[profile]:{...s.rules[profile],...patch}}}));}
  function resetSandbox(){if(!window.confirm("Effacer toutes les simulations locales du SAS ?"))return;setStore({overlays:{},rules:DEFAULT_RULES});if(selected){setStatusDraft(selected.status);setPartDraft(selected.partAvailable||"NON RENSEIGNÉ FTP");}}

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/crvo-logo.png" alt="CRVO"/><div><span>SAS EN DÉVELOPPEMENT · AUCUNE ÉCRITURE MPF</span><h1>Production Live</h1><p>Prototype industriel alimenté par le reflet FTP MecaPlanning Factory.</p></div></div>
      <div className={styles.headerActions}>
        <div className={styles.liveBadge}><i/><div><strong>REFLET FTP</strong><span>{fmtDate(payload?.sourceModifiedAt)}</span></div></div>
        <button onClick={()=>void load()} disabled={loading}>{loading?"Actualisation…":"Actualiser"}</button>
        <button onClick={resetSandbox}>Réinitialiser DEV</button>
        <a href="/">Retour KPI</a>
      </div>
    </header>

    <section className={styles.notice}><strong>DEV SANDBOX</strong><span>Les dossiers sont réels (reflet FTP). Les changements de statut, tâches, MPR, commentaires et seuils sont stockés uniquement dans ce navigateur : aucune donnée n’est renvoyée vers MecaPlanning Factory.</span></section>
    {error&&<div className={styles.error}>{error}</div>}

    <nav className={styles.tabs}>{([['control','Control room'],['dossiers','Dossiers en cours'],['mpr','MPR / pièces'],['rules','Process & seuils']] as Array<[Tab,string]>).map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={tab===key?styles.activeTab:""}>{label}</button>)}</nav>

    {tab==="control"&&<>
      <section className={styles.kpis}>
        <article><span>Stock usine miroir</span><strong>{payload?.stats.inFactory??"—"}</strong><small>dossiers présents dans le reflet usine</small></article>
        <article><span>À recevoir</span><strong>{payload?.stats.inbound??"—"}</strong><small>transport aller détecté</small></article>
        <article className={styles.kpiAmber}><span>Blocage MPR détecté</span><strong>{payload?.stats.partBlocked??"—"}</strong><small>commande / indisponibilité / engagement</small></article>
        <article className={styles.kpiRed}><span>Urgences</span><strong>{payload?.stats.urgent??"—"}</strong><small>alertes FTP comportant une urgence</small></article>
        <article><span>Sans mouvement ≥ 2 j</span><strong>{payload?.stats.stale??"—"}</strong><small>âge du statut courant</small></article>
      </section>
      <section className={styles.flowPanel}>
        <div className={styles.sectionTitle}><div><span>FLUX INDUSTRIEL</span><h2>Où se trouve le parc maintenant ?</h2></div><small>BCA / VOM occultés · source FTP {fmtDate(payload?.sourceModifiedAt)}</small></div>
        <div className={styles.stageFlow}>{STAGES.map(([key,label],index)=><div key={key} className={key==="anomalie"?styles.stageRisk:""}><span>{String(index+1).padStart(2,"0")}</span><strong>{stageCounts[key]||0}</strong><small>{label}</small></div>)}</div>
      </section>
      <section className={styles.twoCols}>
        <article className={styles.panel}><div className={styles.sectionTitle}><div><span>PRIORITÉS</span><h2>Dossiers à challenger</h2></div><small>score DEV = urgence + blocage + ancienneté</small></div><div className={styles.priorityList}>{blockers.map(({v})=><button key={vehicleKey(v)} onClick={()=>void openVehicle(v)}><div><strong>{v.registration||"Sans immat"}</strong><span>{v.model||"Modèle non renseigné"}</span></div><div><b className={statusTone(activeStatus(v,store))}>{activeStatus(v,store)}</b><small>J+{Math.round(v.factoryAgeDays)} · statut {v.statusAgeDays.toFixed(1)} j</small></div></button>)}</div></article>
        <article className={styles.panel}><div className={styles.sectionTitle}><div><span>MPR</span><h2>Disponibilité pièces</h2></div><small>niveau agrégé fourni par le FTP</small></div><div className={styles.partSummary}>{partGroups.slice(0,8).map(([name,list])=><button key={name} onClick={()=>{setTab("mpr");setQuery(name);}}><span className={partTone(name)}/><strong>{list.length}</strong><div><b>{name}</b><small>{Math.round(list.reduce((s,v)=>s+v.partOrderedDays,0)/Math.max(list.length,1))} j de commande moy.</small></div></button>)}</div></article>
      </section>
    </>}

    {tab==="dossiers"&&<section className={styles.panel}>
      <div className={styles.sectionTitle}><div><span>DOSSIERS</span><h2>Encours usine</h2></div><small>{filtered.length} affichés / {vehicles.length} dans le miroir</small></div>
      <div className={styles.filters}>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Immatriculation, OR, VIN, client, modèle…"/>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">Tous les statuts</option>{statuses.map(s=><option key={s}>{s}</option>)}</select>
        <select value={processFilter} onChange={e=>setProcessFilter(e.target.value)}><option value="ALL">Tous profils</option><option value="EFF">EFF</option><option value="BMW">BMW</option><option value="AUTRE">Autre / non cartographié</option></select>
        <label><input type="checkbox" checked={onlyFactory} onChange={e=>setOnlyFactory(e.target.checked)}/> En usine uniquement</label>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Dossier</th><th>Client / véhicule</th><th>Process</th><th>Statut source / simulé</th><th>MPR</th><th>Âge usine</th><th>Alertes</th></tr></thead><tbody>{filtered.slice(0,1000).map(v=><tr key={vehicleKey(v)} onClick={()=>void openVehicle(v)}>
        <td><strong>{v.registration||"—"}</strong><small>OR {v.workOrder||"—"}</small></td>
        <td><strong>{v.client||"—"}</strong><small>{v.model||"—"} · {fmtKm(v.mileage)}</small></td>
        <td><b className={v.processProfile==="AUTRE"?styles.outlinePill:styles.processPill}>{v.processProfile}</b><small>{v.sourceType}</small></td>
        <td><b className={statusTone(activeStatus(v,store))}>{activeStatus(v,store)}</b>{store.overlays[vehicleKey(v)]?.simulatedStatus&&<small className={styles.simulated}>SIMULATION · source: {v.status}</small>}<small>{v.statusAgeDays.toFixed(1)} j dans le statut source</small></td>
        <td><b className={partTone(activePart(v,store))}>{activePart(v,store)}</b><small>{v.partOrderedDays?`${Math.round(v.partOrderedDays)} j depuis commande`:"—"}</small></td>
        <td><strong>J+{Math.round(v.factoryAgeDays)}</strong></td><td><small>{v.alert||"—"}</small></td>
      </tr>)}</tbody></table></div>
    </section>}

    {tab==="mpr"&&<section className={styles.panel}>
      <div className={styles.sectionTitle}><div><span>MPR / PIÈCES</span><h2>Vision pièces disponible dans le FTP</h2></div><small>Le FTP ne fournit pas encore le détail référence par référence.</small></div>
      <div className={styles.partCards}>{partGroups.map(([name,list])=><article key={name}><div><span className={partTone(name)}/><b>{name}</b></div><strong>{list.length}</strong><small>{Math.round(list.reduce((s,v)=>s+v.partOrderedDays,0)/Math.max(list.length,1))} j de commande moyen</small></article>)}</div>
      <div className={styles.filters}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filtrer un dossier ou un état MPR…"/><button onClick={()=>setQuery("")}>Effacer</button></div>
      <div className={styles.cardGrid}>{vehicles.filter(v=>v.inFactory&&(!query.trim()||`${v.registration} ${v.workOrder} ${v.client} ${v.model} ${activePart(v,store)}`.toLowerCase().includes(query.toLowerCase()))).slice(0,500).map(v=><button key={vehicleKey(v)} onClick={()=>void openVehicle(v)} className={styles.vehicleCard}><div><strong>{v.registration||"Sans immat"}</strong><b className={partTone(activePart(v,store))}>{activePart(v,store)}</b></div><span>{v.model||"Modèle non renseigné"}</span><small>{v.client||"—"} · J+{Math.round(v.factoryAgeDays)} · OR {v.workOrder||"—"}</small></button>)}</div>
    </section>}

    {tab==="rules"&&<section className={styles.rulesPage}>
      <div className={styles.sectionTitle}><div><span>PROCESS PARAMÉTRABLE</span><h2>EFF & BMW</h2></div><small>Paramètres DEV locaux · aucun impact production</small></div>
      <div className={styles.ruleGrid}>{(["EFF","BMW"] as const).map(profile=>{const rule=store.rules[profile];return <article key={profile} className={styles.ruleCard}>
        <div className={styles.ruleHead}><div><span>PROFIL PROCESS</span><h3>VOP {profile}</h3></div>{profile==="BMW"&&<b>À CHALLENGER</b>}</div>
        <label><span>Seuil devis nécessitant validation (€)</span><input type="number" min="0" placeholder={profile==="BMW"?"À définir":"1500"} value={rule.threshold??""} onChange={e=>updateRule(profile,{threshold:e.target.value===""?null:num(e.target.value)})}/></label>
        <label><span>Règle contrôle technique</span><select value={rule.ctMode} onChange={e=>updateRule(profile,{ctMode:e.target.value as Rule["ctMode"]})}><option value="conditionnel">Conditionnel</option><option value="systematique">Systématique</option><option value="sans_ct">Sans CT</option><option value="a_definir">À définir</option></select></label>
        <div className={styles.toggles}><label><input type="checkbox" checked={rule.partsRequired} onChange={e=>updateRule(profile,{partsRequired:e.target.checked})}/> Pièces requises avant travaux</label><label><input type="checkbox" checked={rule.qualityRequired} onChange={e=>updateRule(profile,{qualityRequired:e.target.checked})}/> Contrôle qualité obligatoire</label><label><input type="checkbox" checked={rule.photosRequired} onChange={e=>updateRule(profile,{photosRequired:e.target.checked})}/> Photos obligatoires</label></div>
        <div className={styles.ruleFlow}><span>Expertise</span><i>›</i><span>Chiffrage</span><i>›</i><span>{rule.ctMode==="sans_ct"?"Sans CT":"CT"}</span><i>›</i><span>MPR</span><i>›</i><span>Travaux</span><i>›</i><span>Prépa</span><i>›</i><span>Qualité</span><i>›</i><span>Photos</span></div>
        <small>{profile==="EFF"?"Le seuil initial à 1 500 € vient du process Lens fourni. Les autres règles restent challengeables dans ce SAS.":"BMW remplace l’ancien flux ARVAL dans la cible. Aucun seuil ARVAL n’est repris automatiquement : le profil BMW est volontairement à paramétrer."}</small>
      </article>;})}</div>
      <button className={styles.resetRules} onClick={()=>setStore(s=>({...s,rules:DEFAULT_RULES}))}>Réinitialiser les paramètres DEV</button>
    </section>}

    {selected&&<><button className={styles.drawerBackdrop} onClick={()=>setSelected(null)} aria-label="Fermer le dossier"/><aside className={styles.drawer}>
      <header><div><span>DOSSIER NUMÉRIQUE · SOURCE FTP</span><h2>{selected.registration||"Sans immatriculation"}</h2><p>{selected.model||"Modèle non renseigné"}</p></div><button onClick={()=>setSelected(null)}>×</button></header>
      <div className={styles.drawerMeta}><b className={selected.processProfile==="AUTRE"?styles.outlinePill:styles.processPill}>{selected.processProfile}</b><span>OR {selected.workOrder||"—"}</span><span>{selected.client||"—"}</span><span>{fmtKm(selected.mileage)}</span></div>
      <div className={styles.sourceVsSim}><div><small>STATUT FTP</small><strong>{selected.status}</strong></div><i>→</i><div><small>ÉTAT AFFICHÉ</small><strong>{activeStatus(selected,store)}</strong>{store.overlays[vehicleKey(selected)]?.simulatedStatus&&<b>SIMULÉ</b>}</div></div>
      <div className={styles.drawerKpis}><div><span>Âge usine</span><strong>J+{Math.round(selected.factoryAgeDays)}</strong></div><div><span>Âge statut</span><strong>{selected.statusAgeDays.toFixed(1)} j</strong></div><div><span>MPR</span><strong>{activePart(selected,store)}</strong></div><div><span>Urgence</span><strong>{/oui|urgence/i.test(`${selected.urgency||""} ${selected.alert||""}`)?"OUI":"NON"}</strong></div></div>

      <section className={styles.drawerSection}><div className={styles.drawerTitle}><h3>Travail à faire</h3><small>Déduit des champs / alertes FTP. « Fait par qui » n’est pas disponible dans le flux actuel.</small></div><div className={styles.tasks}>{tasksFor(selected).map(task=>{const state=store.overlays[vehicleKey(selected)]?.tasks?.[task.label]||taskStateFromSource(selected,task.label);return <article key={task.label}><div><strong>{task.label}</strong><small>{task.source}</small></div><select value={state} onChange={e=>setTask(selected,task.label,e.target.value)}>{TASK_STATES.map(s=><option key={s}>{s}</option>)}</select><small>{store.overlays[vehicleKey(selected)]?.tasks?.[task.label]?`${actor} · simulation locale`:"Source FTP / déduction"}</small></article>;})}</div></section>

      <section className={styles.drawerSection}><div className={styles.drawerTitle}><h3>Actions de simulation</h3><small>Préfiguration des futurs appels API MecaPlanning Factory.</small></div><div className={styles.simGrid}>
        <label><span>Changer le statut</span><select value={statusDraft} onChange={e=>setStatusDraft(e.target.value)}>{STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}</select><button onClick={simulateStatus}>Appliquer en DEV</button></label>
        <label><span>État MPR</span><select value={partDraft} onChange={e=>setPartDraft(e.target.value)}>{MPR_OPTIONS.map(s=><option key={s}>{s}</option>)}</select><button onClick={simulatePart}>Appliquer en DEV</button></label>
      </div><div className={styles.commentBox}><textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Ajouter un commentaire de production…"/><button onClick={addComment}>Ajouter</button></div><button className={styles.resetVehicle} onClick={()=>resetVehicle(selected)}>Effacer les simulations de ce dossier</button></section>

      <section className={styles.drawerSection}><div className={styles.drawerTitle}><h3>Historique des changements</h3><small>Événements FTP + actions locales DEV</small></div>{detailLoading?<div className={styles.loadingLine}>Chargement de l’historique…</div>:<div className={styles.timeline}>{[
        ...(store.overlays[vehicleKey(selected)]?.events||[]).map(e=>({at:e.at,label:e.label,actor:e.actor,dev:true})),
        ...detailEvents.map(e=>({at:e.event_date?`${e.event_date}T${e.event_time||"00:00:00"}`:(e.source_modified_at||""),label:e.status||"Statut FTP",actor:"MecaPlanning / FTP",dev:false})),
      ].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,80).map((e,i)=><div key={`${e.at}-${i}`}><i className={e.dev?styles.timelineDev:""}/><div><strong>{e.label}</strong><small>{fmtDate(e.at)} · {e.actor}{e.dev?" · NON ENVOYÉ MPF":""}</small></div></div>)}</div>}</section>

      {(store.overlays[vehicleKey(selected)]?.comments||[]).length>0&&<section className={styles.drawerSection}><div className={styles.drawerTitle}><h3>Commentaires DEV</h3></div><div className={styles.comments}>{store.overlays[vehicleKey(selected)]!.comments!.map(c=><div key={c.id}><strong>{c.actor}</strong><span>{c.text}</span><small>{fmtDate(c.at)} · local navigateur</small></div>)}</div></section>}

      <section className={styles.drawerSection}><div className={styles.drawerTitle}><h3>Données disponibles aujourd’hui</h3></div><dl className={styles.rawFields}><div><dt>VIN</dt><dd>{selected.vin||"—"}</dd></div><div><dt>Alertes</dt><dd>{selected.alert||"—"}</dd></div><div><dt>Mécanique</dt><dd>{selected.mechanics||"Non renseigné FTP"}</dd></div><div><dt>Carrosserie</dt><dd>{selected.bodywork||"Non renseigné FTP"}</dd></div><div><dt>DSP</dt><dd>{selected.dsp||"Non renseigné FTP"}</dd></div><div><dt>Jantes</dt><dd>{selected.wheels||"Non renseigné FTP"}</dd></div><div><dt>CT</dt><dd>{selected.technicalControl||"Non renseigné FTP"}</dd></div><div><dt>Source</dt><dd>{selected.sourceType} · {fmtDate(selected.sourceModifiedAt)}</dd></div></dl></section>
    </aside></>}
  </main>;
}
