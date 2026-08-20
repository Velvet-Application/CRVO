"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./dashboard-section-nav.module.css";

type Access={allowed?:boolean;role?:string;profile?:string;level?:string|null};

function findTarget(pathname:string){
  const selector=pathname.startsWith("/dashboard/presenteisme")?"main h1":"main h2";
  const expected=pathname.startsWith("/dashboard/presenteisme")?"Présentéisme & capacité":"Performance du jour";
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(node=>node.textContent?.trim()===expected)?.parentElement??null;
}

export default function DashboardSectionNav(){
  const pathname=usePathname();
  const[access,setAccess]=useState<Access|null>(null);
  const[target,setTarget]=useState<HTMLElement|null>(null);

  useEffect(()=>{
    let active=true;
    fetch("/api/site-presence-capacity?access=1",{cache:"no-store",headers:{"Cache-Control":"no-cache"}})
      .then(async response=>response.ok?response.json():null)
      .then((payload:Access|null)=>{if(active)setAccess(payload);})
      .catch(()=>{if(active)setAccess(null);});
    return()=>{active=false;};
  },[]);

  useEffect(()=>{
    let timer=0;
    const resolve=()=>{const node=findTarget(pathname);if(node){setTarget(node);return true;}return false;};
    if(resolve())return()=>setTarget(null);
    const observer=new MutationObserver(()=>{if(resolve())observer.disconnect();});
    observer.observe(document.body,{childList:true,subtree:true});
    timer=window.setTimeout(()=>observer.disconnect(),5000);
    return()=>{window.clearTimeout(timer);observer.disconnect();setTarget(null);};
  },[pathname]);

  if(!access?.allowed||!target)return null;
  const presence=pathname.startsWith("/dashboard/presenteisme");
  const supervisor=access.profile==="team_manager"&&access.level==="supervisor";
  const content=<div className={styles.wrap}>
    <nav className={styles.nav} aria-label="Pilotage de la capacité du jour">
      <Link href={supervisor?"/equipe":"/"} className={styles.link} data-active={!presence}>Pilotage du jour</Link>
      <Link href="/dashboard/presenteisme" className={styles.link} data-active={presence}>Présentéisme & capacité</Link>
    </nav>
  </div>;
  return createPortal(content,target);
}
