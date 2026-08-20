import { redirect } from "next/navigation";
import { currentSession } from "../../lib/crvo-auth";
import ToolboxDomainPage, { type ToolboxDomainItem } from "../../toolbox-domain-page";

export default async function AdminMetierPage(){
  const current=await currentSession();if(!current)redirect("/login");const{session}=current;
  if(session.role!=="admin")redirect("/");
  const items:ToolboxDomainItem[]=[
    {section:"Paramètres & accès",kicker:"PARAMÈTRES",label:"Objectifs & seuils",href:"/pilotage/performance?nav=objectives",description:"Configurer les objectifs, seuils et paramètres utilisés dans les restitutions métier."},
    {section:"Paramètres & accès",kicker:"SOURCES",label:"Sources & connexion",href:"/sources",description:"Contrôler les sources de données, connexions et paramètres d’alimentation."},
    {section:"Paramètres & accès",kicker:"COMPTES",label:"Mon compte & accès",href:"/account",description:"Créer les utilisateurs, gérer les profils et administrer les droits d’accès."},
    {section:"Workflow",kicker:"WORKFLOW",label:"Accès Workflow",href:"/animation-mensuelle/acces",description:"Administrer les accès et responsabilités du workflow d’animation mensuelle."},
    {section:"Workflow",kicker:"PAYPLAN",label:"Payplan",href:"/animation-mensuelle/payplan",description:"Configurer et piloter les règles liées au Payplan."},
    {section:"Écrans opérationnels",kicker:"ATELIER",label:"Écran ATELIER",href:"/atelier",description:"Ouvrir l’écran opérationnel destiné à l’atelier."},
    {section:"Écrans opérationnels",kicker:"DIRECTION",label:"Écran DIRECTION",href:"/direction",description:"Ouvrir l’écran de synthèse destiné à la Direction."},
    {section:"Outils techniques",kicker:"CAPACITAIRE",label:"Simulateur capacitaire",href:"/capacitaire",description:"Tester des scénarios de capacité et leurs impacts sur la production."},
    {section:"Outils techniques",kicker:"DÉVELOPPEMENT",label:"Développement",href:"/developpement",description:"Accéder aux outils et fonctions techniques réservés à l’administration."},
  ];
  return <ToolboxDomainPage eyebrow="UNIVERS MÉTIER · ADMIN" title="Admin" description="Paramètres, accès, écrans opérationnels et outils techniques regroupés dans l’espace d’administration de ToolBox CRVO Lens." code="AD" items={items} sessionLabel={session.display_name}/>;
}
