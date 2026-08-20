"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./dashboard-section-nav.module.css";

type Access={allowed?:boolean;role?:string;profile?:string;level?:string|null};

export default function DashboardSectionNav(){
  const pathname=usePathname();
  const[access,setAccess]=useState<Access|null>(null);
  useEffect(()=>{
    let active=true;
    fetch("/api/site-presence-capacity?access=1",{cache:"no-store",headers:{"Cache-Control":"no-cache"}})
      .then(async response=>response.ok?response.json():null)
      .then((payload:Access|null)=>{if(active)setAccess(payload);})
      .catch(()=>{if(active)setAccess(null);});
    return()=>{active=false;};
  },[]);
  if(!access?.allowed)return null;
  const presence=pathname.startsWith("/dashboard/presenteisme");
  const supervisor=access.profile==="team_manager"&&access.level==="supervisor";
  return <div className={styles.wrap}>
    <nav className={styles.nav} aria-label="Pages du Dashboard">
      <Link href={supervisor?"/equipe":"/"} className={styles.link} data-active={!presence}>{supervisor?"Pilotage équipe":"Pilotage"}</Link>
      <Link href="/dashboard/presenteisme" className={styles.link} data-active={presence}>Présentéisme & capacité</Link>
    </nav>
  </div>;
}
