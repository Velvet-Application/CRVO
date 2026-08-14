"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Me = { displayName:string; role:"admin"|"user" };

export default function AuthNav(){
  const [me,setMe]=useState<Me|null>(null);
  const [host,setHost]=useState<HTMLElement|null>(null);

  useEffect(()=>{
    fetch("/api/auth/me",{cache:"no-store"})
      .then(async response=>response.ok?response.json():null)
      .then(payload=>setMe(payload?.user??null))
      .catch(()=>setMe(null));
  },[]);

  useEffect(()=>{
    let currentHost:HTMLElement|null=null;
    const install=()=>{
      const topbar=document.querySelector<HTMLElement>(".topbar");
      if(!topbar){
        if(currentHost?.parentElement) currentHost.remove();
        currentHost=null;
        setHost(null);
        return;
      }
      let slot=document.getElementById("crvo-auth-slot") as HTMLElement|null;
      if(!slot){
        slot=document.createElement("div");
        slot.id="crvo-auth-slot";
      }
      if(slot.parentElement!==topbar) topbar.appendChild(slot);
      currentHost=slot;
      setHost(slot);
    };
    install();
    const observer=new MutationObserver(install);
    observer.observe(document.body,{childList:true,subtree:true});
    return ()=>{
      observer.disconnect();
      if(currentHost?.parentElement) currentHost.remove();
    };
  },[]);

  if(!me)return null;

  async function logout(){
    await fetch("/api/auth/logout",{method:"POST"}).catch(()=>null);
    location.href="/login";
  }

  const nav=<div className={`crvo-auth-nav ${host?"crvo-auth-nav-inline":"crvo-auth-nav-floating"}`}>
    <a href="/account" title="Gérer mon compte et les accès">
      <strong>{me.displayName}</strong>
      <span>{me.role==="admin"?"ADMIN":"UTILISATEUR"}</span>
    </a>
    <button onClick={logout} aria-label="Se déconnecter" title="Se déconnecter"><span>DÉCONNEXION</span></button>
  </div>;

  return <>
    {host?createPortal(nav,host):nav}
    <style>{`
      #crvo-auth-slot{flex:0 0 auto;display:flex;align-items:center;margin-left:8px}
      .crvo-auth-nav{z-index:120;display:flex;align-items:center;gap:7px;font-family:Exo,Arial,sans-serif;white-space:nowrap}
      .crvo-auth-nav-floating{position:fixed;top:12px;right:14px}
      .crvo-auth-nav-inline{position:static}
      .crvo-auth-nav>a,.crvo-auth-nav>button{min-height:36px;border-radius:10px;border:1px solid rgba(0,79,159,.12);box-shadow:0 8px 24px rgba(22,57,82,.08);backdrop-filter:blur(12px)}
      .crvo-auth-nav-inline>a,.crvo-auth-nav-inline>button{box-shadow:none;background:#fff}
      .crvo-auth-nav>a{display:flex;align-items:center;gap:8px;padding:0 11px;background:rgba(255,255,255,.94);text-decoration:none;color:#173e57}
      .crvo-auth-nav>a strong{font-size:11px}.crvo-auth-nav>a span{font-size:8px;font-weight:800;color:#009edb;letter-spacing:.08em}
      .crvo-auth-nav>button{padding:0 11px;background:rgba(255,255,255,.94);color:#6f8391;font:800 9px Exo,Arial,sans-serif;cursor:pointer}
      .crvo-auth-nav>button>span{display:block}
      @media(max-width:1180px){
        #crvo-auth-slot{margin-left:4px}
        .crvo-auth-nav{gap:4px}
        .crvo-auth-nav>a{padding:0 8px;gap:5px}
        .crvo-auth-nav-inline>button{width:36px;padding:0;font-size:0;position:relative}
        .crvo-auth-nav-inline>button>span{display:none}
        .crvo-auth-nav-inline>button::after{content:"↪";font-size:15px;line-height:1;color:#60798a}
      }
      @media(max-width:900px){
        .crvo-auth-nav-inline>a span{display:none}
        .crvo-auth-nav-inline>a{min-width:40px;justify-content:center}
      }
      @media(max-width:760px){
        #crvo-auth-slot{margin-left:auto}
        .crvo-auth-nav-floating{top:8px;right:8px}
        .crvo-auth-nav>a{padding:0 9px}
        .crvo-auth-nav-floating>a span,.crvo-auth-nav-floating>button{display:none}
        .crvo-auth-nav-inline>button{display:none}
      }
      @media print{#crvo-auth-slot,.crvo-auth-nav{display:none!important}}
    `}</style>
  </>;
}
