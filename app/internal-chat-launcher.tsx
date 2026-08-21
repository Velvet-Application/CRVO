"use client";

import {useEffect,useMemo,useState} from "react";
import {usePathname} from "next/navigation";

type Thread={unread:number};type Snapshot={threads:Thread[]};

export default function InternalChatLauncher(){
  const pathname=usePathname();
  const[unread,setUnread]=useState(0);
  const hidden=useMemo(()=>pathname==="/login"||pathname.startsWith("/qualite/client/")||pathname.startsWith("/q/")||pathname==="/expertise-mobile"||pathname.startsWith("/expertise/client/")||pathname==="/atelier"||pathname==="/direction"||pathname.startsWith("/messagerie"),[pathname]);
  useEffect(()=>{
    if(hidden)return;
    let dead=false;
    async function load(){try{const r=await fetch(`/api/internal-chat?_=${Date.now()}`,{cache:"no-store"});if(!r.ok)return;const p=await r.json() as Snapshot;if(!dead)setUnread((p.threads??[]).reduce((sum,t)=>sum+Number(t.unread||0),0))}catch{}}
    void load();const timer=window.setInterval(load,15000);return()=>{dead=true;window.clearInterval(timer)};
  },[hidden]);
  if(hidden)return null;
  return <a href="/messagerie" aria-label={`Messagerie interne CRVO${unread?` · ${unread} non lu(s)`:""}`} title="Messagerie interne CRVO" style={{position:"fixed",right:22,bottom:22,zIndex:8800,width:54,height:54,borderRadius:18,display:"grid",placeItems:"center",background:"linear-gradient(145deg,#004f9f,#009edb)",color:"white",textDecoration:"none",boxShadow:"0 14px 34px rgba(0,79,159,.28)",fontFamily:"Exo,Arial,sans-serif"}}>
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.75 6.5h14.5A1.75 1.75 0 0 1 21 8.25v8.5a1.75 1.75 0 0 1-1.75 1.75H4.75A1.75 1.75 0 0 1 3 16.75v-8.5A1.75 1.75 0 0 1 4.75 6.5Z" stroke="currentColor" strokeWidth="1.8"/><path d="m4.25 8 6.47 5.03a2.08 2.08 0 0 0 2.56 0L19.75 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    {unread>0&&<b style={{position:"absolute",right:-5,top:-5,minWidth:22,height:22,padding:"0 5px",borderRadius:999,display:"grid",placeItems:"center",background:"#c94444",color:"white",border:"2px solid white",fontSize:8}}>{unread>99?"99+":unread}</b>}
  </a>;
}
