import Image from "next/image";
import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "./lib/crvo-auth";
import ToolboxLiveWidgets from "./toolbox-live-widgets";
import ToolboxMobileNav from "./toolbox-mobile-nav";
import transphereSatellite1 from "./transphere-satellite-chunk-1";
import transphereSatellite2 from "./transphere-satellite-chunk-2";
import transphereSatellite3 from "./transphere-satellite-chunk-3";
import transphereSatellite4 from "./transphere-satellite-chunk-4";
import transphereSatellite5 from "./transphere-satellite-chunk-5";
import "./toolbox-live-home.css";
import "./toolbox-mobile-home.css";
import "./toolbox-mobile-launcher.css";
import "./toolbox-live-mobile-fullscreen.css";
import styles from "./toolbox-home.module.css";

type DomainKey="pilotage"|"client"|"rh"|"admin"|"transphere";
type Domain={key:DomainKey;label:string;short:string;href:string;description:string;visible:boolean};
type PageProps={searchParams:Promise<Record<string,string|string[]|undefined>>};
const LEGACY_VIEWS=new Set(["today","yesterday","bottlenecks","walking","finance","objectives","sources"]);
const TRANSPHERE_SATELLITE_IMAGE=`data:image/webp;base64,${transphereSatellite1}${transphereSatellite2}${transphereSatellite3}${transphereSatellite4}${transphereSatellite5}`;

function DomainGlyph({domain}:{domain:DomainKey}){
  if(domain==="pilotage")return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 30a16 16 0 1 1 32 0"/><path d="M24 14v4M12.7 19.3l3 3M35.3 19.3l-3 3M9 30h4M35 30h4"/><path d="M24 30l9-8"/><circle cx="24" cy="30" r="2.8"/></svg>;
  if(domain==="client")return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="18" r="6"/><circle cx="32.5" cy="20" r="4.5"/><path d="M7 37c0-7 4.8-11 11-11s11 4 11 11M27 29c1.5-2 3.5-3 6-3 5 0 8 3.5 8 9"/></svg>;
  if(domain==="rh")return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="16" cy="19" r="5"/><circle cx="32" cy="19" r="5"/><path d="M6 36c0-6 4.5-10 10-10s10 4 10 10M22 36c0-6 4.5-10 10-10s10 4 10 10"/><path d="M24 8v6M21 11h6"/></svg>;
  if(domain==="admin")return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6c5 4 10 5.5 15 6v10c0 10-5.5 16.5-15 21-9.5-4.5-15-11-15-21V12c5-.5 10-2 15-6Z"/><path d="M18 24l4 4 8-9"/></svg>;
  return null;
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
      {visible.map(domain=><a key={domain.key} href={domain.href} className={`${styles.satellite} toolboxMobileUniverse`} data-domain={domain.key} aria-label={domain.key==="transphere"?"Ouvrir l’univers Transphère":undefined} style={domain.key==="transphere"?{padding:0,border:0,background:"transparent",boxShadow:"none",display:"block",minHeight:0}:undefined}>
        {domain.key==="transphere"?<Image src={TRANSPHERE_SATELLITE_IMAGE} alt="Transphère — ouvrir l’univers" width={660} height={347} unoptimized style={{display:"block",width:"100%",height:"auto",borderRadius:"28px",border:"1px solid rgba(0,79,159,.18)",boxShadow:"0 18px 42px rgba(22,60,85,.10)"}}/>:<><div className={styles.cardVisual}><span className={styles.domainGlyph}><DomainGlyph domain={domain.key}/></span></div><div className={styles.cardCopy}><h2>{domain.label}</h2><p>{domain.description}</p></div><footer><span>OUVRIR L’UNIVERS</span><i>›</i></footer></>}
      </a>)}
      {!visible.length&&<div className={styles.empty}>Aucun univers métier n’est encore autorisé pour ce compte. Contacte un administrateur pour ajuster les droits.</div>}
    </section>
    <div id="live-crvo" className="toolboxLiveAnchor"><ToolboxLiveWidgets/></div>
    <ToolboxMobileNav domains={mobileDomains}/>
  </main>;
}
