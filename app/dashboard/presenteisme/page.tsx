"use client";

import { useEffect, useMemo, useState } from "react";
import DashboardSectionNav from "../../dashboard-section-nav";
import styles from "./presenteisme.module.css";

type TeamRow={sectorKey:string;sectorLabel:string;team:string;nominal:number;present:number;unavailable:number;approvedLeave:number;medicalAbsence:number;otherAbsence:number;pendingLeave:number;hours:number;hoursIfPendingApproved:number;availabilityPct:number|null;status:"ok"|"warning"|"critical"|"neutral";avgBilledHoursPerSiteVehicle10d:number|null;avgBilledHoursPerTouchedVehicle10d:number|null;referenceTouchedVehicles:number;theoreticalVehicles:number|null;theoreticalVehiclesIfPendingApproved:number|null;capacityReference?:string|null;capacityReferenceRatePerPersonDay?:number|null};
type SectorRow={sectorKey:string;sectorLabel:string;nominal:number;present:number;unavailable:number;approvedLeave:number;medicalAbsence:number;otherAbsence:number;pendingLeave:number;hours:number;hoursIfPendingApproved:number;avgBilledHoursPerSiteVehicle10d:number|null;avgBilledHoursPerTouchedVehicle10d:number|null;referenceTouchedVehicles:number;theoreticalVehicles:number|null;theoreticalVehiclesIfPendingApproved:number|null;actualVehicles:number|null;utilizationPct:number|null;capacityReference?:string|null;capacityReferenceRatePerPersonDay?:number|null};
type ShiftRow={team:string;nominal:number;present:number;unavailable:number;pendingLeave:number;hours:number};
type Payload={connected:boolean;date:string;mode:"past"|"today"|"future";isWeekend:boolean;hoursPerProductive:number;teams:TeamRow[];sectors:SectorRow[];shifts:ShiftRow[];reference:{windowStart:string;windowEnd:string;invoiceMinDate?:string|null;invoiceMaxDate?:string|null;invoicedVehicles:number;billedImportedAt?:string|null;complete:boolean;method:string;siteAvgBilledHoursPerVehicle10d?:number|null;activityCapacityMethod?:string|null;siteCapacityMethod?:string|null;siteCapacityModel?:string|null;polycompetenceApplied?:boolean;directCadenceLowestSector?:string|null;siteReferenceAvailableEtp?:number|null;siteReferenceExitsPerDay?:number|null};summary:{nominal:number;present:number;unavailable:number;pendingLeave:number;productiveHours:number;productiveHoursIfPendingApproved:number;siteTheoreticalVehicles:number|null;siteTheoreticalVehiclesIfPendingApproved:number|null;bottleneckSector:string|null;bottleneckSectorIfPendingApproved:string|null;actualFactoryExits:number|null;dashboardExits:number|null;capacityVsActualPct:number|null};actualSource?:string|null;error?:string};

const SECTOR_ORDER=["expertise","mecanique","dsp","jantes","carrosserie","preparation","qualite","photo"];
function todayParis(){return new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function shiftDate(value:string,delta:number){const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10);}
function dateLabel(value:string){return new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function fmt(value:number|null|undefined,digits=0){return value==null||!Number.isFinite(Number(value))?"—":Number(value).toLocaleString("fr-FR",{minimumFractionDigits:digits,maximumFractionDigits:digits});}
function modeLabel(mode:Payload["mode"]){return mode==="past"?"Journée clôturée":mode==="future"?"Prévision":"Journée en cours";}
function statusLabel(status:TeamRow["status"]){return status==="critical"?"Critique":status==="warning"?"À surveiller":status==="ok"?"Capacité saine":"Sans effectif";}

export default function SitePresencePage(){
  const[date,setDate]=useState(todayParis());
  const[data,setData]=useState<Payload|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[sector,setSector]=useState("*");
  const[team,setTeam]=useState("*");

  async function load(next=date){
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/site-presence-capacity?date=${next}&_=${Date.now()}`,{cache:"no-store"});
      const payload=await response.json() as Payload;
      if(!response.ok)throw new Error(payload.error||"Chargement impossible.");
      setData(payload);setDate(payload.date);
    }catch(cause){setError(cause instanceof Error?cause.message:"Chargement impossible.");setData(null);}finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  const visibleTeams=useMemo(()=>(data?.teams??[]).filter(row=>(sector==="*"||row.sectorKey===sector)&&(team==="*"||row.team===team)),[data,sector,team]);
  const sectorGroups=useMemo(()=>SECTOR_ORDER.map(key=>({sector:data?.sectors.find(item=>item.sectorKey===key),teams:visibleTeams.filter(item=>item.sectorKey===key)})).filter(group=>Boolean(group.sector)&&(sector==="*"||group.sector?.sectorKey===sector)&&group.teams.length>0),[data,visibleTeams,sector]);

  const summary=data?.summary;
  const reference=data?.reference;
  const historical=data?.mode==="past";
  const current=data?.mode==="today";

  return <>
    <DashboardSectionNav/>
    <main className={styles.page}>
      <header className={styles.hero}>
        <div><p className={styles.eyebrow}>DASHBOARD · CAPACITÉ DU SITE</p><h1>Présentéisme & capacité</h1><p>Effectifs productifs disponibles, heures théoriques et capacité véhicule par activité et par shift.</p></div>
        <div className={styles.dateControl}><button onClick={()=>void load(shiftDate(date,-1))} aria-label="Jour précédent">‹</button><input type="date" value={date} onChange={event=>void load(event.target.value)}/><button onClick={()=>void load(shiftDate(date,1))} aria-label="Jour suivant">›</button><button className={styles.today} onClick={()=>void load(todayParis())}>Aujourd’hui</button></div>
      </header>

      {error&&<div className={styles.error}>{error}</div>}
      {loading&&<div className={styles.loading}>Calcul de la capacité du site…</div>}

      {!loading&&data&&<>
        <section className={styles.contextBar}>
          <div><strong>{dateLabel(data.date)}</strong><span className={styles.mode} data-mode={data.mode}>{modeLabel(data.mode)}</span>{data.isWeekend&&<span className={styles.weekend}>Week-end</span>}</div>
          <small>Référence RH : {fmt(data.hoursPerProductive,1)} h / productif · capacité site fondée sur le débit réellement démontré et les ETP disponibles.</small>
        </section>

        <section className={styles.kpis}>
          <article><span>Productifs disponibles</span><strong>{fmt(summary?.present)}</strong><small>sur {fmt(summary?.nominal)} théoriques · {fmt(summary?.unavailable)} indisponibles</small></article>
          <article><span>Heures productives</span><strong>{fmt(summary?.productiveHours,1)} h</strong><small>{fmt(data.hoursPerProductive,1)} h de capacité par personne présente</small></article>
          <article className={styles.primary}><span>Capacité théorique site</span><strong>{fmt(summary?.siteTheoreticalVehicles)} VO</strong><small>projection intégrant la polycompétence et les renforts inter-activités</small></article>
          {data.mode==="future"?<article><span>Souhaits CP en attente</span><strong>{fmt(summary?.pendingLeave)}</strong><small>si tous acceptés : {fmt(summary?.siteTheoreticalVehiclesIfPendingApproved)} VO</small></article>:<article><span>{historical?"Sorties Usine Factory clôturées":"Sorties Usine à ce stade"}</span><strong>{fmt(summary?.actualFactoryExits)} VO</strong><small>{historical&&summary?.capacityVsActualPct!=null?`${fmt(summary.capacityVsActualPct,1)} % de la capacité théorique`:current?"journée non clôturée":""}</small></article>}
        </section>

        <section className={styles.filters}>
          <label>Activité<select value={sector} onChange={e=>setSector(e.target.value)}><option value="*">Toutes les activités</option>{data.sectors.map(item=><option key={item.sectorKey} value={item.sectorKey}>{item.sectorLabel}</option>)}</select></label>
          <label>Shift<select value={team} onChange={e=>setTeam(e.target.value)}><option value="*">Tous les shifts</option><option value="A">Équipe A</option><option value="B">Équipe B</option><option value="C">Équipe C</option></select></label>
        </section>

        <section className={styles.activityList}>
          {sectorGroups.map(({sector:sectorRow,teams})=>sectorRow&&<article className={styles.activity} key={sectorRow.sectorKey}>
            <div className={styles.activityHead}>
              <div><h2>{sectorRow.sectorLabel}</h2>{sectorRow.capacityReferenceRatePerPersonDay!=null?<p>Cadence métier : <strong>{fmt(sectorRow.capacityReferenceRatePerPersonDay,0)} VO / personne / jour</strong> · {sectorRow.present} productif{sectorRow.present>1?"s":""} présent{sectorRow.present>1?"s":""}</p>:<p>Référence 10 j : <strong>{fmt(sectorRow.avgBilledHoursPerTouchedVehicle10d,2)} h / VO traité</strong></p>}</div>
              <div className={styles.activityNumbers}><span>Capacité activité<strong>{fmt(sectorRow.theoreticalVehicles,0)} VO</strong></span>{data.mode!=="future"&&<span>{historical?"Réalisé":"Réalisé à ce stade"}<strong>{fmt(sectorRow.actualVehicles)} VO</strong></span>}</div>
            </div>
            <div className={styles.teamGrid}>{teams.map(row=><div className={styles.teamCard} key={`${row.sectorKey}-${row.team}`} data-status={row.status}>
              <div className={styles.teamTop}><strong>Équipe {row.team}</strong><span>{statusLabel(row.status)}</span></div>
              <div className={styles.teamMain}><strong>{row.present}</strong><span>/ {row.nominal} productifs</span></div>
              <div className={styles.capacityBar}><i style={{width:`${Math.max(0,Math.min(100,row.availabilityPct??0))}%`}}/></div>
              <dl><div><dt>{row.capacityReferenceRatePerPersonDay!=null?"Cadence":"Heures"}</dt><dd>{row.capacityReferenceRatePerPersonDay!=null?`${fmt(row.capacityReferenceRatePerPersonDay,0)} VO/p/j`:`${fmt(row.hours,1)} h`}</dd></div><div><dt>Capacité</dt><dd>{fmt(row.theoreticalVehicles,1)} VO</dd></div><div><dt>CP / RTT</dt><dd>{row.approvedLeave}</dd></div><div><dt>Arrêts</dt><dd>{row.medicalAbsence}</dd></div></dl>
              {row.pendingLeave>0&&<p className={styles.pending}>+ {row.pendingLeave} souhait{row.pendingLeave>1?"s":""} CP en attente · scénario {fmt(row.theoreticalVehiclesIfPendingApproved,1)} VO</p>}
            </div>)}</div>
          </article>)}
        </section>

        <section className={styles.shiftSummary}><div className={styles.sectionTitle}><div><p className={styles.eyebrow}>LECTURE TRANSVERSE</p><h2>Capacité humaine par shift</h2></div></div><div className={styles.shiftGrid}>{data.shifts.map(item=><article key={item.team}><span>Équipe {item.team}</span><strong>{item.present} / {item.nominal}</strong><small>{fmt(item.hours,1)} h productives · {item.unavailable} indisponible{item.unavailable>1?"s":""}</small></article>)}</div></section>

        <section className={styles.siteSummary}>
          <div><p className={styles.eyebrow}>SYNTHÈSE SITE</p><h2>{data.mode==="future"?"Projection de capacité":"Capacité théorique vs réalisé"}</h2><p>La capacité site n’est plus limitée mécaniquement par le plus petit secteur. Elle est projetée à partir du débit réel des Sorties Usine des jours ouvrés de référence, ramené aux ETP disponibles. Cette méthode intègre la polycompétence et les renforts entre activités. Les cadences métier restent visibles dans chaque activité pour identifier les tensions locales.</p></div>
          <div className={styles.resultBox}><span>Capacité site</span><strong>{fmt(summary?.siteTheoreticalVehicles)} VO</strong><small>Polycompétence intégrée à la projection</small>
            {data.mode==="future"&&Number(summary?.pendingLeave)>0&&<p>Si tous les souhaits CP en attente sont acceptés : <b>{fmt(summary?.siteTheoreticalVehiclesIfPendingApproved)} VO</b></p>}
            {historical&&<p>Sorties Usine Factory clôturées : <b>{fmt(summary?.actualFactoryExits)} VO</b></p>}
          </div>
        </section>

        <footer className={styles.footnote}><span>Effectifs : Data RH + absences saisies + CP validés. Les souhaits CP en attente restent un scénario et ne réduisent pas la capacité engagée.</span><span>Production : {data.actualSource??"Factory"}. Cadences métier : Expertise 8 · DSP 8 · Jantes 6 · Préparation 3 · Qualité 12 · Photo 25 VO/personne/jour.</span></footer>
      </>}
    </main>
  </>;
}
