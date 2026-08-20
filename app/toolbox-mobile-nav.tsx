"use client";

import {useEffect,useMemo,useState} from "react";
import styles from "./toolbox-mobile-nav.module.css";

type MobileDomain={key:string;label:string;short:string;href:string;description:string};

function HomeIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9h13v-9M9.5 19v-5h5v5"/></svg>}
function PulseIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6"/><circle cx="12" cy="12" r="9"/></svg>}
function GridIcon(){return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>}

export default function ToolboxMobileNav({domains}:{domains:MobileDomain[]}){
  const[open,setOpen]=useState(false);
  const primary=useMemo(()=>domains.find(domain=>domain.key==="pilotage")??domains[0]??null,[domains]);
  useEffect(()=>{if(!open)return;const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false);};document.addEventListener("keydown",onKey);return()=>document.removeEventListener("keydown",onKey);},[open]);
  return <>
    <nav className={styles.dock} aria-label="Navigation mobile ToolBox">
      <a className={styles.active} href="/" aria-current="page"><span className={styles.navIcon}><HomeIcon/></span><small>Accueil</small></a>
      {primary?<a href={primary.href}><span className={styles.domainIcon}>{primary.short}</span><small>{primary.key==="pilotage"?"Piloter":primary.label}</small></a>:<a href="/notifications"><span className={styles.domainIcon}>!</span><small>Alertes</small></a>}
      <a className={styles.liveLink} href="#live-crvo"><span className={styles.navIcon}><PulseIcon/><i/></span><small>Live</small></a>
      <button type="button" onClick={()=>setOpen(true)} aria-expanded={open} aria-controls="toolbox-mobile-menu"><span className={styles.navIcon}><GridIcon/></span><small>Univers</small></button>
    </nav>
    {open?<>
      <button className={styles.backdrop} type="button" aria-label="Fermer le menu" onClick={()=>setOpen(false)}/>
      <aside id="toolbox-mobile-menu" className={styles.sheet} role="dialog" aria-modal="true" aria-label="Univers ToolBox">
        <div className={styles.handle}/>
        <header><div><span>NAVIGATION INTELLIGENTE</span><strong>Mes univers</strong><p>Uniquement les espaces autorisés pour votre profil.</p></div><button type="button" onClick={()=>setOpen(false)} aria-label="Fermer">×</button></header>
        <div className={styles.domainGrid}>{domains.map(domain=><a key={domain.key} href={domain.href} data-domain={domain.key} onClick={()=>setOpen(false)}><span>{domain.short}</span><div><strong>{domain.label}</strong><small>{domain.description}</small></div><i>›</i></a>)}</div>
        <footer><a href="/notifications"><span>●</span><div><strong>Notifications</strong><small>Alertes, fraîcheur FTP et informations ToolBox</small></div><i>›</i></a><a href="/account"><span>CR</span><div><strong>Mon compte</strong><small>Profil, accès et préférences</small></div><i>›</i></a></footer>
      </aside>
    </>:null}
  </>;
}
