import { redirect } from "next/navigation";
import { authRpc, currentSession, hasPageAccess } from "../lib/crvo-auth";
import styles from "./annualisation.module.css";

type CheckItem={key:string;label:string;category:string;required:boolean;status:"pending"|"in_progress"|"passed"|"waived"|"failed";evidence?:string|null;checkedBy?:string|null;checkedAt?:string|null};
type RulesetItem={version:string;title:string;status:"draft"|"validated"|"retired";validFrom:string;validTo:string;requiresLegalValidation:boolean;validationComment?:string|null};
type Readiness={entity:string;mode:string;officialGoLiveDate:string;officialEngineEnabled:boolean;rulesets:number;rulesetItems:RulesetItem[];validatedRulesets2027:number;employeeContracts:number;employeeAccountLinks:number;ledgerEntries:number;openComplianceAlerts:number;goLiveChecks:{total:number;passedOrWaived:number;failed:number;items:CheckItem[]};blockers:string[];safeToGoLive:boolean};

const categoryLabel:Record<string,string>={legal:"Juridique",data:"Données",security:"Sécurité",validation:"Validation",process:"Processus",transparency:"Transparence",integration:"Intégration",go_live:"Go-live"};
const statusLabel:Record<CheckItem["status"],string>={pending:"À préparer",in_progress:"En cours",passed:"Validé",waived:"Dérogation tracée",failed:"Échec"};

export default async function AnnualisationPreparationPage(){
  const current=await currentSession();
  if(!current)redirect("/login");
  const{session,tokenHash}=current;
  const allowed=hasPageAccess(session,"worktime")&&(session.role==="admin"||["hr","service_manager","team_manager"].includes(session.access_profile));
  if(!allowed)redirect("/metiers/rh");
  const readiness=await authRpc<Readiness>("kpi_annualization_v2_readiness",{p_session_hash:tokenHash,p_entity:"CRVO"});
  const progress=readiness.goLiveChecks.total?Math.round(readiness.goLiveChecks.passedOrWaived/readiness.goLiveChecks.total*100):0;
  const ruleset=readiness.rulesetItems?.[0];
  const target=new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"long",year:"numeric",timeZone:"Europe/Paris"}).format(new Date(`${readiness.officialGoLiveDate}T12:00:00+01:00`));
  return <main className={styles.page}>
    <section className={styles.hero}>
      <div><span className={styles.eyebrow}>RH · ANNUALISATION DU CENTRE</span><h1>Préparation 2027</h1><p>Construction du moteur officiel de suivi annualisé, avec transparence collaborateur, conformité, clôture et traçabilité complète.</p></div>
      <div className={styles.target}><small>MISE EN SERVICE CIBLE</small><strong>{target}</strong><span className={readiness.officialEngineEnabled?styles.live:styles.safe}>{readiness.officialEngineEnabled?"MOTEUR OFFICIEL ACTIF":"MOTEUR OFFICIEL VERROUILLÉ"}</span></div>
    </section>

    <section className={styles.kpis} aria-label="État de préparation">
      <article><small>MODE</small><strong>{readiness.mode.toUpperCase()}</strong><span>Sans impact sur le compteur officiel actuel</span></article>
      <article><small>GARDES-FOUS</small><strong>{readiness.goLiveChecks.passedOrWaived} / {readiness.goLiveChecks.total}</strong><span>{progress}% du dossier de bascule validé</span></article>
      <article><small>RÉFÉRENTIEL 2027</small><strong>{readiness.validatedRulesets2027?"VALIDÉ":"DRAFT"}</strong><span>{ruleset?.version??"Aucun référentiel"}</span></article>
      <article><small>POPULATION 2027</small><strong>{readiness.employeeContracts}</strong><span>contrats annualisés préparés</span></article>
      <article><small>ACCÈS SALARIÉS</small><strong>{readiness.employeeAccountLinks}</strong><span>comptes rattachés à un collaborateur</span></article>
      <article><small>LEDGER V2</small><strong>{readiness.ledgerEntries}</strong><span>écritures de calcul actuellement générées</span></article>
    </section>

    <section className={styles.grid}>
      <article className={styles.panel}>
        <header><div><span>GATE 01/01/2027</span><h2>Checklist de mise en service</h2></div><b>{progress}%</b></header>
        <div className={styles.progress}><i style={{width:`${progress}%`}}/></div>
        <div className={styles.checks}>{readiness.goLiveChecks.items.map(item=><div className={styles.check} key={item.key} data-status={item.status}>
          <i aria-hidden="true">{item.status==="passed"||item.status==="waived"?"✓":item.status==="failed"?"!":"•"}</i>
          <div><strong>{item.label}</strong><span>{categoryLabel[item.category]??item.category}{item.checkedBy?` · ${item.checkedBy}`:""}</span>{item.evidence&&<small>{item.evidence}</small>}</div>
          <em>{statusLabel[item.status]}</em>
        </div>)}</div>
      </article>

      <aside className={styles.side}>
        <article className={styles.panel}>
          <header><div><span>BLOQUEURS ACTUELS</span><h2>Ce qui interdit encore la bascule</h2></div></header>
          <div className={styles.blockers}>{readiness.blockers.length?readiness.blockers.map(item=><p key={item}>{item}</p>):<p className={styles.ok}>Aucun bloqueur détecté.</p>}</div>
        </article>
        <article className={styles.panel}>
          <header><div><span>RÈGLES APPLICABLES</span><h2>{ruleset?.title??"Référentiel à créer"}</h2></div></header>
          {ruleset?<div className={styles.rules}><p><strong>Version</strong><span>{ruleset.version}</span></p><p><strong>Période</strong><span>{ruleset.validFrom} → {ruleset.validTo}</span></p><p><strong>Statut</strong><span>{ruleset.status.toUpperCase()}</span></p><p><strong>Validation juridique</strong><span>{ruleset.requiresLegalValidation?"Obligatoire":"Validée"}</span></p>{ruleset.validationComment&&<small>{ruleset.validationComment}</small>}</div>:null}
        </article>
      </aside>
    </section>

    <section className={styles.foundation}>
      <header><span>ARCHITECTURE CIBLE</span><h2>Une annualisation explicable, pas un simple compteur ±</h2><p>Chaque mouvement doit avoir une origine, une règle, un état de validation et une explication accessible au collaborateur concerné.</p></header>
      <div>
        <article><b>01</b><strong>Temps & Data RH</strong><span>Présences, horaires, CP, absences, formation et événements RH.</span></article>
        <article><b>02</b><strong>Ledger journalier</strong><span>Théorique, réalisé, neutralisé et delta imputable séparés.</span></article>
        <article><b>03</b><strong>Heures spéciales</strong><span>Nuit, majorations, HS, contingent et repos dans des registres distincts.</span></article>
        <article><b>04</b><strong>Contrôle & projection</strong><span>Alertes légales et prévision au 31 décembre avant qu'une situation ne dérive.</span></article>
        <article><b>05</b><strong>Transparence salarié</strong><span>Relevé mensuel, détail de chaque mouvement et contestation traçable.</span></article>
        <article><b>06</b><strong>Clôture auditée</strong><span>Snapshots mensuels/annuels et régularisations sans réécriture silencieuse.</span></article>
      </div>
    </section>
  </main>;
}
