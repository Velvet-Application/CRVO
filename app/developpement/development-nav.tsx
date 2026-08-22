"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DevelopmentModuleNav(){
  const pathname=usePathname();
  const links=[
    {href:"/developpement",label:"SAS DÉVELOPPEMENT"},
    {href:"/developpement/production",label:"PRODUCTION LIVE"},
    {href:"/developpement/expertise",label:"EXPERTISE / DEVIS"},
    {href:"/developpement/pr",label:"PR / MAGASIN"},
  ];
  return <nav aria-label="Modules SAS développement" style={{position:"fixed",zIndex:120,top:8,left:"50%",transform:"translateX(-50%)",display:"flex",gap:4,padding:4,border:"1px solid #cddfe9",borderRadius:12,background:"rgba(255,255,255,.97)",boxShadow:"0 8px 24px rgba(0,79,159,.12)",backdropFilter:"blur(8px)",maxWidth:"calc(100vw - 120px)",overflowX:"auto"}}>
    {links.map(link=>{const active=pathname===link.href;return <Link key={link.href} href={link.href} style={{padding:"8px 13px",borderRadius:8,background:active?"#004f9f":"transparent",color:active?"#fff":"#557286",font:"800 8px Exo,Arial,sans-serif",letterSpacing:".05em",textDecoration:"none",whiteSpace:"nowrap"}}>{link.label}</Link>;})}
  </nav>;
}
