import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../../lib/crvo-auth";
import ToolboxDomainPage, { type ToolboxDomainItem } from "../../toolbox-domain-page";

export default async function RelationClientMetierPage(){
  const current=await currentSession();if(!current)redirect("/login");const{session}=current;
  const canDashboard=hasPageAccess(session,"client_dashboard");
  const canQuality=hasPageAccess(session,"quality_claims");
  if(!canDashboard&&!canQuality)redirect("/");
  const items:ToolboxDomainItem[]=[];
  if(canDashboard){
    items.push(
      {section:"Dashboards clients",kicker:"RÉSEAU",label:"Réseau EFF & EFB",href:"/dashboard-client?scope=reseau",description:"Vue consolidée de la performance et des indicateurs destinés au réseau EFF & EFB.",footer:"Ouvrir le dashboard réseau"},
      {section:"Dashboards clients",kicker:"BMW / MINI",label:"BMW / MINI",href:"/dashboard-client?scope=bmw-mini",description:"Suivi dédié BMW / MINI avec les indicateurs et engagements du périmètre client.",footer:"Ouvrir le dashboard BMW / MINI"},
    );
  }
  if(canQuality){
    items.push({section:"Qualité client",kicker:"AMÉLIORATION CONTINUE",label:"Réclamations Qualité",href:"/reclamations-qualite",description:"Piloter les retours réseau de bout en bout : analyse, pièces, comité, responsabilité, coûts, causes racines et actions correctives.",footer:"Ouvrir le cockpit Qualité"});
  }
  return <ToolboxDomainPage eyebrow="UNIVERS MÉTIER · RELATION CLIENT" title="Relation Client" description="Performance client, qualité réseau et amélioration continue réunies dans un même satellite métier." code="RC" items={items} sessionLabel={session.display_name}/>;
}
