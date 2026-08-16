"use client";

import { useEffect, useState } from "react";
import styles from "./polycompetence-suggestions.module.css";

type Suggestion = {
  employeeKey:string; fullName:string; teamCode?:string|null; primarySectorLabel?:string|null; skillKey:string; skillLabel:string;
  targetSectorLabel:string; vehicleCount:number; lastUsedDate?:string|null; hours90d?:number; jobs90d?:number; productivity?:number|null; readiness:"ready"|"watch"|"revalidate";
};
type Payload = { coverage?:{billedThrough?:string|null;bottleneckSnapshot?:string|null}; suggestions?:Suggestion[]; error?:string };

function d(value?:string|null){if(!value)return "—";return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(`${value}T12:00:00`));}
function pct(v?:number|null){return v==null?"—":`${Number(v).toLocaleString("fr-FR",{maximumFractionDigits:1})} %`;}
function readiness(value:Suggestion["readiness"]){return value==="ready"?"ACTIVABLE":value==="watch"?"À CONFIRMER":"À REVALIDER";}

export default function PolycompetenceSuggestions({month}:{month:string}){
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{let live=true;setError("");fetch(`/api/staff/suggestions?month=${encodeURIComponent(month)}`,{cache:"no-store"}).then(async r=>{const p=await r.json() as Payload;if(!r.ok||p.error)throw new Error(p.error||`HTTP ${r.status}`);if(live)setData(p);}).catch(e=>live&&setError(e instanceof Error?e.message:"Suggestions indisponibles."));return()=>{live=false};},[month]);
  if(error)return null;
  const rows=data?.suggestions??[];
  return <section className={styles.panel}>
    <div className={styles.head}><div><span>AIDE À LA PRODUCTION</span><h2>Propositions de polycompétence</h2><p>Le moteur ne propose que des compétences validées par les RH. Il croise le goulot du jour avec la dernière utilisation constatée dans le pointage ; aucune réaffectation n'est automatique.</p></div><div className={styles.source}><small>Goulots</small><strong>{d(data?.coverage?.bottleneckSnapshot)}</strong><small>Pointage vendu</small><strong>{d(data?.coverage?.billedThrough)}</strong></div></div>
    {rows.length?<div className={styles.grid}>{rows.slice(0,8).map(row=><article key={`${row.employeeKey}-${row.skillKey}`} className={row.readiness==="ready"?styles.ready:row.readiness==="watch"?styles.watch:styles.revalidate}>
      <div className={styles.cardTop}><span>{readiness(row.readiness)}</span><b>{row.targetSectorLabel} · {row.vehicleCount} véhicules</b></div>
      <h3>{row.fullName}</h3><p><strong>{row.skillLabel}</strong> · équipe {row.teamCode??"—"}</p>
      <dl><div><dt>Dernière utilisation</dt><dd>{d(row.lastUsedDate)}</dd></div><div><dt>Usage 90 j</dt><dd>{Number(row.hours90d??0).toLocaleString("fr-FR",{maximumFractionDigits:1})} h · {row.jobs90d??0} dossier(s)</dd></div><div><dt>Rendement métier principal</dt><dd>{pct(row.productivity)}</dd></div></dl>
      <small className={styles.note}>{row.readiness==="ready"?"Compétence récente : proposition exploitable sous validation managériale.":row.readiness==="watch"?"Compétence moins récente : confirmer avant activation.":"Dernière utilisation ancienne ou non tracée : revalidation nécessaire."}</small>
    </article>)}</div>:<div className={styles.empty}><strong>Aucune proposition active.</strong><span>Les RH doivent d'abord valider les polycompétences dans Data RH → Effectif & compétences. Les compétences simplement observées dans le pointage ne sont jamais proposées automatiquement à la production.</span></div>}
  </section>;
}
