"use client";

import {useEffect,useMemo,useState} from "react";
import {usePathname,useSearchParams} from "next/navigation";
import styles from "./toolbox-shell.module.css";

type Me={displayName:string;role:"admin"|"user";accessProfile:string};
type NotificationRow={id:string;severity:"info"|"warning"|"critical";title:string;message:string;resolvedAt?:string|null;read:boolean};
type NotificationsPayload={notifications:NotificationRow[];unread:number};
type HealthWarning={code?:string;severity?:string;message?:string;count?:number;ageMinutes?:number};
type HealthPayload={ok?:boolean;dataTrustOk?:boolean;trustLevel?:"green"|"amber"|"red";dataReady?:boolean;warnings?:HealthWarning[];production?:{snapshotDate?:string;sourceAgeMinutes?:number;sourceName?:string};ftp?:{syncAgeMinutes?:number;lastSuccessAt?:string}};
type Crumb={label:string;href?:string};
type RouteContext={domain?:Crumb;leaf?:Crumb;parentHref:string};

const PERF_LABELS:Record<string,string>={today:"Performance du jour",yesterday:"BOOK · Dashboard",bottlenecks:"BOOK · Goulot",walking:"BOOK · Walking Dead",finance:"BOOK · Chiffre d’affaires",objectives:"Objectifs & seuils",sources:"Sources & connexion"};
const COCKPIT_LABELS:Record<string,string>={pilotage:"Cockpit V2 · Pilotage du jour",synthese:"Cockpit V2 · Synthèse manager",decision:"Cockpit V2 · Aide à la décision",prevision:"Cockpit V2 · Prévision fin de journée"};
function linkedDomain(label:string,href:string):Crumb{return{label,href};}
function numericAge(value:unknown){const age=Number(value);return Number.isFinite(age)?Math.max(0,age):null;}
function minuteLabel(value:unknown){const age=numericAge(value);if(age==null)return"durée inconnue";const rounded=Math.round(age);if(rounded<60)return`${rounded.toLocaleString("fr-FR")} min`;const hours=Math.floor(rounded/60);const minutes=rounded%60;return minutes?`${hours} h ${String(minutes).padStart(2,"0")}`:`${hours} h`;}
function trustAlert(payload:HealthPayload):NotificationRow|null{
  const ftpAge=numericAge(payload.ftp?.syncAgeMinutes);
  const red=payload.dataReady!==true||payload.trustLevel==="red"||payload.dataTrustOk===false;
  const amber=payload.trustLevel==="amber";
  if(!red&&!amber)return null;
  const all=(payload.warnings??[]).filter(item=>item?.message);
  const important=all.filter(item=>item.severity==="critical"||item.severity==="warning");
  const warningText=(important.length?important:all).slice(0,3).map(item=>item.message).filter(Boolean).join(" · ")||"Une source nécessite un contrôle de fraîcheur.";
  const sourceAge=minuteLabel(payload.production?.sourceAgeMinutes);
  const title=red?(ftpAge!=null&&ftpAge>180?"DONNÉES NON CERTIFIÉES":"DONNÉES À RECONTRÔLER"):ftpAge!=null&&ftpAge>120?"ALERTE FRAÎCHEUR":"VIGILANCE DONNÉES";
  return{id:"data-trust",severity:red?"critical":"warning",title,message:`${warningText} · Dernière synchronisation FTP : il y a ${minuteLabel(payload.ftp?.syncAgeMinutes)} · Âge de la source métier : ${sourceAge}`,read:false};
}
function routeContext(pathname:string,params:URLSearchParams):RouteContext{
  if(pathname==="/")return{parentHref:"/"};
  if(pathname==="/metiers/pilotage")return{domain:{label:"Pilotage"},parentHref:"/"};
  if(pathname==="/metiers/relation-client")return{domain:{label:"Relation Client"},parentHref:"/"};
  if(pathname==="/metiers/rh")return{domain:{label:"RH"},parentHref:"/"};
  if(pathname==="/metiers/admin")return{domain:{label:"Admin"},parentHref:"/"};
  if(pathname.startsWith("/pilotage/performance")){
    const nav=params.get("nav")||"today";const admin=nav==="objectives"||nav==="sources";
    return{domain:linkedDomain(admin?"Admin":"Pilotage",admin?"/metiers/admin":"/metiers/pilotage"),leaf:{label:PERF_LABELS[nav]||"Performance"},parentHref:admin?"/metiers/admin":"/metiers/pilotage"};
  }
  if(pathname.startsWith("/dashboard/presenteisme"))return{domain:linkedDomain("Pilotage","/metiers/pilotage"),leaf:{label:"Présentéisme & capacité"},parentHref:"/metiers/pilotage"};
  if(pathname.startsWith("/cockpit-v2/carrosserie"))return{domain:linkedDomain("Pilotage","/metiers/pilotage"),leaf:{label:"Cockpit V2 · Focus carrosserie"},parentHref:"/metiers/pilotage"};
  if(pathname.startsWith("/cockpit-v2")){const section=params.get("section")||"pilotage";return{domain:linkedDomain("Pilotage","/metiers/pilotage"),leaf:{label:COCKPIT_LABELS[section]||"Cockpit V2"},parentHref:"/metiers/pilotage"};}
  if(pathname.startsWith("/intelligence"))return{domain:linkedDomain("Pilotage","/metiers/pilotage"),leaf:{label:"Analyse"},parentHref:"/metiers/pilotage"};
  if(pathname.startsWith("/dashboard-client")){const scope=params.get("scope");return{domain:linkedDomain("Relation Client","/metiers/relation-client"),leaf:{label:scope==="bmw-mini"?"BMW / MINI":"Réseau EFF & EFB"},parentHref:"/metiers/relation-client"};}
  if(pathname.startsWith("/clients"))return{domain:linkedDomain("Relation Client","/metiers/relation-client"),leaf:{label:"Clients"},parentHref:"/metiers/relation-client"};
  if(pathname.startsWith("/annualisation"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Annualisation du centre"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/temps-travail/conges")||pathname.startsWith("/temps-travail/souhaits-cp"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Souhaits de CP"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/temps-travail"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Suivi du temps de travail"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/formation"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Formation & compétences"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/animation-centre/rh"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"RH & Polycompétences"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/animation-centre/export"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Export animation"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/performance/productivite"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Productivité"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/animation-mensuelle/acces"))return{domain:linkedDomain("Admin","/metiers/admin"),leaf:{label:"Accès Workflow"},parentHref:"/metiers/admin"};
  if(pathname.startsWith("/animation-mensuelle/payplan"))return{domain:linkedDomain("Admin","/metiers/admin"),leaf:{label:"Payplan"},parentHref:"/metiers/admin"};
  if(pathname.startsWith("/animation-mensuelle"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Variable"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/data-rh"))return{domain:linkedDomain("RH","/metiers/rh"),leaf:{label:"Data RH"},parentHref:"/metiers/rh"};
  if(pathname.startsWith("/sources"))return{domain:linkedDomain("Admin","/metiers/admin"),leaf:{label:"Sources & connexion"},parentHref:"/metiers/admin"};
  if(pathname.startsWith("/capacitaire"))return{domain:linkedDomain("Admin","/metiers/admin"),leaf:{label:"Simulateur capacitaire"},parentHref:"/metiers/admin"};
  if(pathname.startsWith("/developpement"))return{domain:linkedDomain("Admin","/metiers/admin"),leaf:{label:"Développement"},parentHref:"/metiers/admin"};
  if(pathname.startsWith("/transphere"))return{domain:{label:"Transphère"},parentHref:"/"};
  if(pathname.startsWith("/notifications"))return{leaf:{label:"Notifications"},parentHref:"/"};
  if(pathname.startsWith("/account"))return{leaf:{label:"Mon compte & accès"},parentHref:"/"};
  return{leaf:{label:"ToolBox CRVO Lens"},parentHref:"/"};
}
function profileLabel(me:Me){return me.role==="admin"?"Administrateur":me.accessProfile==="service_manager"?"Chef de service":me.accessProfile==="team_manager"?"Manager / Chef d’équipe":me.accessProfile==="trainer"?"Formateur":me.accessProfile==="hr"?"RH":me.accessProfile==="transphere_manager"?"Responsable Transphère":me.accessProfile==="transphere"?"Transphère":"Utilisateur autorisé";}

export default function ToolboxShell(){
  const pathname=usePathname();const searchParams=useSearchParams();
  const[me,setMe]=useState<Me|null>(null);const[notifications,setNotifications]=useState<NotificationRow[]>([]);const[healthAlert,setHealthAlert]=useState<NotificationRow|null>(null);const[unread,setUnread]=useState(0);const[tickerIndex,setTickerIndex]=useState(0);
  const standalone=pathname==="/login"||pathname==="/expertise-mobile"||pathname.startsWith("/expertise/client/")||pathname==="/atelier"||pathname==="/direction";
  const context=useMemo(()=>routeContext(pathname,new URLSearchParams(searchParams.toString())),[pathname,searchParams]);
  useEffect(()=>{if(standalone)return;let dead=false;async function load(){const[meResult,notificationResult,healthResult]=await Promise.allSettled([fetch("/api/auth/me",{cache:"no-store"}),fetch(`/api/notifications?limit=20&_=${Date.now()}`,{cache:"no-store"}),fetch(`/api/health?trust=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}})]);if(dead)return;if(meResult.status==="fulfilled"&&meResult.value.ok){const payload=await meResult.value.json().catch(()=>null);if(!dead)setMe(payload?.user??null);}if(notificationResult.status==="fulfilled"&&notificationResult.value.ok){const payload=await notificationResult.value.json().catch(()=>null) as NotificationsPayload|null;if(!dead&&payload){setNotifications((payload.notifications??[]).filter(item=>!item.resolvedAt));setUnread(payload.unread??0);}}if(healthResult.status==="fulfilled"){if(healthResult.value.ok){const payload=await healthResult.value.json().catch(()=>null) as HealthPayload|null;if(!dead)setHealthAlert(payload?trustAlert(payload):{id:"data-trust-error",severity:"critical",title:"CONTRÔLE DES DONNÉES INDISPONIBLE",message:"La certification automatique des données n’a pas pu être lue.",read:false});}else if(!dead)setHealthAlert({id:"data-trust-error",severity:"critical",title:"CONTRÔLE DES DONNÉES INDISPONIBLE",message:"La certification automatique des données n’a pas répondu correctement.",read:false});}else if(!dead)setHealthAlert({id:"data-trust-error",severity:"critical",title:"CONTRÔLE DES DONNÉES INDISPONIBLE",message:"La certification automatique des données est momentanément inaccessible.",read:false});}void load();const timer=window.setInterval(load,120000);return()=>{dead=true;window.clearInterval(timer);};},[standalone]);
  const ticker=useMemo(()=>notifications.filter(item=>!item.read).slice(0,8),[notifications]);
  useEffect(()=>{if(healthAlert||ticker.length<2)return;const timer=window.setInterval(()=>setTickerIndex(index=>(index+1)%ticker.length),6500);return()=>window.clearInterval(timer);},[healthAlert,ticker.length]);
  if(standalone||!me)return null;
  const currentTicker=healthAlert??ticker[tickerIndex%Math.max(1,ticker.length)]??null;const tickerHref=healthAlert?"/sources":"/notifications";
  const crumbs:Crumb[]=[{label:"Accueil ToolBox",href:"/"}];if(context.domain)crumbs.push(context.domain);if(context.leaf)crumbs.push(context.leaf);
  async function logout(){await fetch("/api/auth/logout",{method:"POST"}).catch(()=>null);location.href="/login";}
  return <header className={styles.shell}>
    <div className={styles.mainRow}>
      <a className={styles.brand} href="/"><span>CRVO · LENS</span><strong>ToolBox CRVO Lens</strong></a>
      <a className={`${styles.ticker} ${currentTicker?styles[currentTicker.severity]:""}`} href={tickerHref} aria-label={healthAlert?"Ouvrir le contrôle des sources":"Ouvrir les notifications"}>
        <span className={styles.tickerDot}/><div>{currentTicker?<><strong>{currentTicker.title}</strong><small>{currentTicker.message}</small></>:<><strong>ToolBox CRVO Lens</strong><small>Aucune notification prioritaire non lue.</small></>}</div><i>›</i>
      </a>
      <div className={styles.account}>
        <a className={styles.bell} href="/notifications" aria-label={`Notifications${unread?` · ${unread} non lues`:""}`}><span>●</span>{unread>0&&<b>{unread>99?"99+":unread}</b>}</a>
        <a className={styles.identity} href="/account"><span>ESPACE SÉCURISÉ</span><strong>{me.displayName}</strong><small>{profileLabel(me)}</small></a>
        <button className={styles.logout} type="button" onClick={()=>void logout()} title="Se déconnecter">↪<span>Déconnexion</span></button>
      </div>
    </div>
    {pathname!=="/"&&<div className={styles.contextRow}>
      <a className={styles.back} href={context.parentHref} aria-label="Revenir au niveau précédent">← <span>Retour</span></a>
      <nav className={styles.breadcrumb} aria-label="Fil d’Ariane">{crumbs.map((crumb,index)=>{const last=index===crumbs.length-1;return <span key={`${crumb.label}-${index}`}>{index>0&&<i>›</i>}{crumb.href&&!last?<a href={crumb.href}>{crumb.label}</a>:<b>{crumb.label}</b>}</span>})}</nav>
    </div>}
  </header>;
}
