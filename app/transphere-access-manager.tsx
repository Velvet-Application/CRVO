"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Me={role?:"admin"|"user";accessProfile?:string};

export default function TransphereAccessManager(){
  const pathname=usePathname();
  const[me,setMe]=useState<Me|null>(null);
  const onTransphere=pathname.startsWith("/transphere");

  useEffect(()=>{
    if(!onTransphere)return;
    let cancelled=false;
    void(async()=>{const response=await fetch("/api/auth/me",{cache:"no-store"});if(!response.ok||cancelled)return;const payload=await response.json().catch(()=>({})) as{user?:Me};if(!cancelled)setMe(payload.user??null);})();
    return()=>{cancelled=true;};
  },[onTransphere]);

  useEffect(()=>{
    if(!onTransphere||!me||me.role==="admin")return;
    document.body.classList.add("transphere-readonly-user");
    const rename=()=>{document.querySelectorAll(".transphere-shell small").forEach(node=>{if(node.textContent?.trim()==="ENVIRONNEMENT ADMINISTRATEUR")node.textContent="ENVIRONNEMENT TRANSPHÈRE";});};
    rename();
    const timer=window.setTimeout(rename,300);
    return()=>{window.clearTimeout(timer);document.body.classList.remove("transphere-readonly-user");};
  },[onTransphere,me]);

  if(!onTransphere)return null;
  return <style>{`body.transphere-readonly-user .transphere-shell [class*="importLabel"]{display:none!important;}`}</style>;
}
