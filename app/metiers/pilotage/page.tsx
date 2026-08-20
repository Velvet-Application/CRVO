import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../../lib/crvo-auth";
import ToolboxDomainPage, { type ToolboxDomainItem } from "../../toolbox-domain-page";

export default async function PilotageMetierPage(){
  const current=await currentSession();if(!current)redirect("/login");const{session}=current;
  const can=(key:string)=>hasPageAccess(session,key);
  const items:ToolboxDomainItem[]=[];
  if(can("reporting"))items.push({section:"Pilotage du jour",kicker:"TEMPS RÉEL",label:"Performance du jour",href:"/pilotage/performance?nav=today",description:"Suivre les volumes, la performance opérationnelle et l’état de la journée en cours.",footer:"Ouvrir le pilotage"});
  if(can("reporting"))items.push({section:"Pilotage du jour",kicker:"CAPACITÉ",label:"Présentéisme & capacité",href:"/dashboard/presenteisme",description:"Croiser effectifs présents, heures productives et capacité théorique de production.",footer:"Ouvrir la capacité"});
  if(can("book")){
    items.push({section:"BOOK",kicker:"HISTORIQUE",label:"Dashboard",href:"/pilotage/performance?nav=yesterday",description:"Consulter les journées clôturées et l’historique de production."});
    items.push({section:"BOOK",kicker:"ENCOURS",label:"Goulot",href:"/pilotage/performance?nav=bottlenecks",description:"Identifier les principaux goulots et les zones de concentration des encours."});
    items.push({section:"BOOK",kicker:"VIEILLISSEMENT",label:"Walking Dead",href:"/pilotage/performance?nav=walking",description:"Repérer les véhicules les plus anciens et les dossiers à débloquer."});
    items.push({section:"BOOK",kicker:"FINANCE",label:"Chiffre d’affaires",href:"/pilotage/performance?nav=finance",description:"Suivre le chiffre d’affaires et les indicateurs économiques associés."});
  }
  if(can("cockpit")){
    items.push({section:"Cockpit V2",kicker:"COCKPIT",label:"Pilotage du jour",href:"/cockpit-v2?section=pilotage",description:"Vue de pilotage opérationnel et signaux du jour."});
    items.push({section:"Cockpit V2",kicker:"MANAGER",label:"Synthèse manager",href:"/cockpit-v2?section=synthese",description:"Synthèse consolidée pour la prise de décision managériale."});
    items.push({section:"Cockpit V2",kicker:"DÉCISION",label:"Aide à la décision",href:"/cockpit-v2?section=decision",description:"Prioriser les actions à mener selon les écarts et risques détectés."});
    items.push({section:"Cockpit V2",kicker:"PRÉVISION",label:"Prévision fin de journée",href:"/cockpit-v2?section=prevision",description:"Projeter la fin de journée à partir des données opérationnelles."});
  }
  if(can("bodyshop"))items.push({section:"Cockpit V2",kicker:"CARROSSERIE",label:"Focus carrosserie",href:"/cockpit-v2/carrosserie",description:"Cockpit spécialisé carrosserie et Fixline."});
  if(can("intelligence"))items.push({section:"Cockpit V2",kicker:"ANALYSE",label:"Analyse",href:"/intelligence",description:"Analyses complémentaires et aide à la compréhension des tendances."});
  if(!items.length)redirect("/");
  return <ToolboxDomainPage eyebrow="UNIVERS MÉTIER · PILOTAGE" title="Pilotage" description="Le point d’entrée pour piloter la performance du CRVO : journée en cours, historique BOOK, capacité et Cockpit V2." code="PL" items={items} sessionLabel={session.display_name}/>;
}
