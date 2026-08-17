"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Hosts={book:HTMLElement;animation:HTMLElement;middle:HTMLElement;settings:HTMLElement;settingsExtra:HTMLElement;adminScreens:HTMLElement};
type GroupKey="book"|"animation"|"cockpit"|"client"|"settings";
type OpenGroups=Record<GroupKey,boolean>;
type Me={role:"admin"|"user";accessProfile:"admin"|"service_manager"|"team_manager"|"custom";pagePermissions:string[]};
const DEFAULT_OPEN:OpenGroups={book:false,animation:false,cockpit:false,client:false,settings:false};
const STORAGE_KEY="crvo-sidebar-groups-v3";

function makeSlot(nav:HTMLElement,id:string){let slot=document.getElementById(id);if(!slot){slot=document.createElement("div");slot.id=id;}if(slot.parentElement!==nav)nav.appendChild(slot);return slot;}
function relabel(id:string,label:string){const node=document.getElementById(id)?.querySelector("span");if(node&&node.textContent!==label)node.textContent=label;}
function setHidden(id:string,hidden:boolean){const node=document.getElementById(id);if(node)node.hidden=hidden;}
function activeGroup(path:string):GroupKey|null{
  if(path.startsWith("/performance/productivite")||path.startsWith("/animation-mensuelle")||path.startsWith("/animation-centre/rh"))return"animation";
  if(path.startsWith("/cockpit-v2")||path.startsWith("/intelligence"))return"cockpit";
  if(path.startsWith("/dashboard-client")||path.startsWith("/clients"))return"client";
  if(/^\/(account|data-rh)/.test(path))return"settings";
  return null;
}

export default function PilotageNav(){
  const [hosts,setHosts]=useState<Hosts|null>(null);const [open,setOpen]=useState<OpenGroups>(DEFAULT_OPEN);const [me,setMe]=useState<Me|null>(null);
  const allowed=(key:string)=>Boolean(me&&(me.role==="admin"||me.pagePermissions?.includes("*")||me.pagePermissions?.includes(key)));const admin=me?.role==="admin";
  useEffect(()=>{fetch("/api/auth/me",{cache:"no-store"}).then(async response=>response.ok?response.json():null).then(payload=>setMe(payload?.user??null)).catch(()=>setMe(null));},[]);
  useEffect(()=>{const active=activeGroup(window.location.pathname);if(active){const next={...DEFAULT_OPEN,[active]:true};setOpen(next);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));}catch{}return;}try{const stored=localStorage.getItem(STORAGE_KEY);setOpen(stored?{...DEFAULT_OPEN,...JSON.parse(stored)} as OpenGroups:{...DEFAULT_OPEN});}catch{setOpen(DEFAULT_OPEN);}},[]);
  useEffect(()=>{
    let stopped=false;
    let attempts=0;
    const install=()=>{
      if(stopped)return true;
      const nav=document.querySelector<HTMLElement>(".sidebar nav");
      if(!nav)return false;
      const today=document.getElementById("nav-today"),yesterday=document.getElementById("nav-yesterday"),bottlenecks=document.getElementById("nav-bottlenecks"),walking=document.getElementById("nav-walking"),finance=document.getElementById("nav-finance"),objectives=document.getElementById("nav-objectives"),sources=document.getElementById("nav-sources");
      if(!today||!yesterday||!bottlenecks||!walking||!finance||!objectives||!sources)return false;
      relabel("nav-today","Performance du jour");relabel("nav-yesterday","Dashboard");relabel("nav-bottlenecks","Goulot");relabel("nav-walking","Walking Dead");relabel("nav-finance","Chiffre d'affaire");relabel("nav-objectives","Objectif & seuil");relabel("nav-sources","Source & Connexion");
      const book=makeSlot(nav,"architecture-book-label");if(book.nextSibling!==yesterday)nav.insertBefore(book,yesterday);
      const animation=makeSlot(nav,"architecture-animation-root");if(finance.nextSibling!==animation)nav.insertBefore(animation,finance.nextSibling);
      const middle=makeSlot(nav,"architecture-middle-root");if(animation.nextSibling!==middle)nav.insertBefore(middle,animation.nextSibling);
      const settings=makeSlot(nav,"architecture-settings-label");if(settings.nextSibling!==objectives)nav.insertBefore(settings,objectives);
      const settingsExtra=makeSlot(nav,"architecture-settings-extra");if(sources.nextSibling!==settingsExtra)nav.insertBefore(settingsExtra,sources.nextSibling);
      const adminScreens=makeSlot(nav,"architecture-admin-screens");if(settingsExtra.nextSibling!==adminScreens)nav.insertBefore(adminScreens,settingsExtra.nextSibling);
      setHosts(current=>current?.book===book&&current?.animation===animation&&current?.middle===middle&&current?.settings===settings&&current?.settingsExtra===settingsExtra&&current?.adminScreens===adminScreens?current:{book,animation,middle,settings,settingsExtra,adminScreens});
      return true;
    };
    if(install())return()=>{stopped=true;};
    const timer=window.setInterval(()=>{attempts+=1;if(install()||attempts>=40)window.clearInterval(timer);},50);
    return()=>{stopped=true;window.clearInterval(timer);};
  },[]);
  useEffect(()=>{
    setHidden("nav-today",!allowed("reporting"));
    ["nav-yesterday","nav-bottlenecks","nav-walking","nav-finance"].forEach(id=>setHidden(id,!allowed("book")||!open.book));
    ["nav-objectives","nav-sources"].forEach(id=>setHidden(id,!allowed("settings")||!open.settings));
  },[open,hosts,me]);
  const toggle=(group:GroupKey)=>setOpen(current=>{const next=current[group]?{...DEFAULT_OPEN}:{...DEFAULT_OPEN,[group]:true};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));}catch{}return next;});
  const groupHeading=(group:GroupKey,label:string,spaced=false)=><button type="button" className={`architecture-group-heading${spaced?" architecture-heading-spaced":""}`} aria-expanded={open[group]} onClick={()=>toggle(group)} title={open[group]?`Replier ${label}`:`Déplier ${label}`}><span>{label}</span><i className={open[group]?"is-open":""}>›</i></button>;
  const link=(href:string,label:string)=><a className="architecture-link" href={href}><span className="architecture-marker"/><span>{label}</span><i>›</i></a>;
  const topLink=(href:string,label:string)=><a className="architecture-top-link" href={href}><span>{label}</span><i>›</i></a>;
  const animationVisible=allowed("data_rh")||allowed("productivity")||allowed("monthly_animation")||admin;const cockpitVisible=allowed("cockpit")||allowed("bodyshop")||allowed("intelligence")||admin;const clientVisible=allowed("client_dashboard");const settingsVisible=Boolean(me);
  return <>
    {hosts?.book.isConnected&&allowed("book")?createPortal(groupHeading("book","BOOK",true),hosts.book):null}
    {hosts?.animation.isConnected&&animationVisible?createPortal(<>{groupHeading("animation","Animation du centre",true)}<div className={`architecture-collapse${open.animation?" is-open":""}`}><div className="architecture-links">{allowed("data_rh")?link("/animation-centre/rh","RH & Polycompétences"):null}{allowed("productivity")?link("/performance/productivite","Productivité"):null}{allowed("monthly_animation")?link("/animation-mensuelle","Variable"):null}{admin?link("/animation-mensuelle/acces","Accès Workflow"):null}{admin?link("/animation-mensuelle/payplan","Payplan"):null}</div></div></>,hosts.animation):null}
    {hosts?.middle.isConnected?createPortal(<>
      {cockpitVisible?<>{groupHeading("cockpit","Cockpit V2",true)}<div className={`architecture-collapse${open.cockpit?" is-open":""}`}><div className="architecture-links">{allowed("cockpit")?<>{link("/cockpit-v2?section=pilotage","Pilotage du jour")}{link("/cockpit-v2?section=synthese","Synthèse manager")}{link("/cockpit-v2?section=decision","Aide à la décision")}{link("/cockpit-v2?section=prevision","Prévision fin de journée")}</>:null}{allowed("bodyshop")?link("/cockpit-v2/carrosserie","Focus carrosserie"):null}{allowed("intelligence")?link("/intelligence","Analyse"):null}</div></div></>:null}
      {clientVisible?<>{groupHeading("client","Dashboard client",true)}<div className={`architecture-collapse${open.client?" is-open":""}`}><div className="architecture-links">{link("/dashboard-client?scope=reseau","Réseau EFF & EFB")}{link("/dashboard-client?scope=bmw-mini","BMW / MINI")}</div></div></>:null}
    </>,hosts.middle):null}
    {hosts?.settings.isConnected&&settingsVisible?createPortal(groupHeading("settings","Paramètre",true),hosts.settings):null}
    {hosts?.settingsExtra.isConnected&&settingsVisible?createPortal(<div className={`architecture-collapse architecture-settings-collapse${open.settings?" is-open":""}`}><div className="architecture-links architecture-settings-links">{link("/account","Accès")}{allowed("data_rh")?link("/data-rh","Data RH"):null}</div></div>,hosts.settingsExtra):null}
    {hosts?.adminScreens.isConnected&&admin?createPortal(<div className="architecture-admin-screens">{topLink("/atelier","Ecran ATELIER")}{topLink("/direction","Ecran DIRECTION")}{topLink("/capacitaire","Simulateur capacitaire")}</div>,hosts.adminScreens):null}
    <style>{`
      .sidebar nav{padding-bottom:14px}.sidebar nav .architecture-group-heading{width:calc(100% - 16px);margin:18px 8px 7px;padding:8px 5px;border:0;background:transparent;color:rgba(255,255,255,.62);display:flex;align-items:center;justify-content:space-between;gap:8px;font:inherit;font-size:10px;font-weight:800;letter-spacing:.115em;text-transform:uppercase;cursor:pointer;text-align:left}.sidebar nav .architecture-group-heading:hover{color:#fff}.sidebar nav .architecture-heading-spaced{margin-top:22px}.sidebar nav .architecture-group-heading>i{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;font-style:normal;font-size:18px;line-height:1;color:#82dcff;background:rgba(0,158,219,.10);transform:rotate(0deg);transition:transform .18s ease,background .18s ease}.sidebar nav .architecture-group-heading:hover>i{background:rgba(0,158,219,.20)}.sidebar nav .architecture-group-heading>i.is-open{transform:rotate(90deg)}
      .sidebar nav .architecture-collapse{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .2s ease,opacity .18s ease}.sidebar nav .architecture-collapse.is-open{grid-template-rows:1fr;opacity:1}.sidebar nav .architecture-collapse>.architecture-links{min-height:0;overflow:hidden}.sidebar nav .architecture-links{display:grid;gap:4px;padding:1px 2px}.sidebar nav .architecture-link{min-height:40px;padding:0 11px;display:grid;grid-template-columns:3px 1fr 12px;align-items:center;gap:11px;border:1px solid rgba(142,221,255,.08);border-radius:9px;color:rgba(255,255,255,.88)!important;background:rgba(0,42,83,.14);text-decoration:none!important;transition:.18s ease}.sidebar nav .architecture-link:hover{color:#fff!important;background:rgba(0,158,219,.17);border-color:rgba(133,221,255,.22)}.sidebar nav .architecture-marker{width:3px;height:18px;border-radius:4px;background:#009edb}.sidebar nav .architecture-link>span:nth-child(2){font-size:11px;font-weight:650;line-height:1.2}.sidebar nav .architecture-link>i{font-style:normal;color:#76d6fb;font-size:15px;text-align:right;opacity:.65}.sidebar nav .architecture-settings-links{margin-bottom:7px}
      .sidebar nav .architecture-admin-screens{display:grid;gap:6px;margin:18px 2px 8px;padding-top:15px;border-top:1px solid rgba(255,255,255,.14)}.sidebar nav .architecture-top-link{min-height:44px;padding:0 13px;display:flex;align-items:center;justify-content:space-between;border-radius:9px;color:#fff!important;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.10);text-decoration:none!important;font-size:10px;font-weight:800;letter-spacing:.035em}.sidebar nav .architecture-top-link:hover{background:rgba(0,158,219,.18);border-color:rgba(133,221,255,.25)}.sidebar nav .architecture-top-link i{font-style:normal;color:#86ddff;font-size:16px}
      #architecture-book-label,#architecture-animation-root,#architecture-middle-root,#architecture-settings-label,#architecture-settings-extra,#architecture-admin-screens{display:contents}
      @media(max-width:760px){.sidebar nav .architecture-group-heading{margin-left:7px;width:calc(100% - 14px)}.sidebar nav .architecture-link{min-height:43px}.sidebar nav .architecture-admin-screens{margin-bottom:18px}}
    `}</style>
  </>;
}
