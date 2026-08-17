"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import styles from "./home-dashboard.module.css";

type View="today"|"yesterday"|"bottlenecks"|"walking"|"finance"|"objectives"|"sources";
type Production={name:string;value:number;tone:string};
type Snapshot={date:string;label:string;source:string;sourceMode?:string;entries:number;exits:number;stock:number;over15:number;over20:number;production:Production[]};
type DashboardPayload={connected:boolean;backend?:string;latestSource?:string;snapshot?:Snapshot;snapshots?:Snapshot[];liveFreshness?:{sourceModifiedAt?:string|null;factoryModifiedAt?:string|null;parkModifiedAt?:string|null}|null;error?:string};
type Objective={month?:string;sectorKey:string;sectorLabel:string;dailyTarget:number;minThreshold:number|null;maxThreshold:number|null;updatedAt?:string|null};
type ObjectivesPayload={connected:boolean;configured?:boolean;month:string;objectives:Objective[];sortieDailyTargets:Record<string,number>;error?:string};
type BottleneckPoint={date:string;value:number;source:string};
type BottleneckSector={key:string;label:string;color:string;points:BottleneckPoint[];actual:number;max:number|null;cadence:number|null;workDays:number|null;evolution:number;aboveMax:number|null;configured:boolean};
type BottleneckPayload={connected:boolean;latestDate?:string;source?:string;sourceModifiedAt?:string|null;critical?:number;sectors?:BottleneckSector[];error?:string};
type WalkingVehicle={registration:string|null;workOrder:string|null;client:string|null;status:string|null;cause:string|null;ageDays:number;statusAgeDays:number;alert:string|null;partAvailable:string|null;pending:string[]|null};
type IntelligencePayload={connected?:boolean;walking?:{top?:WalkingVehicle[]};sourceModifiedAt?:string|null;error?:string};
type FinancialSnapshot={date:string;source:string;filename:string;metrics:Record<string,number|string|null>};
type FinancePayload={connected?:boolean;backend?:string;asOfDate?:string;snapshot?:FinancialSnapshot|null;snapshots?:FinancialSnapshot[]|null;targetConfigured?:boolean;error?:string};
type SystemStatus={supabase?:boolean;supabaseStatus?:string;ftpBridge?:boolean;ftpRefresh?:{lastRefreshAt?:string|null;lastDepositAt?:string|null;lastDepositFilename?:string|null}|null;error?:string};
type Me={role:"admin"|"user";pagePermissions:string[]};

type LoadState={dashboard:DashboardPayload|null;objectives:ObjectivesPayload|null;bottlenecks:BottleneckPayload|null;intelligence:IntelligencePayload|null;finance:FinancePayload|null;system:SystemStatus|null;me:Me|null};
const EMPTY:LoadState={dashboard:null,objectives:null,bottlenecks:null,intelligence:null,finance:null,system:null,me:null};
const sectorKeys:Record<string,string>={Expertise:"expertise",Mécanique:"mecanique",DSP:"dsp",Carrosserie:"carrosserie",Préparation:"preparation",Qualité:"qualite","Sortie usine":"sortie_usine"};

function isoMonth(date=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).format(date);}
function fmt(value:number|null|undefined,digits=0){return value==null||!Number.isFinite(Number(value))?"—":Number(value).toLocaleString("fr-FR",{maximumFractionDigits:digits});}
function euro(value:unknown){const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n):"—";}
function pct(value:number|null|undefined){return value==null?"—":`${value>0?"+":""}${fmt(value,1)} %`;}
function dateLabel(value?:string|null){if(!value)return"—";const d=new Date(`${value.slice(0,10)}T12:00:00Z`);return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(d);}
function dateTime(value?:string|null){if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function metric(snapshot:FinancialSnapshot|null|undefined,key:string){const n=Number(snapshot?.metrics?.[key]);return Number.isFinite(n)?n:null;}
function targetFor(name:string,objectives:Objective[]){const key=sectorKeys[name];return objectives.find(item=>item.sectorKey===key)?.dailyTarget??null;}
function allowed(me:Me|null,key:string){return Boolean(me&&(me.role==="admin"||me.pagePermissions?.includes("*")||me.pagePermissions?.includes(key)));}

async function readJson<T>(url:string):Promise<T>{const response=await fetch(url,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error((payload as {error?:string}).error||`${url} · ${response.status}`);return payload as T;}

export default function HomeDashboard(){
  const [view,setView]=useState<View>("today");
  const [data,setData]=useState<LoadState>(EMPTY);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [selectedSector,setSelectedSector]=useState("");
  const [objectiveDraft,setObjectiveDraft]=useState<Objective[]>([]);
  const [savingObjectives,setSavingObjectives]=useState(false);
  const month=isoMonth();

  async function refresh(){
    setLoading(true);setError("");
    const results=await Promise.allSettled([
      readJson<DashboardPayload>("/api/dashboard?history=1"),
      readJson<ObjectivesPayload>(`/api/objectives?month=${month}`),
      readJson<BottleneckPayload>("/api/bottlenecks"),
      readJson<IntelligencePayload>("/api/intelligence?mode=live"),
      readJson<FinancePayload>("/api/direction-finance?history=1"),
      readJson<SystemStatus>("/api/system-status"),
      readJson<{user:Me}>("/api/auth/me"),
    ]);
    const next:LoadState={
      dashboard:results[0].status==="fulfilled"?results[0].value:null,
      objectives:results[1].status==="fulfilled"?results[1].value:null,
      bottlenecks:results[2].status==="fulfilled"?results[2].value:null,
      intelligence:results[3].status==="fulfilled"?results[3].value:null,
      finance:results[4].status==="fulfilled"?results[4].value:null,
      system:results[5].status==="fulfilled"?results[5].value:null,
      me:results[6].status==="fulfilled"?results[6].value.user:null,
    };
    setData(next);
    setObjectiveDraft(next.objectives?.objectives??[]);
    const firstError=results.find(result=>result.status==="rejected") as PromiseRejectedResult|undefined;
    if(firstError)setError(firstError.reason instanceof Error?firstError.reason.message:"Une source réelle est indisponible.");
    setLoading(false);
  }

  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),60000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{const requested=new URLSearchParams(window.location.search).get("nav") as View|null;if(requested&&["today","yesterday","bottlenecks","walking","finance","objectives","sources"].includes(requested))setView(requested);},[]);
  useEffect(()=>{const first=data.bottlenecks?.sectors?.[0]?.key;if(!selectedSector&&first)setSelectedSector(first);},[data.bottlenecks,selectedSector]);

  const snapshots=useMemo(()=>[...(data.dashboard?.snapshots??(data.dashboard?.snapshot?[data.dashboard.snapshot]:[]))].sort((a,b)=>a.date.localeCompare(b.date)),[data.dashboard]);
  const latest=snapshots.at(-1)??null;
  const previous=snapshots.length>1?snapshots.at(-2)??null:null;
  const objectives=data.objectives?.objectives??[];
  const currentBottleneck=data.bottlenecks?.sectors?.find(item=>item.key===selectedSector)??data.bottlenecks?.sectors?.[0]??null;
  const walking=[...(data.intelligence?.walking?.top??[])].sort((a,b)=>Number(b.ageDays)-Number(a.ageDays));
  const finance=data.finance?.snapshot??null;
  const canSettings=allowed(data.me,"settings");

  async function saveObjectives(){
    setSavingObjectives(true);setError("");
    try{
      const response=await fetch("/api/objectives",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({month,objectives:objectiveDraft,sortieDailyTargets:data.objectives?.sortieDailyTargets??{}})});
      const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||"Enregistrement refusé.");await refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:"Enregistrement impossible.");}finally{setSavingObjectives(false);}
  }
  function updateObjective(index:number,key:keyof Objective,value:string){setObjectiveDraft(current=>current.map((item,i)=>i===index?{...item,[key]:value===""?null:Number(value)}:item));}

  const navButton=(id:View,label:string)=><button id={`nav-${id}`} type="button" className={view===id?"active":""} onClick={()=>setView(id)}><i/><span>{label}</span><b>›</b></button>;
  const sourceDate=data.dashboard?.liveFreshness?.sourceModifiedAt??data.dashboard?.liveFreshness?.factoryModifiedAt??null;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><Image src="/crvo-logo.png" width={178} height={52} alt="CRVO" priority/></div>
      <div className="sidebar-context"><span>KPI CRVO</span><strong>Pilotage Lens</strong><small>Données opérationnelles & direction</small></div>
      <nav>
        {navButton("today","Performance du jour")}
        {navButton("yesterday","Dashboard")}
        {navButton("bottlenecks","Goulot")}
        {navButton("walking","Walking Dead")}
        {navButton("finance","Chiffre d'affaire")}
        {navButton("objectives","Objectif & seuil")}
        {navButton("sources","Source & Connexion")}
      </nav>
      <div className="sidebar-bottom"><span className={data.dashboard?.connected?"live-dot":"book-dot"}/><div><strong>{data.dashboard?.connected?"Sources réelles connectées":"Source indisponible"}</strong><small>{latest?`Dernière donnée · ${latest.label}`:"Aucune donnée présentée"}</small></div></div>
    </aside>

    <main className={`main-workspace ${styles.workspace}`}>
      <header className={styles.topbar}>
        <div className={styles.brand}><Image src="/crvo-logo.png" width={132} height={39} alt="CRVO"/></div>
        <div className={styles.title}><span>PILOTAGE OPÉRATIONNEL</span><h1>{view==="today"?"Performance du jour":view==="yesterday"?"Dashboard":view==="bottlenecks"?"Goulots & encours":view==="walking"?"Walking Dead":view==="finance"?"Chiffre d'affaire":view==="objectives"?"Objectifs & seuils":"Sources & connexion"}</h1></div>
        <div className={`${styles.status} ${!data.dashboard?.connected?styles.bad:""}`}><i/><div><strong>{data.dashboard?.connected?"DONNÉES RÉELLES":"DONNÉES INDISPONIBLES"}</strong><small>{sourceDate?`Actualisé ${dateTime(sourceDate)}`:latest?.label??"—"}</small></div></div>
      </header>

      <div className={styles.page}>
        {error&&<div className={styles.error}><strong>Une source n'a pas répondu.</strong> {error} Aucun chiffre de secours n'est injecté.</div>}
        {loading&&!latest&&<Empty title="Connexion aux sources réelles" text="Le tableau de bord attend les données CRVO. Aucune valeur de démonstration n'est utilisée."/>}

        {view==="today"&&latest&&<Today latest={latest} previous={previous} objectives={objectives} system={data.system}/>} 
        {view==="yesterday"&&latest&&<Summary snapshot={previous??latest} objectives={objectives} isPrevious={Boolean(previous)}/>} 
        {view==="bottlenecks"&&<Bottlenecks data={data.bottlenecks} current={currentBottleneck} selected={selectedSector} onSelect={setSelectedSector}/>} 
        {view==="walking"&&<Walking vehicles={walking} sourceModifiedAt={data.intelligence?.sourceModifiedAt}/>} 
        {view==="finance"&&<Finance snapshot={finance} payload={data.finance}/>} 
        {view==="objectives"&&<Objectives rows={objectiveDraft} canEdit={canSettings} onChange={updateObjective} onSave={saveObjectives} saving={savingObjectives}/>} 
        {view==="sources"&&<Sources dashboard={data.dashboard} system={data.system} finance={data.finance} intelligence={data.intelligence}/>} 
      </div>
    </main>
  </div>;
}

function Empty({title,text}:{title:string;text:string}){return <section className={styles.empty}><strong>{title}</strong><p>{text}</p></section>;}

function Today({latest,previous,objectives,system}:{latest:Snapshot;previous:Snapshot|null;objectives:Objective[];system:SystemStatus|null}){
  const stockDelta=previous?latest.stock-previous.stock:null;
  return <>
    <section className={styles.hero}><div><span>PILOTAGE QUOTIDIEN</span><h2>Performance du jour</h2><p>Dernière photographie issue des sources réellement connectées. Les objectifs sont lus exclusivement depuis la base de paramétrage.</p></div><div className={styles.heroMeta}><small>DATE DE DONNÉE</small><strong>{latest.label}</strong><small style={{marginTop:8}}>SOURCE</small><strong>{latest.source}</strong><small style={{marginTop:8}}>DERNIÈRE SYNCHRO FTP</small><strong>{dateTime(system?.ftpRefresh?.lastRefreshAt)}</strong></div></section>
    <section className={styles.kpis}><Kpi label="ENTRÉES VOP" value={fmt(latest.entries)} detail="Flux du jour"/><Kpi label="SORTIES VOP" value={fmt(latest.exits)} detail={targetFor("Sortie usine",objectives)!=null?`objectif ${targetFor("Sortie usine",objectives)}`:"objectif non configuré"}/><Kpi label="STOCK USINE" value={fmt(latest.stock)} detail={stockDelta==null?"première photo disponible":`${stockDelta>0?"+":""}${stockDelta} vs photo précédente`}/><Kpi label="STOCK >20 J" value={fmt(latest.over20)} detail={`${fmt(latest.stock?latest.over20/latest.stock*100:0,1)} % du parc`}/></section>
    <section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>PRODUCTION</span><h3>Réalisé vs objectif</h3></div><p>Aucun objectif n'est reconstitué côté interface : une valeur absente en base reste explicitement non configurée.</p></div><div className={styles.grid}>{latest.production.map(item=>{const target=targetFor(item.name,objectives);const ratio=target&&target>0?Math.min(item.value/target*100,100):0;const gap=target!=null?item.value-target:null;return <article key={item.name} className={styles.card}><span>{item.name.toUpperCase()}</span><strong>{fmt(item.value)}</strong><small>{target!=null?`Objectif ${fmt(target)} · écart ${gap!>0?"+":""}${fmt(gap)}`:"Objectif non configuré"}</small>{target!=null&&<div className={styles.bar}><i style={{width:`${ratio}%`}}/></div>}</article>;})}</div></section>
  </>;
}

function Summary({snapshot,objectives,isPrevious}:{snapshot:Snapshot;objectives:Objective[];isPrevious:boolean}){
  return <><section className={styles.hero}><div><span>SYNTHÈSE OPÉRATIONNELLE</span><h2>{isPrevious?"Dernière journée clôturée":"Dernière synthèse disponible"}</h2><p>Lecture factuelle de la photographie enregistrée, sans reconstruction de données manquantes.</p></div><div className={styles.heroMeta}><small>DATE</small><strong>{snapshot.label}</strong><small style={{marginTop:8}}>SOURCE</small><strong>{snapshot.source}</strong></div></section><section className={styles.kpis}><Kpi label="ENTRÉES" value={fmt(snapshot.entries)} detail="VOP"/><Kpi label="SORTIES" value={fmt(snapshot.exits)} detail={targetFor("Sortie usine",objectives)!=null?`objectif ${targetFor("Sortie usine",objectives)}`:"objectif non configuré"}/><Kpi label="STOCK" value={fmt(snapshot.stock)} detail={`${fmt(snapshot.over15)} véhicules >15 j`}/><Kpi label=">20 J" value={fmt(snapshot.over20)} detail={`${fmt(snapshot.stock?snapshot.over20/snapshot.stock*100:0,1)} % du parc`}/></section><section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>PRODUCTION</span><h3>Résultats enregistrés</h3></div></div><div className={styles.grid}>{snapshot.production.map(item=><article className={styles.card} key={item.name}><span>{item.name.toUpperCase()}</span><strong>{fmt(item.value)}</strong><small>{targetFor(item.name,objectives)!=null?`Objectif ${fmt(targetFor(item.name,objectives))}`:"Objectif non configuré"}</small></article>)}</div></section></>;
}

function Kpi({label,value,detail}:{label:string;value:string;detail:string}){return <article className={styles.kpi}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;}

function Bottlenecks({data,current,selected,onSelect}:{data:BottleneckPayload|null;current:BottleneckSector|null;selected:string;onSelect:(value:string)=>void}){
  if(!data?.connected||!data.sectors?.length)return <Empty title="Encours réels indisponibles" text="Le module n'affiche aucune série de secours. Il se remplira uniquement avec les photos EtatduParc reçues et figées en base."/>;
  const firstDate=current?.points?.[0]?.date;const values=current?.points.map(point=>point.value)??[];const maxValue=Math.max(1,...values,current?.max??0);
  return <><section className={styles.hero}><div><span>GOULOTS D'ÉTRANGLEMENT</span><h2>Encours par secteur</h2><p>Historique construit exclusivement à partir des photos EtatduParc réellement reçues.</p></div><div className={styles.heroMeta}><small>DERNIÈRE PHOTO</small><strong>{dateLabel(data.latestDate)}</strong><small style={{marginTop:8}}>SOURCE</small><strong>{data.source??"EtatduParc"}</strong></div></section><section className={styles.section}><div className={styles.sectorTabs}>{data.sectors.map(sector=><button key={sector.key} className={selected===sector.key?styles.active:""} onClick={()=>onSelect(sector.key)}>{sector.label}</button>)}</div>{current&&<div className={styles.grid}><article className={styles.card}><span>ENCOURS ACTUEL</span><strong>{fmt(current.actual)}</strong><small>{current.max!=null?`Seuil ${fmt(current.max)} · ${current.aboveMax?`${fmt(current.aboveMax)} au-dessus`:"sous le seuil"}`:"Seuil non configuré"}</small></article><article className={styles.card}><span>ÉVOLUTION</span><strong className={current.evolution>0?styles.negative:styles.positive}>{pct(current.evolution)}</strong><small>vs photo précédente</small></article><article className={styles.card}><span>CHARGE</span><strong>{current.workDays!=null?`${fmt(current.workDays,2)} j`:"—"}</strong><small>{current.cadence!=null?`cadence configurée ${fmt(current.cadence)} / j`:"cadence non configurée"}</small></article></div>}</section>{current&&<section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>HISTORIQUE RÉEL</span><h3>{current.label}</h3></div><p>{firstDate?`Données disponibles depuis le ${dateLabel(firstDate)}.`:"Aucune photo historique."}</p></div><article className={styles.card}>{values.length?<div className={styles.chart}>{values.map((value,index)=><i key={`${current.key}-${current.points[index].date}`} title={`${dateLabel(current.points[index].date)} · ${value}`} style={{height:`${Math.max(3,value/maxValue*100)}%`}}/>)}</div>:<small>Aucun historique réel disponible.</small>}</article></section>}</>;
}

function Walking({vehicles,sourceModifiedAt}:{vehicles:WalkingVehicle[];sourceModifiedAt?:string|null}){
  if(!vehicles.length)return <Empty title="Aucun dossier Walking Dead disponible" text="Aucune liste statique n'est embarquée. Les dossiers apparaissent uniquement depuis l'état réel du parc."/>;
  return <><section className={styles.hero}><div><span>WALKING DEAD</span><h2>Dossiers les plus anciens</h2><p>Classement issu de l'état réel des véhicules, par ancienneté usine décroissante.</p></div><div className={styles.heroMeta}><small>ACTUALISATION SOURCE</small><strong>{dateTime(sourceModifiedAt)}</strong><small style={{marginTop:8}}>DOSSIERS AFFICHÉS</small><strong>{vehicles.length}</strong></div></section><section className={styles.section}><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Rang</th><th>Immatriculation</th><th>OR</th><th>Client</th><th>Statut</th><th>Cause</th><th>Âge usine</th></tr></thead><tbody>{vehicles.map((vehicle,index)=><tr key={`${vehicle.registration}-${vehicle.workOrder}-${index}`}><td>{index+1}</td><td><strong>{vehicle.registration??"—"}</strong></td><td>{vehicle.workOrder??"—"}</td><td>{vehicle.client??"—"}</td><td>{vehicle.status??"—"}</td><td>{vehicle.cause??"—"}</td><td><span className={styles.pill}>{fmt(vehicle.ageDays,1)} j</span></td></tr>)}</tbody></table></div></section></>;
}

function Finance({snapshot,payload}:{snapshot:FinancialSnapshot|null;payload:FinancePayload|null}){
  if(!payload?.connected||!snapshot)return <Empty title="Données financières réelles indisponibles" text="Le module CA ne possède plus d'historique embarqué. Il attend exclusivement le reporting factures CRVO connecté."/>;
  const revenueDay=metric(snapshot,"revenue_day"),revenueCumulative=metric(snapshot,"revenue_cumulative"),dayTarget=metric(snapshot,"revenue_day_target"),monthTarget=metric(snapshot,"revenue_cumulative_target"),laborRevenue=metric(snapshot,"labor_revenue_cumulative"),invoices=metric(snapshot,"invoices_cumulative");
  return <><section className={styles.hero}><div><span>CHIFFRE D'AFFAIRE</span><h2>Performance financière</h2><p>Calculée depuis les factures CRVO importées. Aucun chiffre historique n'est embarqué dans l'application.</p></div><div className={styles.heroMeta}><small>ARRÊTÉ AU</small><strong>{dateLabel(snapshot.date)}</strong><small style={{marginTop:8}}>SOURCE</small><strong>{snapshot.source}</strong></div></section><section className={styles.kpis}><Kpi label="CA JOUR" value={euro(revenueDay)} detail={dayTarget!=null?`objectif ${euro(dayTarget)}`:"objectif non configuré"}/><Kpi label="CA CUMULÉ" value={euro(revenueCumulative)} detail={monthTarget!=null?`objectif mensuel ${euro(monthTarget)}`:"objectif mensuel non configuré"}/><Kpi label="CA MAIN-D'ŒUVRE" value={euro(laborRevenue)} detail="cumul importé"/><Kpi label="FACTURES" value={fmt(invoices)} detail="cumul mois"/></section><section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>HISTORIQUE FACTURES</span><h3>CA quotidien réel</h3></div><p>{payload.backend??"Reporting factures CRVO"}</p></div><article className={styles.card}>{payload.snapshots?.length?<div className={styles.chart}>{[...payload.snapshots].reverse().map(row=>{const value=metric(row,"revenue_day")??0;const max=Math.max(1,...(payload.snapshots??[]).map(item=>metric(item,"revenue_day")??0));return <i key={row.date} title={`${dateLabel(row.date)} · ${euro(value)}`} style={{height:`${Math.max(3,value/max*100)}%`}}/>;})}</div>:<small>Aucun historique quotidien disponible.</small>}</article></section></>;
}

function Objectives({rows,canEdit,onChange,onSave,saving}:{rows:Objective[];canEdit:boolean;onChange:(index:number,key:keyof Objective,value:string)=>void;onSave:()=>void;saving:boolean}){
  if(!rows.length)return <Empty title="Aucun objectif configuré" text="La base ne contient aucun objectif pour le mois courant. Aucune valeur par défaut n'est substituée."/>;
  return <><section className={styles.hero}><div><span>PARAMÉTRAGE MÉTIER</span><h2>Objectifs & seuils</h2><p>Référentiel officiel du mois. Ces valeurs sont conservées en base et utilisées par les écrans de pilotage.</p></div><div className={styles.heroMeta}><small>PÉRIODE</small><strong>{isoMonth()}</strong><small style={{marginTop:8}}>MODIFICATION</small><strong>{canEdit?"AUTORISÉE":"LECTURE SEULE"}</strong></div></section><section className={styles.section}><div className={styles.tableWrap}><table className={`${styles.table} ${styles.formTable}`}><thead><tr><th>Secteur</th><th>Objectif / jour</th><th>Seuil min</th><th>Seuil max</th><th>Dernière mise à jour</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.sectorKey}><td><strong>{row.sectorLabel}</strong></td><td><input disabled={!canEdit} type="number" min="0" value={row.dailyTarget??""} onChange={e=>onChange(index,"dailyTarget",e.target.value)}/></td><td><input disabled={!canEdit} type="number" min="0" value={row.minThreshold??""} onChange={e=>onChange(index,"minThreshold",e.target.value)}/></td><td><input disabled={!canEdit} type="number" min="0" value={row.maxThreshold??""} onChange={e=>onChange(index,"maxThreshold",e.target.value)}/></td><td>{dateTime(row.updatedAt)}</td></tr>)}</tbody></table></div>{canEdit&&<div className={styles.actions}><button className={styles.button} disabled={saving} onClick={onSave}>{saving?"ENREGISTREMENT…":"ENREGISTRER EN BASE"}</button></div>}</section></>;
}

function Sources({dashboard,system,finance,intelligence}:{dashboard:DashboardPayload|null;system:SystemStatus|null;finance:FinancePayload|null;intelligence:IntelligencePayload|null}){
  return <><section className={styles.hero}><div><span>CONFIANCE & TRAÇABILITÉ</span><h2>Sources & connexion</h2><p>État des flux réellement utilisés. Une source absente reste absente : elle n'est jamais remplacée par une donnée de démonstration.</p></div><div className={styles.heroMeta}><small>MODE</small><strong>PRODUCTION RÉELLE</strong><small style={{marginTop:8}}>FALLBACK FICTIF</small><strong>DÉSACTIVÉ</strong></div></section><section className={styles.section}><div className={styles.sourceGrid}><article className={styles.sourceCard}><span>FTP PARC & PRODUCTION</span><strong>{system?.ftpBridge?"Connecté":"Indisponible"}</strong><small>Dernier rafraîchissement : {dateTime(system?.ftpRefresh?.lastRefreshAt)}<br/>Dernier dépôt : {dateTime(system?.ftpRefresh?.lastDepositAt)}</small></article><article className={styles.sourceCard}><span>DASHBOARD OPÉRATIONNEL</span><strong>{dashboard?.connected?"Connecté":"Indisponible"}</strong><small>{dashboard?.latestSource??"Aucune source"}<br/>Dernière donnée : {dashboard?.snapshot?.label??"—"}</small></article><article className={styles.sourceCard}><span>FACTURATION</span><strong>{finance?.connected?"Connectée":"Indisponible"}</strong><small>{finance?.snapshot?.source??"Aucune source"}<br/>Arrêté : {dateLabel(finance?.snapshot?.date)}</small></article><article className={styles.sourceCard}><span>PARC INTELLIGENCE</span><strong>{intelligence?.connected!==false&&intelligence?"Connecté":"Indisponible"}</strong><small>Dernière source : {dateTime(intelligence?.sourceModifiedAt)}</small></article><article className={styles.sourceCard}><span>SUPABASE</span><strong>{system?.supabase?"Connecté":"Indisponible"}</strong><small>Statut : {system?.supabaseStatus??"—"}</small></article><article className={styles.sourceCard}><span>POLITIQUE DE DONNÉE</span><strong>Fail closed</strong><small>Erreur ou absence de source = écran indisponible. Aucun chiffre embarqué n'est substitué.</small></article></div><div className={styles.note}><strong>Contrôle de mise en production :</strong> les modules RH, temps facturé et OR encours doivent disposer de fichiers récents avant leur exploitation quotidienne. Leur fraîcheur est contrôlée séparément dans la phase de readiness.</div></section></>;
}