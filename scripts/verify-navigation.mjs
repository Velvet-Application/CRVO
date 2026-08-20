import fs from "node:fs";

const read=(path)=>fs.readFileSync(path,"utf8");
const files={
  home:read("app/page.tsx"),
  domain:read("app/toolbox-domain-page.tsx"),
  pilotageDomain:read("app/metiers/pilotage/page.tsx"),
  clientDomain:read("app/metiers/relation-client/page.tsx"),
  rhDomain:read("app/metiers/rh/page.tsx"),
  adminDomain:read("app/metiers/admin/page.tsx"),
  drawer:read("app/global-nav-drawer-v2.tsx"),
  pilotageMenu:read("app/home-side-menu-v2.tsx"),
  proxy:read("proxy.ts"),
  account:read("app/account/page.tsx"),
  layout:read("app/layout.tsx"),
  manifest:read("public/manifest.webmanifest"),
  kioskBridge:read("app/kiosk-fetch-bridge.tsx"),
  kioskAtelier:read("app/api/kiosk/atelier/route.ts"),
  kioskDirection:read("app/api/kiosk/direction/route.ts"),
  atelier:read("app/atelier/page.tsx"),
  colors:read("app/activity-colors.ts"),
  reporting:read("app/home-dashboard.tsx"),
  objectivesApi:read("app/api/objectives/route.ts"),
  healthApi:read("app/api/health/route.ts"),
  dataTrust:read("app/data-trust-guard.tsx"),
  dailyObjectivesMigration:read("supabase/migrations/20260817092000_daily_exit_objectives_full_month_save.sql"),
  verifiedMetricsMigration:read("supabase/migrations/20260817095500_verified_daily_metrics_and_friday_exit_correction.sql"),
  capacity:read("app/capacitaire/capacity-simulator.tsx"),
  capacityPpt:read("app/capacitaire/pptx-export.ts"),
  capacityApi:read("app/api/capacity-simple/route.ts"),
  productivity:read("app/performance/productivite/page.tsx"),
  capacityMigration:read("supabase/migrations/20260817073500_productive_only_and_simple_capacity.sql"),
  capacityBillingMigration:read("supabase/migrations/20260817151500_capacity_volume_from_billed_average.sql"),
  rhClient:read("app/data-rh/effectif/effectif-client.tsx"),
  rhApi:read("app/api/staff/operational/route.ts"),
  rhPage:read("app/animation-centre/rh/page.tsx"),
  rhMigration:read("supabase/migrations/20260817163000_rh_operational_animation_centre.sql"),
};

const failures=[];
const requireText=(content,text,message)=>{if(!content.includes(text))failures.push(message);};

// ToolBox CRVO Lens : la racine est désormais un hub métiers et non un dashboard monolithique.
for(const text of ["ToolBox CRVO Lens","Pilotage","Relation Client","RH","Admin","Transphère"]){
  if(!files.home.includes(text))failures.push(`Hub ToolBox incomplet : ${text}`);
}
for(const path of ["/metiers/pilotage","/metiers/relation-client","/metiers/rh","/metiers/admin","/transphere"]){
  if(!files.home.includes(path))failures.push(`Satellite ToolBox absent : ${path}`);
}
requireText(files.home,"LEGACY_VIEWS","Les anciens liens ?nav= doivent rester redirigés vers le reporting Pilotage.");
requireText(files.layout,'title: "ToolBox CRVO Lens"',"Le metadata produit doit être renommé ToolBox CRVO Lens.");
requireText(files.manifest,'"name": "ToolBox CRVO Lens"',"Le manifeste PWA doit être renommé ToolBox CRVO Lens.");

// Menu global : même structure métier que le hub.
for(const label of ["Accueil ToolBox","Pilotage","Relation Client","RH","Admin","Transphère","Notifications"]){
  if(!files.drawer.includes(label))failures.push(`Menu ToolBox absent : ${label}`);
}
for(const label of ["Performance du jour","Présentéisme & capacité","BOOK · Dashboard","BOOK · Goulot","BOOK · Walking Dead","BOOK · Chiffre d'affaire","Cockpit V2 · Pilotage du jour","Réseau EFF & EFB","BMW / MINI","Formation & compétences","Souhaits de CP","Simulateur capacitaire","Écran ATELIER","Écran DIRECTION"]){
  if(!files.drawer.includes(label)&&!files.pilotageDomain.includes(label)&&!files.rhDomain.includes(label)&&!files.adminDomain.includes(label))failures.push(`Accès métier absent : ${label}`);
}
requireText(files.pilotageMenu,"/pilotage/performance","Le menu latéral Pilotage doit pointer vers le nouveau workspace reporting.");

// Contrats d'accès : le hub filtre l'affichage, le proxy reste l'autorité serveur.
for(const path of ["/metiers/admin","/animation-mensuelle/payplan","/animation-mensuelle/acces","/capacitaire","/developpement","/direction","/api/kiosk/direction"]){
  if(!files.proxy.includes(path))failures.push(`Protection ADMIN absente : ${path}`);
}
if(!files.proxy.includes('return"data_rh"')&&!files.proxy.includes('return "data_rh"'))failures.push("La route Data RH doit rester protégée par la permission data_rh.");
requireText(files.proxy,'return"training"',"La route Formation doit rester protégée par la permission training.");
requireText(files.proxy,'session.access_profile==="trainer"',"Le profil Formateur doit rester limité à son univers autorisé.");
requireText(files.proxy,'session.access_profile==="team_manager"',"Le profil Chef d'équipe doit conserver son périmètre restreint.");
requireText(files.proxy,'session.access_profile==="transphere"',"Le profil Transphère doit conserver son périmètre restreint.");

// Architecture kiosk actuelle : Atelier est volontairement un écran opérationnel public ; Direction reste sécurisée ADMIN.
requireText(files.proxy,'const publicAtelier=path==="/atelier"||path.startsWith("/api/kiosk/atelier")',"L'écran ATELIER doit conserver son accès kiosk opérationnel dédié.");
if(!files.kioskDirection.includes("currentSession")||!files.kioskDirection.includes('session.role!=="admin"')||!files.kioskDirection.includes("Accès administrateur requis"))failures.push("La passerelle DIRECTION doit vérifier explicitement la session ADMIN.");
if(!files.layout.includes("KioskFetchBridge")||!files.kioskBridge.includes('/api/kiosk/atelier')||!files.kioskBridge.includes('/api/kiosk/direction'))failures.push("Les écrans atelier/direction doivent continuer à utiliser les passerelles kiosk dédiées.");

// Confiance, couleurs et métriques vérifiées.
if(!files.healthApi.includes("financeReady")||!files.healthApi.includes("objectiveReady")||!files.healthApi.includes("trustLevel"))failures.push("Le healthcheck industriel doit certifier finance, objectif et niveau de confiance.");
if(files.healthApi.includes("financeHealth,"))failures.push("Le healthcheck public ne doit pas exposer les montants financiers détaillés.");
if(!files.dataTrust.includes("DONNÉES NON CERTIFIÉES")||!files.dataTrust.includes("CONFIANCE DONNÉES · À SURVEILLER"))failures.push("Le fail-closed global doit rendre visibles les états AMBER et RED.");
for(const [label,hex] of [["Expertise","#eb5b56"],["Mécanique","#55b779"],["Jantes","#f5a623"],["Carrosserie","#009edb"],["DSP","#004f9f"],["Préparation","#8d5ec7"],["Qualité / Photo","#c66a1b"],["Sortie usine","#7b8794"]]){if(!files.colors.includes(hex))failures.push(`Couleur activité absente : ${label} ${hex}`);}
if(!files.atelier.includes("AUJOURD’HUI · EN COURS")||!files.atelier.includes("DERNIÈRE JOURNÉE CLÔTURÉE")||!files.atelier.includes("closedSnapshot"))failures.push("Ecran ATELIER doit réunir le live et la dernière journée clôturée.");
if(!files.atelier.includes("FTP EN RETARD")||!files.atelier.includes("staleMinutes"))failures.push("Ecran ATELIER doit signaler une donnée FTP trop ancienne.");
if(!files.kioskAtelier.includes("verified-metrics")||!files.atelier.includes("verified-metrics"))failures.push("Ecran ATELIER doit appliquer les métriques de clôture vérifiées.");
if(!files.verifiedMetricsMigration.includes("kpi_daily_verified_metrics")||!files.verifiedMetricsMigration.includes("date '2026-08-14'")||!files.verifiedMetricsMigration.includes("'exits_vop',83")||!files.verifiedMetricsMigration.includes("'production_factory_exit',83"))failures.push("La clôture vérifiée du vendredi 14/08 doit conserver 83 sorties usine.");

// Reporting et objectifs journaliers.
if(!files.reporting.includes("function dailyExitTarget("))failures.push("Performance du jour doit disposer d'une résolution de l'objectif Sortie usine par date exacte.");
if(!files.reporting.includes('detail={sortieTarget!=null?`objectif journalier'))failures.push("La carte Sorties VOP doit afficher l'objectif journalier de la date.");
if(!files.reporting.includes("OBJECTIF SORTIE USINE · JOUR PAR JOUR"))failures.push("Le paramétrage doit exposer le planning Sortie usine jour par jour.");
if(!files.reporting.includes("sortieDailyTargets:dailyTargetsDraft"))failures.push("La sauvegarde objectifs doit persister le planning quotidien réellement saisi.");
if(!files.objectivesApi.includes("legacyDailyTargetsRecovered")||!files.objectivesApi.includes("legacyCookie(request, key)"))failures.push("L'API objectifs doit conserver la récupération de l'ancien planning navigateur.");
if(!files.dailyObjectivesMigration.includes("delete from public.kpi_daily_exit_objectives"))failures.push("La sauvegarde du planning quotidien doit pouvoir remplacer proprement le mois complet.");

// Simulateur capacitaire : contrôles fonctionnels, pas de dépendance à un libellé obsolète.
if(!files.capacity.includes("MINI ADDITIONNELLES")||!(files.capacity.includes("PRODUCTIVITÉ À GAGNER")||files.capacity.includes("EFFORT PROD. MAX"))||!(files.capacity.includes("ETP À AJOUTER")||files.capacity.includes("RENFORT ETP MAX")))failures.push("Le simulateur doit répondre en volume MINI, productivité et ETP.");
for(const jargon of ["P90","Run-rate","S0 · Sans action","S1 · Performance","S2 · Ressources","S3 · Cible"]){if(files.capacity.includes(jargon))failures.push(`Jargon capacitaire interdit : ${jargon}`);}
if(!files.capacity.includes('fetch("/api/capacity-simple"'))failures.push("Le simulateur doit utiliser l'API capacitaire légère dédiée.");
if(!files.capacity.includes("HIDDEN_MINI_SECTORS")||!files.capacity.includes('"jantes"')||!files.capacity.includes('"photo"')||!files.capacity.includes(".filter(visibleMiniSector)"))failures.push("Le simulateur MINI doit occulter Jantes et Photo du calcul visible.");
if(!files.capacity.includes("selectedSoldPeriod/billingAvgHours")||!files.capacity.includes("Autres métiers = heures vendues ÷ temps moyen facturé sur la même période et la même population."))failures.push("Le volume capacitaire doit rester dérivé des heures vendues et du temps facturé moyen sur le même périmètre.");
if(!files.capacity.includes("Matrice de sensibilité Box × Fixline")||!files.capacity.includes("BODYSHOP_REFERENCE")||!files.capacity.includes("targetRow"))failures.push("Le simulateur doit conserver la matrice de sensibilité Carrosserie Box × Fixline.");
if(!files.capacity.includes("Exporter PPT")||!files.capacity.includes("exportCapacityPptx")||!files.capacityPpt.includes("MATRICE CARROSSERIE · BOX × FIXLINE")||!files.capacityPpt.includes("PLAN D'ACTION"))failures.push("Le simulateur doit exporter un PowerPoint CRVO avec matrice et plan d'action.");
if(!files.capacity.includes("mostLoaded")||!files.capacity.includes("miniHours-a.miniHours"))failures.push("Le métier le plus chargé doit être basé sur la charge MINI absolue.");
if(!files.capacityApi.includes("kpi_capacity_simple")||!files.capacityApi.includes("57014")||!files.capacityApi.includes("kpi_capacity_billing_ratios"))failures.push("L'API capacitaire doit utiliser les RPC légers, les ratios de facturation et gérer les timeouts.");
if(!files.capacityBillingMigration.includes("avg_hours_per_vehicle")||!files.capacityBillingMigration.includes("work_order")||!files.capacityBillingMigration.includes("source_file_sha256=v_batch.file_sha256"))failures.push("La moyenne facturée doit rester calculée sur les OR du même fichier source.");
if(!files.productivity.includes("MÉTIERS PRODUCTIFS UNIQUEMENT")||!files.productivity.includes("MÊME POPULATION")||!files.productivity.includes("vendues exclues"))failures.push("La page Productivité doit conserver son périmètre comparable.");
for(const key of ["expertise","mecanique","dsp","jantes","carrosserie","preparation","qualite","photo"]){if(!files.capacityMigration.includes(`'${key}'`))failures.push(`Métier productif absent de la migration : ${key}`);}
if(!files.capacityMigration.includes("kpi_is_productive_sector")||!files.capacityMigration.includes("kpi_capacity_simple"))failures.push("La migration doit verrouiller le filtre productif et le calcul capacitaire léger.");

// RH opérationnel et formation restent pilotés par permissions.
if(!files.account.includes('key:"training"')||!files.account.includes('key:"data_rh"'))failures.push("Les permissions Formation et Data RH doivent être configurables dans Accès.");
if(!files.rhPage.includes('context="animation"'))failures.push("La route Animation du centre RH doit réutiliser la vue RH opérationnelle.");
if(!files.rhClient.includes("Neutraliser dans les calculs KPI")||!files.rhClient.includes("/api/staff/operational")||!files.rhClient.includes("Performance sur cette compétence")||!files.rhClient.includes("Ajouter une polycompétence"))failures.push("Le module RH doit gérer neutralisation, affectation, performance et polycompétence.");
if(!files.rhApi.includes("kpi_rh_update_staff_operational")||!files.rhApi.includes("Droit Data RH requis"))failures.push("L'API RH opérationnelle doit utiliser le RPC sécurisé Data RH.");
if(!files.rhMigration.includes("kpi_staff_operational_overrides")||!files.rhMigration.includes("kpi_staff_operational_events")||!files.rhMigration.includes("kpi_staff_effective")||!files.rhMigration.includes("kpi_staff_alias_neutralized")||!files.rhMigration.includes("productivity90d"))failures.push("La migration RH doit conserver overrides, audit, neutralisation et performance.");

if(failures.length){console.error("Contrat ToolBox CRVO Lens invalide :\n- "+failures.join("\n- "));process.exit(1);}
console.log("Contrat ToolBox CRVO Lens validé : hub métiers, navigation, droits, kiosks, données certifiées, RH et capacitaire cohérents.");
