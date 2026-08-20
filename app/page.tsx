import Image from "next/image";
import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "./lib/crvo-auth";
import ToolboxLiveWidgets from "./toolbox-live-widgets";
import ToolboxMobileNav from "./toolbox-mobile-nav";
import "./toolbox-live-home.css";
import "./toolbox-mobile-home.css";
import "./toolbox-mobile-launcher.css";
import styles from "./toolbox-home.module.css";

type DomainKey="pilotage"|"client"|"rh"|"admin"|"transphere";
type Domain={key:DomainKey;label:string;short:string;href:string;description:string;visible:boolean};
type PageProps={searchParams:Promise<Record<string,string|string[]|undefined>>};
const LEGACY_VIEWS=new Set(["today","yesterday","bottlenecks","walking","finance","objectives","sources"]);

function DomainGlyph({domain}:{domain:DomainKey}){
  if(domain==="pilotage")return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 30a16 16 0 1 1 32 0"/><path d="M24 14v4M12.7 19.3l3 3M35.3 19.3l-3 3M9 30h4M35 30h4"/><path d="M24 30l9-8"/><circle cx="24" cy="30" r="2.8"/></svg>;
  if(domain==="client")return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="18" r="6"/><circle cx="32.5" cy="20" r="4.5"/><path d="M7 37c0-7 4.8-11 11-11s11 4 11 11M27 29c1.5-2 3.5-3 6-3 5 0 8 3.5 8 9"/></svg>;
  if(domain==="rh")return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="16" cy="19" r="5"/><circle cx="32" cy="19" r="5"/><path d="M6 36c0-6 4.5-10 10-10s10 4 10 10M22 36c0-6 4.5-10 10-10s10 4 10 10"/><path d="M24 8v6M21 11h6"/></svg>;
  if(domain==="admin")return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6c5 4 10 5.5 15 6v10c0 10-5.5 16.5-15 21-9.5-4.5-15-11-15-21V12c5-.5 10-2 15-6Z"/><path d="M18 24l4 4 8-9"/></svg>;
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 40V22l10 5v-8l10 5v-9l14 8v17Z"/><path d="M7 22V10h7v14M13 40v-7h6v7M25 32h4M34 32h4M25 37h4M34 37h4"/></svg>;
}

export default async function Page({searchParams}:PageProps){
  const params=await searchParams;
  const rawNav=params.nav;
  const legacyNav=Array.isArray(rawNav)?rawNav[0]:rawNav;
  if(legacyNav&&LEGACY_VIEWS.has(legacyNav))redirect(`/pilotage/performance?nav=${encodeURIComponent(legacyNav)}`);
  const current=await currentSession();
  if(!current)redirect("/login");
  const{session}=current;
  const any=(keys:string[])=>session.role==="admin"||keys.some(key=>hasPageAccess(session,key));
  const restrictedTeam=session.access_profile==="team_manager";
  const domains:Domain[]=[
    {key:"pilotage",label:"Pilotage",short:"PL",href:"/metiers/pilotage",description:"Performance du jour, BOOK, goulots, chiffre d’affaires et Cockpit V2.",visible:!restrictedTeam&&any(["reporting","book","cockpit","bodyshop","intelligence"])},
    {key:"client",label:"Relation Client",short:"RC",href:"/metiers/relation-client",description:"Dashboards clients Réseau EFF & EFB et BMW / MINI.",visible:any(["client_dashboard"])},
    {key:"rh",label:"RH",short:"RH",href:"/metiers/rh",description:"Temps de travail, formation, compétences, productivité et animation du centre.",visible:any(["worktime","training","data_rh","productivity","monthly_animation"])},
    {key:"admin",label:"Admin",short:"AD",href:"/metiers/admin",description:"Paramètres, accès, écrans atelier/direction, capacitaire et développement.",visible:session.role==="admin"},
    {key:"transphere",label:"Transphère",short:"TR",href:"/transphere",description:"Accès à l’environnement et aux outils opérationnels Transphère.",visible:any(["transphere"])},
  ];
  const visible=domains.filter(domain=>domain.visible);
  const mobileDomains=visible.map(({key,label,short,href,description})=>({key,label,short,href,description}));
  return <main className={`${styles.page} toolboxHub`}>
    <section className={`${styles.workspace} toolboxHubWorkspace`} aria-label="Univers métiers ToolBox CRVO Lens">
      <div className={styles.techArc} aria-hidden="true"/>
      <div className={`${styles.center} toolboxMobileCore`}>
        <div className={styles.centerPlate}>
          <Image src="/crvo-logo.png" alt="CRVO" width={280} height={86} priority unoptimized/>
          <span className={styles.centerText}>ToolBox CRVO Lens</span>
        </div>
      </div>
      <div className="toolboxMobileUniverseHeading" aria-hidden="true"><span>MES UNIVERS</span><strong>Accès rapide</strong></div>
      {visible.map(domain=><a key={domain.key} href={domain.href} className={`${styles.satellite} toolboxMobileUniverse`} data-domain={domain.key}>
        <div className={styles.cardVisual}><span className={styles.domainGlyph}><DomainGlyph domain={domain.key}/></span><span className={styles.icon}>{domain.short}</span></div>
        <div className={styles.cardCopy}><h2>{domain.label}</h2><p>{domain.description}</p></div>
        <footer><span>OUVRIR L’UNIVERS</span><i>›</i></footer>
      </a>)}
      {!visible.length&&<div className={styles.empty}>Aucun univers métier n’est encore autorisé pour ce compte. Contacte un administrateur pour ajuster les droits.</div>}
    </section>
    <div id="live-crvo" className="toolboxLiveAnchor"><ToolboxLiveWidgets/></div>
    <ToolboxMobileNav domains={mobileDomains}/>
  </main>;
}
