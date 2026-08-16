import fs from "node:fs";

const files={
  sidebar:fs.readFileSync("app/pilotage-nav.tsx","utf8"),
  drawer:fs.readFileSync("app/global-nav-drawer.tsx","utf8"),
  proxy:fs.readFileSync("proxy.ts","utf8"),
  account:fs.readFileSync("app/account/page.tsx","utf8"),
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
  if(!files.proxy.includes(path))failures.push(`Protection serveur absente : ${path}`);
}
if(!files.sidebar.includes('admin?link("/animation-mensuelle/acces"'))failures.push("Accès Workflow doit rester ADMIN dans le menu latéral.");
if(!files.sidebar.includes('admin?link("/animation-mensuelle/payplan"'))failures.push("Payplan doit rester ADMIN dans le menu latéral.");
if(!files.sidebar.includes('admin?link("/capacitaire","Simulateur capacitaire")'))failures.push("Simulateur capacitaire doit rester ADMIN dans le menu latéral.");
if(!files.drawer.includes('admin&&link("/capacitaire","Simulateur capacitaire",true)'))failures.push("Simulateur capacitaire doit rester ADMIN dans le menu global.");
if(!files.drawer.includes('admin&&<div className="gn-admin"')||!files.drawer.includes('link("/atelier","Ecran ATELIER",true)'))failures.push("Ecran ATELIER doit rester ADMIN dans le menu global.");
if(!files.drawer.includes('admin&&<div className="gn-admin"')||!files.drawer.includes('link("/direction","Ecran DIRECTION",true)'))failures.push("Ecran DIRECTION doit rester ADMIN dans le menu global.");
if(!files.sidebar.includes('allowed("data_rh")?link("/data-rh","Data RH")'))failures.push("Data RH doit suivre la permission data_rh dans le menu latéral.");
if(!files.drawer.includes('allowed("data_rh")&&link("/data-rh","Data RH")'))failures.push("Data RH doit suivre la permission data_rh dans le menu global.");
if(!files.proxy.includes('return "data_rh"'))failures.push("La route Data RH doit être protégée par la permission data_rh.");
if(!files.account.includes('key:"settings"')||!files.account.includes('key:"data_rh"'))failures.push("Les permissions Paramètres métier et Data RH doivent être configurables dans Accès.");

if(failures.length){
  console.error("Contrat de navigation CRVO invalide :\n- "+failures.join("\n- "));
  process.exit(1);
}
console.log(`Navigation CRVO validée : ${labels.length} libellés, droits RH/paramètres, protections ADMIN et simulateur capacitaire contrôlés.`);
