import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../../lib/crvo-auth";
import ToolboxDomainPage, { type ToolboxDomainItem } from "../../toolbox-domain-page";

export default async function RhMetierPage(){
  const current=await currentSession();if(!current)redirect("/login");const{session}=current;
  const can=(key:string)=>hasPageAccess(session,key);
  const items:ToolboxDomainItem[]=[];
  if(can("worktime")){
    items.push({section:"Temps de travail",kicker:"PRÉSENCE",label:"Suivi du temps de travail",href:"/temps-travail",description:"Déclarations terrain, absences, retards, départs et validation quotidienne des équipes."});
    items.push({section:"Temps de travail",kicker:"CONGÉS",label:"Souhaits de CP",href:"/temps-travail/conges",description:"Planifier les souhaits de congés, visualiser la capacité et instruire les validations."});
  }
  if(can("training"))items.push({section:"Développement des compétences",kicker:"FORMATION",label:"Formation & compétences",href:"/formation",description:"Identifier les besoins, planifier les formations et mesurer la progression avant / après."});
  if(can("data_rh"))items.push({section:"Animation du centre",kicker:"RH",label:"RH & Polycompétences",href:"/animation-centre/rh",description:"Suivre les données RH, les compétences et les éléments utiles à l’animation du centre."});
  if(can("productivity"))items.push({section:"Animation du centre",kicker:"PRODUCTIVITÉ",label:"Productivité",href:"/performance/productivite",description:"Analyser la productivité par secteur, équipe et collaborateur."});
  if(can("monthly_animation"))items.push({section:"Animation du centre",kicker:"VARIABLE",label:"Animation mensuelle",href:"/animation-mensuelle",description:"Piloter les variables, validations et historiques associés au dispositif mensuel."});
  if(can("reporting"))items.push({section:"Animation du centre",kicker:"EXPORT",label:"Export",href:"/animation-centre/export",description:"Produire les exports utiles à l’animation et aux restitutions du centre."});
  if(can("data_rh"))items.push({section:"Administration RH",kicker:"DATA RH",label:"Data RH",href:"/data-rh",description:"Gérer les imports et sources RH nécessaires aux modules de temps, compétences et animation."});
  if(!items.length)redirect("/");
  return <ToolboxDomainPage eyebrow="UNIVERS MÉTIER · RH" title="RH" description="Présence, congés, formation, compétences et animation du centre réunis dans un même univers métier." code="RH" items={items} sessionLabel={session.display_name}/>;
}
