import fs from "node:fs";

const files={
  sidebar:fs.readFileSync("app/pilotage-nav.tsx","utf8"),
  drawer:fs.readFileSync("app/global-nav-drawer.tsx","utf8"),
  proxy:fs.readFileSync("proxy.ts","utf8"),
  account:fs.readFileSync("app/account/page.tsx","utf8"),
  layout:fs.readFileSync("app/layout.tsx","utf8"),
  kioskBridge:fs.readFileSync("app/kiosk-fetch-bridge.tsx","utf8"),
  colors:fs.readFileSync("app/activity-colors.ts","utf8"),
  home:fs.readFileSync("app/home-dashboard.tsx","utf8"),
  objectivesApi:fs.readFileSync("app/api/objectives/route.ts","utf8"),
  dailyObjectivesMigration:fs.readFileSync("supabase/migrations/20260817092000_daily_exit_objectives_full_month_save.sql","utf8"),
};

const labels=[
  "Performance du jour",
  "BOOK",
  "Dashboard",
  "Goulot",
  "Walking Dead",
  "Chiffre d'affaire",
  "Animation du centre",
  "Productivité",
  "Variable",
  "Accès Workflow",
  "Payplan",
  "Cockpit V2",
  "Pilotage du jour",
  "Synthèse manager",
  "Aide à la décision",
  "Prévision fin de journée",
  "Focus carrosserie",
  "Simulateur capacitaire",
  "Analyse",
  "Dashboard client",
  "Réseau EFF & EFB",
  "BMW / MINI",
  "Paramètre",
  "Objectif & seuil",
  "Source & Connexion",
  "Accès",
  "Data RH",
  "Ecran ATELIER",
  "Ecran DIRECTION",
];

const failures=[];
for(const label of labels){
  if(!files.sidebar.includes(label)&&!files.drawer.includes(label))failures.push(`Libellé absent : ${label}`);
}
for(const path of ["/animation-mensuelle/payplan","/animation-mensuelle/acces","/capacitaire","/api/capacity-simulator","/atelier","/direction"]){
  if(!files.proxy.includes(path))failures.push(`Règle serveur absente : ${path}`);
}
if(!files.sidebar.includes('admin?link("/animation-mensuelle/acces"'))failures.push("Accès Workflow doit rester ADMIN dans le menu latéral.");
if(!files.sidebar.includes('admin?link("/animation-mensuelle/payplan"'))failures.push("Payplan doit rester ADMIN dans le menu latéral.");
if(!files.sidebar.includes('admin?createPortal(<div className="architecture-admin-screens"')||!files.sidebar.includes('topLink("/capacitaire","Simulateur capacitaire")'))failures.push("Simulateur capacitaire doit rester ADMIN sous les raccourcis Ecran dans le menu latéral.");
if(files.sidebar.includes('admin?link("/capacitaire","Simulateur capacitaire")'))failures.push("Simulateur capacitaire ne doit plus être rangé dans le groupe Cockpit V2 du menu latéral.");
if(!files.drawer.includes('admin&&<div className="gn-admin"')||!files.drawer.includes('link("/capacitaire","Simulateur capacitaire",true)'))failures.push("Simulateur capacitaire doit rester ADMIN sous les raccourcis Ecran dans le menu global.");
if(files.drawer.includes('}{admin&&link("/capacitaire","Simulateur capacitaire",true)}{allowed("intelligence")'))failures.push("Simulateur capacitaire ne doit plus être rangé dans le groupe Cockpit V2 du menu global.");
if(!files.drawer.includes('admin&&<div className="gn-admin"')||!files.drawer.includes('link("/atelier","Ecran ATELIER",true)'))failures.push("Ecran ATELIER doit rester ADMIN dans le menu global.");
if(!files.drawer.includes('admin&&<div className="gn-admin"')||!files.drawer.includes('link("/direction","Ecran DIRECTION",true)'))failures.push("Ecran DIRECTION doit rester ADMIN dans le menu global.");
if(!files.sidebar.includes('allowed("data_rh")?link("/data-rh","Data RH")'))failures.push("Data RH doit suivre la permission data_rh dans le menu latéral.");
if(!files.drawer.includes('allowed("data_rh")&&link("/data-rh","Data RH")'))failures.push("Data RH doit suivre la permission data_rh dans le menu global.");
if(!files.proxy.includes('return "data_rh"'))failures.push("La route Data RH doit être protégée par la permission data_rh.");
if(!files.account.includes('key:"settings"')||!files.account.includes('key:"data_rh"'))failures.push("Les permissions Paramètres métier et Data RH doivent être configurables dans Accès.");

if(!files.proxy.includes('isPublicKioskPath(path)'))failures.push("Les écrans kiosk doivent contourner l'identification uniquement via la règle kiosk dédiée.");
for(const path of ["/api/kiosk/atelier","/api/kiosk/direction"]){if(!files.proxy.includes(path))failures.push(`Passerelle kiosk absente : ${path}`);}
if(!files.layout.includes("KioskFetchBridge")||!files.kioskBridge.includes('/api/kiosk/atelier')||!files.kioskBridge.includes('/api/kiosk/direction'))failures.push("Les écrans atelier/direction doivent lire uniquement les passerelles kiosk lorsqu'ils sont ouverts sans session.");
if(!files.layout.includes("ActivityColorBinder"))failures.push("La règle couleur par activité doit être montée globalement.");
for(const [label,hex] of [["Expertise","#eb5b56"],["Mécanique","#55b779"],["Jantes","#f5a623"],["Carrosserie","#009edb"],["DSP","#004f9f"],["Préparation","#8d5ec7"],["Qualité / Photo","#c66a1b"],["Sortie usine","#7b8794"]]){
  if(!files.colors.includes(hex))failures.push(`Couleur activité absente : ${label} ${hex}`);
}

if(!files.home.includes("function dailyExitTarget("))failures.push("Performance du jour doit disposer d'une résolution de l'objectif Sortie usine par date exacte.");
if(!files.home.includes('detail={sortieTarget!=null?`objectif journalier'))failures.push("La carte Sorties VOP doit afficher l'objectif journalier de la date.");
if(files.home.includes('detail={targetFor("Sortie usine",objectives)!=null?`objectif'))failures.push("La carte Sorties VOP ne doit plus utiliser l'objectif mensuel standard comme objectif du jour.");
if(!files.home.includes("OBJECTIF SORTIE USINE · JOUR PAR JOUR"))failures.push("Le paramétrage doit exposer le planning Sortie usine jour par jour.");
if(!files.home.includes("sortieDailyTargets:dailyTargetsDraft"))failures.push("La sauvegarde objectifs doit persister le planning quotidien réellement saisi.");
if(!files.objectivesApi.includes("legacyDailyTargetsRecovered"))failures.push("L'API objectifs doit récupérer l'ancien planning navigateur lorsqu'il existe encore.");
if(!files.objectivesApi.includes("legacyCookie(request, key)"))failures.push("L'API objectifs doit lire l'ancien cookie de planning uniquement pour récupération.");
if(!files.dailyObjectivesMigration.includes("delete from public.kpi_daily_exit_objectives"))failures.push("La sauvegarde du planning quotidien doit remplacer proprement le mois complet pour permettre d'effacer une date.");

if(failures.length){
  console.error("Contrat de navigation CRVO invalide :\n- "+failures.join("\n- "));
  process.exit(1);
}
console.log(`Navigation CRVO validée : ${labels.length} libellés, droits, simulateur séparé sous les écrans, objectifs journaliers Sortie usine, kiosks sans session et palette activités contrôlés.`);
