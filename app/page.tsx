import Image from "next/image";
import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "./lib/crvo-auth";
import styles from "./toolbox-home.module.css";

type Domain={key:"pilotage"|"client"|"rh"|"admin"|"transphere";label:string;short:string;href:string;description:string;visible:boolean};

export default async function Page(){
  const current=await currentSession();
  if(!current)redirect("/login");
  const{session}=current;
  const any=(keys:string[])=>session.role==="admin"||keys.some(key=>hasPageAccess(session,key));
  const domains:Domain[]=[
    {key:"pilotage",label:"Pilotage",short:"PL",href:"/metiers/pilotage",description:"Performance du jour, BOOK, goulots, chiffre d’affaires et Cockpit V2.",visible:any(["reporting","book","cockpit","bodyshop","intelligence"])},
    {key:"client",label:"Relation Client",short:"RC",href:"/metiers/relation-client",description:"Dashboards clients Réseau EFF & EFB et BMW / MINI.",visible:any(["client_dashboard"])},
    {key:"rh",label:"RH",short:"RH",href:"/metiers/rh",description:"Temps de travail, formation, compétences, productivité et animation du centre.",visible:any(["worktime","training","data_rh","productivity","monthly_animation"])},
    {key:"admin",label:"Admin",short:"AD",href:"/metiers/admin",description:"Paramètres, accès, écrans atelier/direction, capacitaire et développement.",visible:session.role==="admin"},
    {key:"transphere",label:"Transphère",short:"TR",href:"/transphere",description:"Accès à l’environnement et aux outils opérationnels Transphère.",visible:any(["transphere"])},
  ];
  const visible=domains.filter(domain=>domain.visible);
  return <main className={`${styles.page} toolboxHub`}>
    <header className={styles.topbar}>
      <div className={styles.brand}><span>CRVO · LENS</span><strong>ToolBox CRVO Lens</strong></div>
      <div className={styles.session}><span>ESPACE SÉCURISÉ</span><strong>{session.display_name}</strong><small>{session.role==="admin"?"Administrateur":session.access_profile==="service_manager"?"Chef de service":session.access_profile==="hr"?"RH":session.access_profile==="trainer"?"Formateur":session.access_profile==="team_manager"?"Manager / Chef d’équipe":session.access_profile==="transphere_manager"?"Responsable Transphère":"Utilisateur autorisé"}</small></div>
    </header>
    <section className={styles.workspace} aria-label="Univers métiers ToolBox CRVO Lens">
      <div className={styles.center}>
        <Image src="/crvo-logo.png" alt="CRVO" width={260} height={80} priority unoptimized/>
        <span className={styles.centerText}>ToolBox CRVO Lens</span>
      </div>
      {visible.map(domain=><a key={domain.key} href={domain.href} className={styles.satellite} data-domain={domain.key}>
        <div className={styles.satelliteHead}><span className={styles.icon}>{domain.short}</span><h2>{domain.label}</h2></div>
        <p>{domain.description}</p>
        <footer><span>OUVRIR L’UNIVERS</span><i>›</i></footer>
      </a>)}
      {!visible.length&&<div className={styles.empty}>Aucun univers métier n’est encore autorisé pour ce compte. Contacte un administrateur pour ajuster les droits.</div>}
    </section>
    <footer className={styles.footer}><span><strong>ToolBox CRVO Lens</strong> · Plateforme métiers du centre</span><a href="/account">Mon compte & accès</a></footer>
  </main>;
}
