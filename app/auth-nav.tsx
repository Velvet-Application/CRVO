"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Me={displayName:string;role:"admin"|"user";accessProfile:"admin"|"service_manager"|"team_manager"|"custom"};
function profileLabel(me:Me){return me.role==="admin"||me.accessProfile==="admin"?"ADMIN":me.accessProfile==="service_manager"?"CHEF DE SERVICE":me.accessProfile==="team_manager"?"CHEF D'ÉQUIPE":"ACCÈS PERSONNALISÉ";}

export default function AuthNav(){
  const pathname=usePathname();
  const standalone=pathname==="/expertise-mobile"||pathname.startsWith("/expertise/client/");
  const [me,setMe]=useState<Me|null>(null);
  useEffect(()=>{if(standalone)return;let cancelled=false;fetch("/api/auth/me",{cache:"no-store"}).then(async response=>response.ok?response.json():null).then(payload=>{if(!cancelled)setMe(payload?.user??null);}).catch(()=>{if(!cancelled)setMe(null);});return()=>{cancelled=true;};},[standalone]);
  if(standalone||!me)return null;
  async function logout(){await fetch("/api/auth/logout",{method:"POST"}).catch(()=>null);location.href="/login";}
  return <><div className="crvo-auth-nav"><a href="/account" title="Voir mon profil et mes accès"><strong>{me.displayName}</strong><span>{profileLabel(me)}</span></a><button onClick={logout} aria-label="Se déconnecter" title="Se déconnecter">DÉCONNEXION</button></div><style>{`
    .crvo-auth-nav{position:fixed;z-index:145;top:10px;right:12px;display:flex;align-items:center;gap:7px;font-family:Exo,Arial,sans-serif;white-space:nowrap}.crvo-auth-nav>a,.crvo-auth-nav>button{min-height:36px;border-radius:10px;border:1px solid rgba(0,79,159,.12);box-shadow:0 8px 24px rgba(22,57,82,.08);background:rgba(255,255,255,.96)}.crvo-auth-nav>a{display:flex;align-items:center;gap:8px;padding:0 11px;text-decoration:none;color:#173e57}.crvo-auth-nav>a strong{font-size:11px}.crvo-auth-nav>a span{font-size:8px;font-weight:800;color:#009edb;letter-spacing:.06em}.crvo-auth-nav>button{padding:0 11px;color:#6f8391;font:800 9px Exo,Arial,sans-serif;cursor:pointer}@media(max-width:760px){.crvo-auth-nav{top:8px;right:8px}.crvo-auth-nav>a span,.crvo-auth-nav>button{display:none}}@media print{.crvo-auth-nav{display:none!important}}
  `}</style></>;
}
