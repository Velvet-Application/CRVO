import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../../lib/crvo-auth";
import ToolboxDomainPage, { type ToolboxDomainItem } from "../../toolbox-domain-page";

export default async function RelationClientMetierPage(){
  const current=await currentSession();if(!current)redirect("/login");const{session}=current;
  if(!hasPageAccess(session,"client_dashboard"))redirect("/");
  const items:ToolboxDomainItem[]=[
    {section:"Dashboards clients",kicker:"RÉSEAU",label:"Réseau EFF & EFB",href:"/dashboard-client?scope=reseau",description:"Vue consolidée de la performance et des indicateurs destinés au réseau EFF & EFB.",footer:"Ouvrir le dashboard réseau"},
    {section:"Dashboards clients",kicker:"BMW / MINI",label:"BMW / MINI",href:"/dashboard-client?scope=bmw-mini",description:"Suivi dédié BMW / MINI avec les indicateurs et engagements du périmètre client.",footer:"Ouvrir le dashboard BMW / MINI"},
  ];
  return <ToolboxDomainPage eyebrow="UNIVERS MÉTIER · RELATION CLIENT" title="Relation Client" description="Une entrée claire vers les restitutions client du CRVO, avec des vues séparées selon les périmètres Réseau et BMW / MINI." code="RC" items={items} sessionLabel={session.display_name}/>;
}
