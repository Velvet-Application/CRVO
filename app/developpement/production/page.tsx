"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./production-dev.module.css";

type Vehicle = {
  snapshotAt:string|null; sourceModifiedAt:string|null; registration:string|null; workOrder:string|null; client:string|null; vin:string|null;
  model:string|null; mileage:number; status:string; statusAt:string|null; statusAgeDays:number; factoryAgeDays:number; alert:string|null; urgency:string|null;
  mechanics:string|null; bodywork:string|null; technicalControl:string|null; dsp:string|null; wheels:string|null; partAvailable:string|null; partOrderedDays:number;
  location:string|null; locationSourceModifiedAt:string|null; site:string|null; manufacturer:string|null; folderNumber:string|null;
  sourceType:string; processProfile:"EFF"|"BMW"|"AUTRE"|"EXCLU"; inFactory:boolean;
};
type ApiEvent = { source_modified_at:string|null; status:string|null; event_date:string|null; event_time:string|null };
type Fifo = {
  sectorKey:string; sectorLabel:string; registration:string|null; workOrder:string|null; status:string|null; alert:string|null; urgency:string|null;
  statusAgeDays:number; factoryAgeDays:number; fifoAgeDays:number;
};
type Payload = {
  connected:boolean; mode:string; sourceModifiedAt:string|null; locationSourceModifiedAt:string|null; snapshotAt:string|null; excludedBcaVom:number;
  stats:{totalMirror:number;inFactory:number;inbound:number;partBlocked:number;urgent:number;stale:number};
  vehicles:Vehicle[]; fifo:Fifo[]; detail?:{vehicle:Vehicle;events:ApiEvent[]}|null; error?:string;
};
type Rule = { threshold:number|null; ctMode:"conditionnel"|"systematique"|"sans_ct"|"a_definir"; partsRequired:boolean; qualityRequired:boolean; photosRequired:boolean };
type LocalEvent = { id:string; at:string; label:string; actor:string; kind:"status"|"task"|"mpr"|"comment" };
type VehicleOverlay = { simulatedStatus?:string; partStatus?:string; tasks?:Record<string,string>; comments?:Array<{id:string;at:string;text:string;actor:string}>; events?:LocalEvent[] };
type SandboxStore = { overlays:Record<string,VehicleOverlay>; rules:{EFF:Rule;BMW:Rule} };
type Tab = "control"|"pilotage"|"dossiers"|"recherche"|"mpr"|"rules";
type StageKey = "expertise"|"chiffrage"|"ct"|"mpr"|"travaux"|"preparation"|"qualite"|"sortie"|"anomalie";
type RunOperation = "mecanique"|"carrosserie"|"dsp"|"jantes"|"fixline"|"restor_fx";

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
const MPR_OPTIONS=["NON RENSEIGNÉ FTP","A COMMANDER","LE MAGASIN DOIT S'ENGAGER","PIECE COMMANDEE","BACK ORDER","RECEPTION PARTIELLE","PIECE DISPONIBLE","PAS D'ENGAGEMENT","NON CONCERNE"];
const TASK_STATES=["À faire","En cours","Terminé","Non concerné"];
const STAGES:Array<[StageKey,string]>=[
  ["expertise","Expertise"],["chiffrage","Chiffrage / validation"],["ct","Contrôle technique"],["mpr","MPR / pièces"],
  ["travaux","Travaux"],["preparation","Préparation"],["qualite","Qualité"],["sortie","Photos / sortie"],["anomalie","Anomalies"],
];
const RUN_OPERATIONS:Array<[RunOperation,string,string]>=[
  ["mecanique","Mécanique","mecanique"],
  ["carrosserie","Carrosserie","carrosserie"],
  ["dsp","DSP","dsp"],
  ["jantes","Jantes","jantes"],
  ["fixline","Fixline","carrosserie"],
  ["restor_fx","Restor FX","carrosserie"],
];
const RUN_TASK_LABELS:Record<string,RunOperation>={"Mécanique":"mecanique","Carrosserie":"carrosserie","DSP":"dsp","Jantes":"jantes","Fixline":"fixline","Restor FX":"restor_fx"};

function num(value:unknown){const n=Number(value);return Number.isFinite(n)?n:0;}
function fmtDate(value?:string|null){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function fmtKm(value:number){return `${new Intl.NumberFormat("fr-FR").format(Math.round(value))} km`;}
function vehicleKey(v:Vehicle){return String(v.vin||v.registration||v.workOrder||`${v.client}-${v.model}`);}
function activeStatus(v:Vehicle,store:SandboxStore){return store.overlays[vehicleKey(v)]?.simulatedStatus||v.status;}
function activePart(v:Vehicle,store:SandboxStore){return store.overlays[vehicleKey(v)]?.partStatus||v.partAvailable||"NON RENSEIGNÉ FTP";}
function isYes(value?:string|null){return Boolean(value&&/oui|yes|true|1/i.test(value));}
function isBlocked(part?:string|null){return /COMMANDEE|A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT|DOIT S'ENGAGER|BACK ORDER/i.test(part||"");}
function isUrgent(v:Vehicle){return /oui|urgence/i.test(`${v.urgency||""} ${v.alert||""}`);}
function normalizeIdentifier(value?:string|null){return String(value||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9]/g,"");}
function runOperationLabel(operation:RunOperation){return RUN_OPERATIONS.find(([key])=>key===operation)?.[1]||operation;}
function runFifoSector(operation:RunOperation){return RUN_OPERATIONS.find(([key])=>key===operation)?.[2]||operation;}
function stageOf(status:string,partStatus?:string|null):StageKey{
  const s=status.toLowerCase(),p=(partStatus||"").toLowerCase();
  if(/anomal/.test(s))return "anomalie";
  if(/photo|sortie usine/.test(s))return "sortie";
  if(/qualit/.test(s))return "qualite";
  if(/prépar|prepar/.test(s))return "preparation";
  if(/mécan|mecan|carross|fixline|dsp|jante|restor|travaux/.test(s))return /command|a commander|indisponible|pas d'engagement|doit s'engager|back order/.test(p)?"mpr":"travaux";
  if(/contrôle technique|controle technique|départ ct|depart ct/.test(s))return "ct";
  if(/chiffr|devis|validation/.test(s))return "chiffrage";
  if(/expert|lavage|réceptionné|receptionne/.test(s))return "expertise";
  if(/command|a commander|indisponible|pas d'engagement|doit s'engager|back order/.test(p))return "mpr";
  return "travaux";
}
function remainingOperations(v:Vehicle,store:SandboxStore):RunOperation[]{
  const status=activeStatus(v,store).toLowerCase();
  const alerts=(v.alert||"").toLowerCase();
  const context=`${status} ${alerts}`;
  const operations=new Set<RunOperation>();
  if(isYes(v.mechanics)||/mécan|mecan/.test(context))operations.add("mecanique");
  const bodyworkNeeded=isYes(v.bodywork)||/carross|fixline|restor/.test(context);
  if(bodyworkNeeded){
    if(/fixline/.test(status))operations.add("fixline");
    else if(/restor/.test(status))operations.add("restor_fx");
    else operations.add("carrosserie");
  }
  if(isYes(v.dsp)||/(^|\s)dsp(\s|$)/.test(context))operations.add("dsp");
  if(isYes(v.wheels)||/jante/.test(context))operations.add("jantes");
  const localTasks=store.overlays[vehicleKey(v)]?.tasks||{};
  for(const [label,state] of Object.entries(localTasks)){
    const operation=RUN_TASK_LABELS[label];
    if(!operation)continue;
    if(/Terminé|Non concerné/i.test(state))operations.delete(operation);
    else if(/À faire|En cours/i.test(state))operations.add(operation);
  }
  return [...operations];
}
function taskStateFromSource(v:Vehicle,label:string){
  const s=v.status.toLowerCase(),key=label.toLowerCase();
  const tokens:Record<string,string[]>={"mécanique":["mécan","mecan"],"carrosserie":["carross"],"fixline":["fixline"],"restor fx":["restor"],"dsp":["dsp"],"jantes":["jante"],"contrôle technique":["contrôle technique","controle technique","ct"],"préparation":["prépar","prepar"],"qualité":["qualit"],"photos":["photo"]};
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
  if(/restor/.test(status)||/restor/.test(alerts))add("Restor FX","Déduit du statut / alerte FTP");
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
function partTone(status:string){if(/DISPONIBLE/i.test(status))return styles.green;if(/COMMANDEE|PARTIELLE/i.test(status))return styles.amber;if(/A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT|DOIT S'ENGAGER|BACK ORDER/i.test(status))return styles.red;return styles.neutral;}

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
  const [partStatusFilter,setPartStatusFilter]=useState("ALL");
  const [onlyFactory,setOnlyFactory]=useState(true);
  const [store,setStore]=useState<SandboxStore>({overlays:{},rules:DEFAULT_RULES});
  const [storeReady,setStoreReady]=useState(false);
  const [actor,setActor]=useState("Utilisateur DEV");
  const [comment,setComment]=useState("");
  const [statusDraft,setStatusDraft]=useState("");
  const [partDraft,setPartDraft]=useState("");
  const [pilotageMode,setPilotageMode]=useState<"run"|"fifo">("run");
  const [runOperation,setRunOperation]=useState<RunOperation>("mecanique");
  const [fifoSector,setFifoSector]=useState("preparation");
  const [bulkInput,setBulkInput]=useState("");

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
  const fifo=payload?.fifo||[];
  const statuses=useMemo<string[]>(()=>Array.from(new Set<string>(vehicles.map(v=>v.status))).sort((a,b)=>a.localeCompare(b,"fr")),[vehicles]);
  const filtered=useMemo(()=>vehicles.filter(v=>{
    if(onlyFactory&&!v.inFactory)return false;
    if(statusFilter!=="ALL"&&v.status!==statusFilter)return false;
    if(processFilter!=="ALL"&&v.processProfile!==processFilter)return false;
    if(partStatusFilter!=="ALL"&&activePart(v,store)!==partStatusFilter)return false;
    const hay=`${v.registration||""} ${v.workOrder||""} ${v.client||""} ${v.vin||""} ${v.model||""} ${v.status} ${v.location||""}`.toLowerCase();
    return !query.trim()||hay.includes(query.trim().toLowerCase());
  }),[vehicles,onlyFactory,statusFilter,processFilter,partStatusFilter,query,store]);
  const stageCounts=useMemo(()=>{
    const base=vehicles.filter(v=>v.inFactory);
    return Object.fromEntries(STAGES.map(([key])=>[key,base.filter(v=>stageOf(activeStatus(v,store),activePart(v,store))===key).length])) as Record<string,number>;
  },[vehicles,store]);
  const blockers=useMemo(()=>vehicles.filter(v=>v.inFactory).map(v=>({
    v,
    score:(isUrgent(v)?100:0)+(v.statusAgeDays>=2?30:0)+(isBlocked(activePart(v,store))?40:0)+Math.min(v.factoryAgeDays,60),
  })).sort((a,b)=>b.score-a.score).slice(0,12),[vehicles,store]);
  const partGroups=useMemo(()=>{
    const map=new Map<string,Vehicle[]>();
    for(const v of vehicles.filter(v=>v.inFactory)){const key=activePart(v,store);map.set(key,[...(map.get(key)||[]),v]);}
    return [...map.entries()].sort((a,b)=>b[1].length-a[1].length);
  },[vehicles,store]);
  const partStatusOptions=useMemo(()=>partGroups.map(([name])=>name),[partGroups]);
  const mprFiltered=useMemo(()=>vehicles.filter(v=>{
    if(!v.inFactory)return false;
    if(partStatusFilter!=="ALL"&&activePart(v,store)!==partStatusFilter)return false;
    const hay=`${v.registration||""} ${v.workOrder||""} ${v.client||""} ${v.model||""} ${activePart(v,store)} ${v.location||""}`.toLowerCase();
    return !query.trim()||hay.includes(query.trim().toLowerCase());
  }),[vehicles,store,partStatusFilter,query]);
  const fifoByVehicle=useMemo(()=>{
    const map=new Map<string,Fifo[]>();
    for(const row of fifo){
      const keys=[normalizeIdentifier(row.registration),normalizeIdentifier(row.workOrder)].filter(Boolean);
      for(const key of keys)map.set(key,[...(map.get(key)||[]),row]);
    }
    return map;
  },[fifo]);
  const fifoSectors=useMemo(()=>Array.from(new Map(fifo.map(row=>[row.sectorKey,row.sectorLabel])).entries()).sort((a,b)=>a[1].localeCompare(b[1],"fr")),[fifo]);
  const runRows=useMemo(()=>{
    const rows:Array<{v:Vehicle;fifoAge:number;ready:boolean;score:number;operation:RunOperation}>=[];
    for(const v of vehicles.filter(item=>item.inFactory)){
      const remaining=remainingOperations(v,store);
      if(remaining.length!==1||remaining[0]!==runOperation)continue;
      const allFifoRows=[...(fifoByVehicle.get(normalizeIdentifier(v.registration))||[]),...(fifoByVehicle.get(normalizeIdentifier(v.workOrder))||[])];
      const relevantFifoRows=allFifoRows.filter(row=>row.sectorKey===runFifoSector(runOperation));
      const fifoAge=Math.max(0,...relevantFifoRows.map(row=>row.fifoAgeDays));
      const ready=!isBlocked(activePart(v,store));
      const score=(isUrgent(v)?100000:0)+(ready?10000:0)+fifoAge*100+v.factoryAgeDays;
      rows.push({v,fifoAge,ready,score,operation:runOperation});
    }
    return rows.sort((a,b)=>b.score-a.score);
  },[vehicles,store,runOperation,fifoByVehicle]);
  const runCounts=useMemo(()=>Object.fromEntries(RUN_OPERATIONS.map(([operation])=>[operation,vehicles.filter(v=>v.inFactory&&remainingOperations(v,store).length===1&&remainingOperations(v,store)[0]===operation).length])) as Record<RunOperation,number>,[vehicles,store]);
  const fifoRows=useMemo(()=>fifo.filter(row=>row.sectorKey===fifoSector).sort((a,b)=>b.fifoAgeDays-a.fifoAgeDays),[fifo,fifoSector]);
  const vehicleLookup=useMemo(()=>{
    const map=new Map<string,Vehicle[]>();
    for(const v of vehicles){
      const registration=normalizeIdentifier(v.registration),workOrder=normalizeIdentifier(v.workOrder),vin=normalizeIdentifier(v.vin);
      const keys=[registration,workOrder,workOrder?`OR${workOrder}`:"",vin].filter(Boolean);
      for(const key of keys)map.set(key,[...(map.get(key)||[]),v]);
    }
    return map;
  },[vehicles]);
  const bulkTokens=useMemo(()=>Array.from(new Set(bulkInput.split(/[\s,;|]+/).map(normalizeIdentifier).filter(Boolean))),[bulkInput]);
  const bulkSearch=useMemo(()=>{
    const matches:Vehicle[]=[];const seen=new Set<string>();const unmatched:string[]=[];
    for(const token of bulkTokens){
      const rows=vehicleLookup.get(token)||[];
      if(!rows.length){unmatched.push(token);continue;}
      for(const row of rows){const key=vehicleKey(row);if(!seen.has(key)){seen.add(key);matches.push(row);}}
    }
    return{matches,unmatched};
  },[bulkTokens,vehicleLookup]);

  function updateOverlay(v:Vehicle,patch:(current:VehicleOverlay)=>VehicleOverlay){const key=vehicleKey(v);setStore(s=>({...s,overlays:{...s.overlays,[key]:patch(s.overlays[key]||{})}}));}
  function addLocalEvent(v:Vehicle,label:string,kind:LocalEvent["kind"]){updateOverlay(v,o=>({...o,events:[{id:crypto.randomUUID(),at:new Date().toISOString(),label,actor,kind},...(o.events||[])]}));}
  function simulateStatus(){if(!selected||!statusDraft)return;updateOverlay(selected,o=>({...o,simulatedStatus:statusDraft}));addLocalEvent(selected,`Statut simulé → ${statusDraft}`,"status");}
  function simulatePart(){if(!selected||!partDraft)return;updateOverlay(selected,o=>({...o,partStatus:partDraft}));addLocalEvent(selected,`MPR simulé → ${partDraft}`,"mpr");}
  function setTask(v:Vehicle,label:string,state:string){updateOverlay(v,o=>({...o,tasks:{...(o.tasks||{}),[label]:state}}));addLocalEvent(v,`${label} → ${state}`,"task");}
  function addComment(){if(!selected||!comment.trim())return;const text=comment.trim();const item={id:crypto.randomUUID(),at:new Date().toISOString(),text,actor};updateOverlay(selected,o=>({...o,comments:[item,...(o.comments||[])]}));addLocalEvent(selected,`Commentaire ajouté : ${text}`,"comment");setComment("");}
  function resetVehicle(v:Vehicle){const key=vehicleKey(v);setStore(s=>{const next={...s.overlays};delete next[key];return{...s,overlays:next};});setStatusDraft(v.status);setPartDraft(v.partAvailable||"NON RENSEIGNÉ FTP");}
  function updateRule(profile:"EFF"|"BMW",patch:Partial<Rule>){setStore(s=>({...s,rules:{...s.rules,[profile]:{...s.rules[profile],...patch}}}));}
  function resetSandbox(){if(!window.confirm("Effacer toutes les simulations locales du SAS ?"))return;setStore({overlays:{},rules:DEFAULT_RULES});if(selected){setStatusDraft(selected.status);setPartDraft(selected.partAvailable||"NON RENSEIGNÉ FTP");}}

  const pilotButton=(active:boolean):React.CSSProperties=>({border:"1px solid #cbdde7",borderRadius:9,padding:"10px 15px",background:active?"#004f9f":"#fff",color:active?"#fff":"#456579",fontWeight:800,fontSize:9,cursor:"pointer"});
  const inputStyle:React.CSSProperties={border:"1px solid #cfdee7",borderRadius:9,padding:"10px 11px",background:"#fff",color:"#244b63",fontSize:9,fontWeight:700};

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

    <nav className={styles.tabs}>{([['control','Control room'],['pilotage','Pilotage RUN / FIFO'],['dossiers','Dossiers en cours'],['recherche','Recherche dossiers'],['mpr','MPR / pièces'],['rules','Process & seuils']] as Array<[Tab,string]>).map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={tab===key?styles.activeTab:""}>{label}</button>)}</nav>

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
      <section className={styles.panel} style={{marginTop:12}}>
        <div className={styles.sectionTitle}><div><span>PILOTAGE QUOTIDIEN</span><h2>RUN & FIFO font partie du flux</h2></div><small>RUN = une seule opération restante avant Préparation</small></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <button onClick={()=>{setPilotageMode("run");setTab("pilotage");}} style={{border:"1px solid #d5e5ed",borderTop:"4px solid #009edb",borderRadius:12,background:"#f8fcfe",padding:15,textAlign:"left",cursor:"pointer"}}><span style={{fontSize:8,fontWeight:800,color:"#009edb",letterSpacing:".08em"}}>RUN {runOperationLabel(runOperation).toUpperCase()}</span><strong style={{display:"block",marginTop:6,fontSize:26,color:"#004f9f",fontStyle:"italic"}}>{runRows.length}</strong><small style={{display:"block",marginTop:5,color:"#667f8f"}}>1 seule opération restante : {runOperationLabel(runOperation)} → Préparation</small></button>
          <button onClick={()=>{setPilotageMode("fifo");setTab("pilotage");}} style={{border:"1px solid #d5e5ed",borderTop:"4px solid #fec82f",borderRadius:12,background:"#fffdf6",padding:15,textAlign:"left",cursor:"pointer"}}><span style={{fontSize:8,fontWeight:800,color:"#8b6b00",letterSpacing:".08em"}}>FIFO INDUSTRIELLE</span><strong style={{display:"block",marginTop:6,fontSize:26,color:"#004f9f",fontStyle:"italic"}}>{fifoRows.length}</strong><small style={{display:"block",marginTop:5,color:"#667f8f"}}>{fifoSectors.find(([key])=>key===fifoSector)?.[1]||"Préparation"} · plus ancien {fifoRows[0]?`${fifoRows[0].fifoAgeDays.toFixed(1)} j`:"—"}</small></button>
        </div>
      </section>
      <section className={styles.twoCols}>
        <article className={styles.panel}><div className={styles.sectionTitle}><div><span>PRIORITÉS</span><h2>Dossiers à challenger</h2></div><small>score DEV = urgence + blocage + ancienneté</small></div><div className={styles.priorityList}>{blockers.map(({v})=><button key={vehicleKey(v)} onClick={()=>void openVehicle(v)}><div><strong>{v.registration||"Sans immat"}</strong><span>{v.model||"Modèle non renseigné"}</span></div><div><b className={statusTone(activeStatus(v,store))}>{activeStatus(v,store)}</b><small>{v.location?`${v.location} · `:""}J+{Math.round(v.factoryAgeDays)} · statut {v.statusAgeDays.toFixed(1)} j</small></div></button>)}</div></article>
        <article className={styles.panel}><div className={styles.sectionTitle}><div><span>MPR</span><h2>Disponibilité pièces</h2></div><small>cliquer sur un état pour filtrer les dossiers</small></div><div className={styles.partSummary}>{partGroups.slice(0,8).map(([name,list])=><button key={name} onClick={()=>{setPartStatusFilter(name);setQuery("");setTab("mpr");}}><span className={partTone(name)}/><strong>{list.length}</strong><div><b>{name}</b><small>{Math.round(list.reduce((s,v)=>s+v.partOrderedDays,0)/Math.max(list.length,1))} j de commande moy.</small></div></button>)}</div></article>
      </section>
    </>}

    {tab==="pilotage"&&<section className={styles.panel}>
      <div className={styles.sectionTitle}><div><span>PILOTAGE INDUSTRIEL</span><h2>RUN de production & FIFO</h2></div><small>RUN = dossier avec une seule opération restante avant Préparation</small></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",padding:10,borderRadius:11,background:"#f1f7fa",marginBottom:12}}>
        <div style={{display:"flex",gap:6}}><button onClick={()=>setPilotageMode("run")} style={pilotButton(pilotageMode==="run")}>RUN DE PRODUCTION</button><button onClick={()=>setPilotageMode("fifo")} style={pilotButton(pilotageMode==="fifo")}>FIFO</button></div>
        <small style={{fontSize:8,color:"#6f8796"}}>Parc {fmtDate(payload?.sourceModifiedAt)} · positions {fmtDate(payload?.locationSourceModifiedAt)}</small>
      </div>
      {pilotageMode==="run"?<>
        <div style={{padding:10,border:"1px solid #bfe0ee",borderLeft:"4px solid #009edb",borderRadius:10,background:"#f2fbff",marginBottom:10,fontSize:9,color:"#365d74"}}><strong style={{color:"#004f9f"}}>Règle RUN :</strong> le dossier ne remonte que s’il ne reste qu’une seule opération de production avant la préparation. Exemple : RUN Méca = Mécanique puis Préparation ; RUN DSP = DSP puis Préparation.</div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(240px,330px) repeat(3,minmax(130px,1fr))",gap:8,marginBottom:12}}>
          <label style={{display:"grid",gap:5,padding:10,border:"1px solid #d8e5ec",borderRadius:10,background:"#fff"}}><span style={{fontSize:7,fontWeight:800,color:"#607a8a"}}>RUN / DERNIÈRE OPÉRATION</span><select value={runOperation} onChange={e=>setRunOperation(e.target.value as RunOperation)} style={inputStyle}>{RUN_OPERATIONS.map(([key,label])=><option key={key} value={key}>RUN {label}</option>)}</select></label>
          <article style={{padding:11,borderRadius:10,background:"#eaf7fc"}}><span style={{fontSize:7,fontWeight:800,color:"#4f6f82"}}>DOSSIERS RUN</span><strong style={{display:"block",fontSize:24,color:"#004f9f"}}>{runRows.length}</strong><small style={{fontSize:7,color:"#6f8796"}}>{runOperationLabel(runOperation)} → Préparation</small></article>
          <article style={{padding:11,borderRadius:10,background:"#ecfaf6"}}><span style={{fontSize:7,fontWeight:800,color:"#4f6f82"}}>MPR PRÊT</span><strong style={{display:"block",fontSize:24,color:"#004f9f"}}>{runRows.filter(row=>row.ready).length}</strong><small style={{fontSize:7,color:"#6f8796"}}>lançables côté pièces</small></article>
          <article style={{padding:11,borderRadius:10,background:"#fff4e8"}}><span style={{fontSize:7,fontWeight:800,color:"#4f6f82"}}>URGENTS</span><strong style={{display:"block",fontSize:24,color:"#004f9f"}}>{runRows.filter(row=>isUrgent(row.v)).length}</strong><small style={{fontSize:7,color:"#6f8796"}}>dans ce RUN</small></article>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>{RUN_OPERATIONS.map(([operation,label])=><button key={operation} onClick={()=>setRunOperation(operation)} style={{...pilotButton(runOperation===operation),padding:"7px 10px",fontSize:8}}>RUN {label} · {runCounts[operation]||0}</button>)}</div>
        <div className={styles.tableWrap}><table><thead><tr><th>RUN</th><th>Dernière opération</th><th>Dossier</th><th>Localisation</th><th>Statut</th><th>MPR</th><th>FIFO métier</th><th>Âge usine</th><th>Étape suivante</th></tr></thead><tbody>{runRows.slice(0,500).map((row,index)=><tr key={vehicleKey(row.v)} onClick={()=>void openVehicle(row.v)}>
          <td><strong>#{index+1}</strong><small>priorité RUN</small></td>
          <td><strong>{runOperationLabel(row.operation)}</strong><small>seule opération restante</small></td>
          <td><strong>{row.v.registration||"—"}</strong><small>OR {row.v.workOrder||"—"} · {row.v.model||"—"}</small></td>
          <td><strong>{row.v.location||"—"}</strong><small>{row.v.location?fmtDate(row.v.locationSourceModifiedAt):"position indisponible"}</small></td>
          <td><b className={statusTone(activeStatus(row.v,store))}>{activeStatus(row.v,store)}</b></td>
          <td><b className={partTone(activePart(row.v,store))}>{activePart(row.v,store)}</b><small>{row.ready?"MPR compatible lancement":"Blocage MPR"}</small></td>
          <td><strong>{row.fifoAge?`${row.fifoAge.toFixed(1)} j`:"—"}</strong><small>{runFifoSector(row.operation)}</small></td>
          <td><strong>J+{Math.round(row.v.factoryAgeDays)}</strong></td>
          <td><strong style={{color:"#008f87"}}>Préparation</strong><small>{isUrgent(row.v)?"Urgence · ":""}{row.ready?"prêt à lancer":"attente MPR"}</small></td>
        </tr>)}</tbody></table></div>
      </>:<>
        <div style={{display:"grid",gridTemplateColumns:"minmax(230px,320px) repeat(2,minmax(150px,1fr))",gap:8,marginBottom:12}}>
          <label style={{display:"grid",gap:5,padding:10,border:"1px solid #d8e5ec",borderRadius:10,background:"#fff"}}><span style={{fontSize:7,fontWeight:800,color:"#607a8a"}}>SECTEUR FIFO</span><select value={fifoSector} onChange={e=>setFifoSector(e.target.value)} style={inputStyle}>{fifoSectors.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <article style={{padding:11,borderRadius:10,background:"#eaf7fc"}}><span style={{fontSize:7,fontWeight:800,color:"#4f6f82"}}>DOSSIERS FIFO</span><strong style={{display:"block",fontSize:24,color:"#004f9f"}}>{fifoRows.length}</strong></article>
          <article style={{padding:11,borderRadius:10,background:"#fff4e8"}}><span style={{fontSize:7,fontWeight:800,color:"#4f6f82"}}>PLUS ANCIEN</span><strong style={{display:"block",fontSize:24,color:"#004f9f"}}>{fifoRows[0]?`${fifoRows[0].fifoAgeDays.toFixed(1)} j`:"—"}</strong></article>
        </div>
        <div className={styles.tableWrap}><table><thead><tr><th>FIFO</th><th>Dossier</th><th>Localisation</th><th>Statut</th><th>Âge FIFO</th><th>Âge statut</th><th>Âge usine</th><th>Alertes</th></tr></thead><tbody>{fifoRows.slice(0,1000).map((row,index)=>{const v=vehicles.find(item=>(row.registration&&normalizeIdentifier(item.registration)===normalizeIdentifier(row.registration))||(row.workOrder&&normalizeIdentifier(item.workOrder)===normalizeIdentifier(row.workOrder)));return <tr key={`${row.sectorKey}-${row.registration}-${row.workOrder}-${index}`} onClick={()=>v&&void openVehicle(v)}>
          <td><strong>#{index+1}</strong></td><td><strong>{row.registration||v?.registration||"—"}</strong><small>OR {row.workOrder||v?.workOrder||"—"}</small></td><td><strong>{v?.location||"—"}</strong><small>{v?.location?fmtDate(v.locationSourceModifiedAt):"position indisponible"}</small></td><td><b className={statusTone(row.status||v?.status||"")}>{row.status||v?.status||"—"}</b></td><td><strong>{row.fifoAgeDays.toFixed(1)} j</strong></td><td><strong>{row.statusAgeDays.toFixed(1)} j</strong></td><td><strong>J+{Math.round(row.factoryAgeDays)}</strong></td><td><small>{row.alert||"—"}</small></td>
        </tr>;})}</tbody></table></div>
      </>}
    </section>}

    {tab==="dossiers"&&<section className={styles.panel}>
      <div className={styles.sectionTitle}><div><span>DOSSIERS</span><h2>Encours usine</h2></div><small>{filtered.length} affichés / {vehicles.length} dans le miroir</small></div>
      <div className={styles.filters}>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Immatriculation, OR, VIN, client, modèle, position…"/>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">Tous les statuts</option>{statuses.map(s=><option key={s}>{s}</option>)}</select>
        <select value={partStatusFilter} onChange={e=>setPartStatusFilter(e.target.value)}><option value="ALL">Tous les statuts MPR</option>{partStatusOptions.map(s=><option key={s} value={s}>{s}</option>)}</select>
        <select value={processFilter} onChange={e=>setProcessFilter(e.target.value)}><option value="ALL">Tous profils</option><option value="EFF">EFF</option><option value="BMW">BMW</option><option value="AUTRE">Autre / non cartographié</option></select>
        <label><input type="checkbox" checked={onlyFactory} onChange={e=>setOnlyFactory(e.target.checked)}/> En usine uniquement</label>
      </div>
      <div className={styles.tableWrap}><table><thead><tr><th>Dossier</th><th>Client / véhicule</th><th>Process</th><th>Statut source / simulé</th><th>MPR</th><th>Localisation</th><th>Âge usine</th><th>Alertes</th></tr></thead><tbody>{filtered.slice(0,1000).map(v=><tr key={vehicleKey(v)} onClick={()=>void openVehicle(v)}>
        <td><strong>{v.registration||"—"}</strong><small>OR {v.workOrder||"—"}</small></td>
        <td><strong>{v.client||"—"}</strong><small>{v.model||"—"} · {fmtKm(v.mileage)}</small></td>
        <td><b className={v.processProfile==="AUTRE"?styles.outlinePill:styles.processPill}>{v.processProfile}</b><small>{v.sourceType}</small></td>
        <td><b className={statusTone(activeStatus(v,store))}>{activeStatus(v,store)}</b>{store.overlays[vehicleKey(v)]?.simulatedStatus&&<small className={styles.simulated}>SIMULATION · source: {v.status}</small>}<small>{v.statusAgeDays.toFixed(1)} j dans le statut source</small></td>
        <td><b className={partTone(activePart(v,store))}>{activePart(v,store)}</b><small>{v.partOrderedDays?`${Math.round(v.partOrderedDays)} j depuis commande`:"—"}</small></td>
        <td><strong>{v.location||"—"}</strong><small>{v.location?`position · ${fmtDate(v.locationSourceModifiedAt)}`:"position non fournie"}</small></td>
        <td><strong>J+{Math.round(v.factoryAgeDays)}</strong></td><td><small>{v.alert||"—"}</small></td>
      </tr>)}</tbody></table></div>
    </section>}

    {tab==="recherche"&&<section className={styles.panel}>
      <div className={styles.sectionTitle}><div><span>RECHERCHE MULTI-DOSSIERS</span><h2>Coller une liste d’OR, immatriculations ou VIN</h2></div><small>recherche exacte, mélange des 3 formats autorisé</small></div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(320px,1fr) minmax(280px,.65fr)",gap:12,alignItems:"stretch",marginBottom:12}}>
        <div style={{display:"grid",gap:8}}><textarea value={bulkInput} onChange={e=>setBulkInput(e.target.value)} placeholder={"Collez ici votre liste depuis Excel, Teams, un mail…\n\nExemple :\n2083148\nGG313FP\nVF1XXXXXXXXXXXXXX"} style={{minHeight:180,border:"1px solid #cbdde7",borderRadius:12,padding:14,resize:"vertical",fontFamily:"Exo,Arial,sans-serif",fontSize:10,color:"#244b63",outline:"none"}}/><div style={{display:"flex",gap:8}}><button onClick={()=>setBulkInput("")} style={pilotButton(false)}>EFFACER</button><button onClick={()=>{setBulkInput(Array.from(new Set(bulkSearch.unmatched)).join("\n"));}} disabled={!bulkSearch.unmatched.length} style={{...pilotButton(false),opacity:bulkSearch.unmatched.length?1:.45}}>GARDER LES NON TROUVÉS</button></div></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <article style={{padding:14,borderRadius:11,background:"#eaf7fc"}}><span style={{fontSize:7,fontWeight:800,color:"#5d7889"}}>IDENTIFIANTS COLLÉS</span><strong style={{display:"block",marginTop:5,fontSize:30,color:"#004f9f"}}>{bulkTokens.length}</strong></article>
          <article style={{padding:14,borderRadius:11,background:"#ecfaf6"}}><span style={{fontSize:7,fontWeight:800,color:"#5d7889"}}>DOSSIERS TROUVÉS</span><strong style={{display:"block",marginTop:5,fontSize:30,color:"#004f9f"}}>{bulkSearch.matches.length}</strong></article>
          <article style={{gridColumn:"1 / -1",padding:14,borderRadius:11,background:bulkSearch.unmatched.length?"#fff1ef":"#f4f8fa"}}><span style={{fontSize:7,fontWeight:800,color:"#5d7889"}}>NON TROUVÉS</span><strong style={{display:"block",marginTop:5,fontSize:24,color:bulkSearch.unmatched.length?"#c6423d":"#004f9f"}}>{bulkSearch.unmatched.length}</strong><small style={{display:"block",marginTop:5,color:"#687f8f",lineHeight:1.5,wordBreak:"break-word"}}>{bulkSearch.unmatched.length?bulkSearch.unmatched.slice(0,30).join(" · "):"Tous les identifiants saisis ont une correspondance dans le miroir FTP."}</small></article>
        </div>
      </div>
      {!bulkTokens.length?<div style={{padding:24,border:"1px dashed #c8dbe6",borderRadius:12,textAlign:"center",color:"#718795",fontSize:10}}>Collez une liste : chaque ligne, cellule Excel, espace, virgule ou point-virgule est reconnu comme séparateur.</div>:<div className={styles.tableWrap}><table><thead><tr><th>Dossier</th><th>VIN</th><th>Client / véhicule</th><th>Statut</th><th>MPR</th><th>Localisation</th><th>Âge usine</th><th>Alertes</th></tr></thead><tbody>{bulkSearch.matches.map(v=><tr key={vehicleKey(v)} onClick={()=>void openVehicle(v)}><td><strong>{v.registration||"—"}</strong><small>OR {v.workOrder||"—"}</small></td><td><strong>{v.vin||"—"}</strong></td><td><strong>{v.client||"—"}</strong><small>{v.model||"—"} · {fmtKm(v.mileage)}</small></td><td><b className={statusTone(activeStatus(v,store))}>{activeStatus(v,store)}</b><small>{v.statusAgeDays.toFixed(1)} j</small></td><td><b className={partTone(activePart(v,store))}>{activePart(v,store)}</b></td><td><strong>{v.location||"—"}</strong><small>{v.location?fmtDate(v.locationSourceModifiedAt):"—"}</small></td><td><strong>J+{Math.round(v.factoryAgeDays)}</strong></td><td><small>{v.alert||"—"}</small></td></tr>)}</tbody></table></div>}
    </section>}

    {tab==="mpr"&&<section className={styles.panel}>
      <div className={styles.sectionTitle}><div><span>MPR / PIÈCES</span><h2>Vision pièces disponible dans le FTP</h2></div><small>{mprFiltered.length} dossiers affichés · filtre par statut pièce</small></div>
      <div className={styles.partCards}>{partGroups.map(([name,list])=><button key={name} onClick={()=>setPartStatusFilter(partStatusFilter===name?"ALL":name)} style={{padding:12,border:partStatusFilter===name?"2px solid #004f9f":"1px solid #dbe7ee",borderRadius:10,background:partStatusFilter===name?"#eef7fc":"#f9fcfd",textAlign:"left",cursor:"pointer"}}><div style={{display:"flex",alignItems:"center",gap:7}}><span className={partTone(name)} style={{width:8,height:26,borderRadius:99}}/><b style={{fontSize:8,color:"#4b687a"}}>{name}</b></div><strong style={{display:"block",marginTop:8,color:"#004f9f",fontSize:26,fontStyle:"italic"}}>{list.length}</strong><small style={{fontSize:7,color:"#81939e"}}>{Math.round(list.reduce((s,v)=>s+v.partOrderedDays,0)/Math.max(list.length,1))} j de commande moyen</small></button>)}</div>
      <div className={styles.filters}>
        <select value={partStatusFilter} onChange={e=>setPartStatusFilter(e.target.value)}><option value="ALL">Tous les statuts pièce</option>{partStatusOptions.map(s=><option key={s} value={s}>{s}</option>)}</select>
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Immatriculation, OR, client, modèle, position…"/>
        <button onClick={()=>{setQuery("");setPartStatusFilter("ALL");}}>Effacer les filtres</button>
      </div>
      <div className={styles.cardGrid}>{mprFiltered.slice(0,700).map(v=><button key={vehicleKey(v)} onClick={()=>void openVehicle(v)} className={styles.vehicleCard}><div><strong>{v.registration||"Sans immat"}</strong><b className={partTone(activePart(v,store))}>{activePart(v,store)}</b></div><span>{v.model||"Modèle non renseigné"}</span><small>{v.client||"—"} · {v.location?`${v.location} · `:""}J+{Math.round(v.factoryAgeDays)} · OR {v.workOrder||"—"}</small></button>)}</div>
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
      <div className={styles.drawerMeta}><b className={selected.processProfile==="AUTRE"?styles.outlinePill:styles.processPill}>{selected.processProfile}</b><span>OR {selected.workOrder||"—"}</span><span>{selected.client||"—"}</span><span>{fmtKm(selected.mileage)}</span><span>Position {selected.location||"—"}</span></div>
      <div className={styles.sourceVsSim}><div><small>STATUT FTP</small><strong>{selected.status}</strong></div><i>→</i><div><small>ÉTAT AFFICHÉ</small><strong>{activeStatus(selected,store)}</strong>{store.overlays[vehicleKey(selected)]?.simulatedStatus&&<b>SIMULÉ</b>}</div></div>
      <div className={styles.drawerKpis}><div><span>Âge usine</span><strong>J+{Math.round(selected.factoryAgeDays)}</strong></div><div><span>Âge statut</span><strong>{selected.statusAgeDays.toFixed(1)} j</strong></div><div><span>MPR</span><strong>{activePart(selected,store)}</strong></div><div><span>Localisation</span><strong>{selected.location||"—"}</strong></div></div>

      {remainingOperations(selected,store).length===1&&<section className={styles.drawerSection} style={{borderLeft:"4px solid #009edb"}}><div className={styles.drawerTitle}><h3>RUN détecté</h3><small>une seule opération restante avant préparation</small></div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:10,borderRadius:9,background:"#f0f9fd"}}><strong style={{color:"#004f9f",fontSize:14}}>RUN {runOperationLabel(remainingOperations(selected,store)[0])}</strong><span style={{fontSize:9,color:"#5d7889"}}>{runOperationLabel(remainingOperations(selected,store)[0])} → Préparation</span></div></section>}

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

      <section className={styles.drawerSection}><div className={styles.drawerTitle}><h3>Données disponibles aujourd’hui</h3></div><dl className={styles.rawFields}><div><dt>VIN</dt><dd>{selected.vin||"—"}</dd></div><div><dt>Position</dt><dd>{selected.location||"—"} · {fmtDate(selected.locationSourceModifiedAt)}</dd></div><div><dt>Alertes</dt><dd>{selected.alert||"—"}</dd></div><div><dt>Mécanique</dt><dd>{selected.mechanics||"Non renseigné FTP"}</dd></div><div><dt>Carrosserie</dt><dd>{selected.bodywork||"Non renseigné FTP"}</dd></div><div><dt>DSP</dt><dd>{selected.dsp||"Non renseigné FTP"}</dd></div><div><dt>Jantes</dt><dd>{selected.wheels||"Non renseigné FTP"}</dd></div><div><dt>CT</dt><dd>{selected.technicalControl||"Non renseigné FTP"}</dd></div><div><dt>Source</dt><dd>{selected.sourceType} · {fmtDate(selected.sourceModifiedAt)}</dd></div></dl></section>
    </aside></>}
  </main>;
}
