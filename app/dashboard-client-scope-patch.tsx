"use client";

import { useEffect } from "react";

export default function DashboardClientScopePatch(){
  useEffect(()=>{
    if(window.location.pathname!=="/dashboard-client")return;
    const scope=new URLSearchParams(window.location.search).get("scope");
    if(scope!=="reseau"&&scope!=="bmw-mini")return;
    const apply=()=>{
      const buttons=[...document.querySelectorAll<HTMLButtonElement>(".dc-tabs button")];
      if(buttons.length<2)return;
      const target=scope==="bmw-mini"?buttons[1]:buttons[0];
      if(!target.classList.contains("active"))target.click();
      if(scope==="reseau"&&buttons[0].textContent!=="Réseau")buttons[0].textContent="Réseau";
      if(buttons[1].textContent!=="BMW / MINI")buttons[1].textContent="BMW / MINI";
    };
    apply();
    const observer=new MutationObserver(apply);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);
  return null;
}
