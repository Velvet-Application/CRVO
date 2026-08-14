"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./carrosserie.module.css";

type TeamCode="A"|"B"|"C";
type Daily={date:string;sourceModifiedAt:string|null;boxHeavy:number;fixline1:number;fixline2:number;fixline3:number;total:number};
type TeamDaily={date:string;team:TeamCode;soldHours:number;boughtHours:number;dossiers:number;efficiency:number|null};
type ClientTime={client:string;hours:number;dossiers:number;avgHoursPerDossier:number;teams:string[]};
type StaffMap={id:string;mechanic_name:string;name_key:string;team_code:TeamCode;workcenter:string;matricule:string|null;service:string|null;mapping_source:"manual"|"rh_import";active:boolean};
type Workload={snapshotAt:string;sourceName:string;workOrders:number;remainingHours:number;potentialRevenue:number;runPool:number;maxAgeDays:number|null;updatedAt:string};
type Payload={
  generatedAt:string;
  operationalModel:{week:string;shifts:Array<{code:string;label:string;start:string;end:string;rotation:string}>;bodyshop:{fixlinesPerTeam:number;boxesPerTeam:number;heavyPanel:boolean};saturdayRule:string};
  production:{daily:Daily[];latest:Daily|null};
  teamDaily:TeamDaily[];
  clientTimes:ClientTime[];
  workload:Workload|null;
  staffMapping:StaffMap[];
  unmappedStaff:string[];
  readiness:{teamMapping:number;autoTeamMapping:number;teamHours:number;clientRows:number};
};

type Simulator={fixline1:number;fixline2:number;fixline3:number;boxHeavy:number};
const DEFAULT_SIM:Simulator={fixline1:100,fixline2:100,fixline3:100,boxHeavy:100};
const workcenters=[
  ["mixed","Polyvalent"],["fixline_1","Fixline 1"],["fixline_2","Fixline 2"],["fixline_3","Fixline 3"],["box","Box"],["heavy","Tôlerie lourde"],
] as const;

function fmt(value:number,digits=0){return Number(value||0).toLocaleString("fr-FR",{maximumFractionDigits:digits});}
function pct(value:number|null){return value==null?"—":`${fmt(value,1)}%`;}
function money(value:number){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(value||0);}
function dateLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"short",day:"2-digit",month:"short",timeZone:"Europe/Paris"}).format(new Date(`${value}T12:00:00+02:00`));}
function avg(rows:Daily[],key:keyof Pick<Daily,"fixline1"|"fixline2"|"fixline3"|"boxHeavy"|"total">){if(!rows.length)return 0;return rows.reduce((sum,row)=>sum+Number(row[key]||0),0)/rows.length;}

export default function CarrosseriePage(){
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [sim,setSim]=useState<Simulator>(DEFAULT_SIM);
  const [period,setPeriod]=useState<"week"|"month">("week");
  const [drafts,setDrafts]=useState<Record<string,{team:TeamCode;workcenter:string}>>({});
  const [saving,setSaving]=useState<string>("");

  async function load(){
    try{
      const response=await fetch(`/api/bodyshop?_=${Date.now()}`,{cache:"no-store"});
      const payload=await response.json() as Payload&{error?:string};
      if(!response.ok)throw new Error(payload.error||"Focus carrosserie indisponible");
      setData(payload);setError("");
    }catch(reason){setError(reason instanceof Error?reason.message:"Focus carrosserie indisponible");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(timer);},[]);

  const recentProduction=useMemo(()=>data?.production.daily.slice(-10)??[],[data]);
  const baseline=useMemo(()=>({
    fixline1:avg(recentProduction,"fixline1"),fixline2:avg(recentProduction,"fixline2"),fixline3:avg(recentProduction,"fixline3"),boxHeavy:avg(recentProduction,"boxHeavy"),total:avg(recentProduction,"total"),
  }),[recentProduction]);
  const simulated=useMemo(()=>{
    const fixline1=baseline.fixline1*sim.fixline1/100;
    const fixline2=baseline.fixline2*sim.fixline2/100;
    const fixline3=baseline.fixline3*sim.fixline3/100;
    const boxHeavy=baseline.boxHeavy*sim.boxHeavy/100;
    const total=fixline1+fixline2+fixline3+boxHeavy;
    return{fixline1,fixline2,fixline3,boxHeavy,total,weekly:total*5,delta:total-baseline.total};
  },[baseline,sim]);

  const teamSummary=useMemo(()=>{
    const rows=data?.teamDaily??[];
    if(!rows.length)return ["A","B","C"].map(team=>({team:team as TeamCode,sold:0,bought:0,dossiers:0,efficiency:null as number|null}));
    const lastDate=rows.map(row=>row.date).sort().at(-1)!;
    const month=lastDate.slice(0,7);
    const uniqueDates=[...new Set(rows.map(row=>row.date))].sort();
    const keep=new Set(period==="week"?uniqueDates.slice(-5):uniqueDates.filter(date=>date.startsWith(month)));
    return (["A","B","C"] as TeamCode[]).map(team=>{
      const filtered=rows.filter(row=>row.team===team&&keep.has(row.date));
      const sold=filtered.reduce((s,r)=>s+r.soldHours,0),bought=filtered.reduce((s,r)=>s+r.boughtHours,0),dossiers=filtered.reduce((s,r)=>s+r.dossiers,0);
      return{team,sold,bought,dossiers,efficiency:bought>0?sold/bought*100:null};
    });
  },[data,period]);

  const weeklyCapacity=useMemo(()=>{
    const rows=data?.teamDaily??[];
    const uniqueDates=[...new Set(rows.map(row=>row.date))].sort();
    const keep=new Set(uniqueDates.slice(-5));
    const recent=rows.filter(row=>keep.has(row.date));
    const sold=recent.reduce((sum,row)=>sum+row.soldHours,0);
    const bought=recent.reduce((sum,row)=>sum+row.boughtHours,0);
    const days=Math.max(keep.size,1);
    return{sold,bought,days,dailySold:sold/days,dailyBought:bought/days};
  },[data]);

  const workloadProjection=useMemo(()=>{
    const remaining=data?.workload?.remainingHours??0;
    const performanceRatio=baseline.total>0?simulated.total/baseline.total:1;
    const simulatedSoldPerDay=weeklyCapacity.dailySold*performanceRatio;
    return{
      currentDays:weeklyCapacity.dailySold>0?remaining/weeklyCapacity.dailySold:null,
      simulatedDays:simulatedSoldPerDay>0?remaining/simulatedSoldPerDay:null,
      simulatedSoldPerDay,
    };
  },[data,baseline.total,simulated.total,weeklyCapacity.dailySold]);

  async function saveMapping(name:string){
    const draft=drafts[name]??{team:"A" as TeamCode,workcenter:"mixed"};
    setSaving(name);
    try{
      const response=await fetch("/api/bodyshop",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mechanicName:name,teamCode:draft.team,workcenter:draft.workcenter})});
      const payload=await response.json() as {error?:string};
      if(!response.ok)throw new Error(payload.error||"Enregistrement impossible");
      await load();
    }catch(reason){setError(reason instanceof Error?reason.message:"Enregistrement impossible");}
    finally{setSaving("");}
  }

  if(loading&&!data)return <main className={styles.loading}><div/><strong>FOCUS CARROSSERIE</strong><span>Consolidation production, heures et équipes…</span></main>;
  const latest=data?.production.latest??null;

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href="/cockpit-v2?section=pilotage" className={styles.back}>← CRVO COCKPIT V2</a><span>FOCUS MÉTIER · CARROSSERIE</span><h1>PERFORMANCE CARROSSERIE</h1><p>Production par moyen, heures vendues / présence, efficacité A-B-C, charge d’encours et simulation de capacité.</p></div>
      <aside><span>RYTHME CENTRE</span><strong>3 × 8</strong><small>{data?.operationalModel.week??"Lun. 05:00 → sam. 05:00"}</small></aside>
    </header>

    {error&&<div className={styles.warning}>{error}</div>}

    <section className={styles.shiftStrip}>
      {(data?.operationalModel.shifts??[]).map(shift=><article key={shift.label}><span>{shift.label.toUpperCase()}</span><strong>{shift.start} — {shift.end}</strong><small>{shift.rotation}</small></article>)}
      <article className={styles.capacity}><span>ORGANISATION / ÉQUIPE</span><strong>3 Fixline · 5 Box</strong><small>+ tôlerie lourde · samedi matin rattaché au vendredi</small></article>
    </section>

    <section className={styles.kpis}>
      <article><span>PRODUCTION CARROSSERIE</span><strong>{latest?fmt(latest.total):"—"}</strong><small>{latest?dateLabel(latest.date):"FTP en attente"}</small></article>
      <article><span>FIXLINE 1 / 2 / 3</span><strong>{latest?`${latest.fixline1} · ${latest.fixline2} · ${latest.fixline3}`:"—"}</strong><small>sorties par flux Factory</small></article>
      <article><span>BOX + TÔLERIE</span><strong>{latest?fmt(latest.boxHeavy):"—"}</strong><small>flux « Carrosseries » hors Fixline</small></article>
      <article className={styles.workloadKpi}><span>HEURES D’ENCOURS</span><strong>{data?.workload?`${fmt(data.workload.remainingHours,1)} h`:"—"}</strong><small>{data?.workload?`${fmt(data.workload.workOrders)} dossiers · photo ${dateLabel(data.workload.snapshotAt)}`:"source encours en attente"}</small></article>
      <article><span>MOYENNE 10 J</span><strong>{fmt(baseline.total,1)}</strong><small>base du simulateur</small></article>
    </section>

    {data?.workload&&<section className={styles.workloadBand}>
      <div><span>RESTE À PRODUIRE</span><strong>{fmt(data.workload.remainingHours,1)} h</strong><small>heures de travail carrosserie encore en encours</small></div>
      <div><span>DOSSIERS ENCOURS</span><strong>{fmt(data.workload.workOrders)}</strong><small>âge maxi {data.workload.maxAgeDays==null?"—":`${fmt(data.workload.maxAgeDays)} j`}</small></div>
      <div><span>CHARGE À CADENCE ACTUELLE</span><strong>{workloadProjection.currentDays==null?"—":`${fmt(workloadProjection.currentDays,1)} j`}</strong><small>{weeklyCapacity.dailySold?`${fmt(weeklyCapacity.dailySold,1)} h vendues / jour observées`:`s’active après import des heures facturées`}</small></div>
      <div><span>POTENTIEL ENCOURS</span><strong>{money(data.workload.potentialRevenue)}</strong><small>{data.workload.sourceName}</small></div>
    </section>}

    <section className={styles.mainGrid}>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><span>ÉQUIPES A · B · C</span><h2>Heures & efficacité</h2></div><div className={styles.period}><button className={period==="week"?styles.active:""} onClick={()=>setPeriod("week")}>5 jours</button><button className={period==="month"?styles.active:""} onClick={()=>setPeriod("month")}>Mois</button></div></div>
        <div className={styles.teamGrid}>{teamSummary.map(team=><div className={styles.teamCard} key={team.team}><header><span>ÉQUIPE</span><strong>{team.team}</strong></header><div><span>Heures vendues</span><b>{team.sold?fmt(team.sold,1):"—"}</b></div><div><span>Heures achetées / présence</span><b>{team.bought?fmt(team.bought,1):"—"}</b></div><div><span>Efficacité</span><b className={team.efficiency!=null&&team.efficiency>=100?styles.good:styles.watch}>{pct(team.efficiency)}</b></div><footer><span>Dossiers facturés</span><b>{team.dossiers||"—"}</b></footer></div>)}</div>
        {!data?.readiness.teamHours&&<div className={styles.dataNote}><strong>Les heures par équipe s’activeront après tes imports directs.</strong><span>Heures vendues = temps pointé sur dossiers facturés. Heures achetées = heures de présence. Nom, prénom, service, équipe et matricule sont lus automatiquement dans le fichier de pointage ; le rattachement manuel reste disponible seulement pour les exceptions.</span></div>}
      </article>

      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><span>SIMULATEUR DE VOLUME</span><h2>Et si la performance bouge ?</h2></div><button className={styles.reset} onClick={()=>setSim(DEFAULT_SIM)}>Réinitialiser</button></div>
        <div className={styles.simResult}><div><span>Volume / jour simulé</span><strong>{fmt(simulated.total,1)}</strong><small>{simulated.delta>=0?"+":""}{fmt(simulated.delta,1)} vs moyenne</small></div><div><span>Volume / semaine</span><strong>{fmt(simulated.weekly,0)}</strong><small>5 journées opérationnelles</small></div><div><span>Absorption de l’encours</span><strong>{workloadProjection.simulatedDays==null?"—":`${fmt(workloadProjection.simulatedDays,1)} j`}</strong><small>{data?.workload?`${fmt(data.workload.remainingHours,0)} h restantes à cadence simulée`:`heures d’encours en attente`}</small></div></div>
        <div className={styles.sliders}>{([
          ["fixline1","Fixline 1",baseline.fixline1],["fixline2","Fixline 2",baseline.fixline2],["fixline3","Fixline 3",baseline.fixline3],["boxHeavy","Box + tôlerie",baseline.boxHeavy],
        ] as Array<[keyof Simulator,string,number]>).map(([key,label,base])=><label key={key}><div><span>{label}</span><b>{sim[key]}%</b></div><input type="range" min="60" max="140" step="5" value={sim[key]} onChange={event=>setSim(current=>({...current,[key]:Number(event.target.value)}))}/><small>base {fmt(base,1)} → simulé {fmt(base*sim[key]/100,1)} / jour</small></label>)}</div>
      </article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelTitle}><div><span>CADENCE PAR MOYEN</span><h2>10 dernières journées opérationnelles</h2></div><p>Le samedi éventuel est consolidé avec le vendredi.</p></div>
      <div className={styles.history}>{recentProduction.map(row=>{const max=Math.max(...recentProduction.map(item=>item.total),1);return <div key={row.date}><span>{dateLabel(row.date)}</span><i><b style={{width:`${row.total/max*100}%`}}/></i><strong>{row.total}</strong><small>F1 {row.fixline1} · F2 {row.fixline2} · F3 {row.fixline3} · Box {row.boxHeavy}</small></div>})}</div>
    </section>

    <section className={styles.bottomGrid}>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><span>TEMPS MOYEN PAR CLIENT</span><h2>Charge carrosserie facturée</h2></div></div>
        {data?.clientTimes.length?<div className={styles.clientTable}><div><span>CLIENT</span><span>DOSSIERS</span><span>H / DOSSIER</span><span>HEURES</span></div>{data.clientTimes.slice(0,12).map(row=><div key={row.client}><strong>{row.client}</strong><span>{row.dossiers}</span><b>{fmt(row.avgHoursPerDossier,1)} h</b><span>{fmt(row.hours,1)} h</span></div>)}</div>:<div className={styles.empty}>Le temps client apparaîtra après import des factures + temps pointés. Le rattachement A/B/C est récupéré automatiquement depuis le fichier RH quand le service et l’équipe sont présents.</div>}
      </article>

      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><span>CONTRÔLE DES AFFECTATIONS</span><h2>Collaborateurs carrosserie</h2></div><em>{data?.readiness.autoTeamMapping??0} auto · {data?.readiness.teamMapping??0} total</em></div>
        {data?.unmappedStaff.length?<div className={styles.mappingList}>{data.unmappedStaff.slice(0,30).map(name=>{const draft=drafts[name]??{team:"A" as TeamCode,workcenter:"mixed"};return <div key={name}><strong>{name}</strong><select value={draft.team} onChange={e=>setDrafts(current=>({...current,[name]:{...draft,team:e.target.value as TeamCode}}))}><option value="A">Équipe A</option><option value="B">Équipe B</option><option value="C">Équipe C</option></select><select value={draft.workcenter} onChange={e=>setDrafts(current=>({...current,[name]:{...draft,workcenter:e.target.value}}))}>{workcenters.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select><button disabled={saving===name} onClick={()=>void saveMapping(name)}>{saving===name?"…":"Affecter"}</button></div>})}</div>:<div className={styles.empty}>{data?.readiness.teamMapping?"Les collaborateurs carrosserie détectés sont rattachés. Les affectations issues du RH sont automatiques ; tu peux garder le mapping manuel pour corriger une exception.":"Les collaborateurs apparaîtront ici après le premier import RH / pointage."}</div>}
      </article>
    </section>

    <footer className={styles.footer}><span>CRVO Lens · Cockpit V2 · Focus carrosserie</span><span>FTP production + imports directs RH / facturation / pointage + heures d’encours</span></footer>
  </main>;
}
