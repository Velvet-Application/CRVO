"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Metric={key:string;label:string;value:number};
type InitPayload={batchId?:string;signedUrl?:string;duplicate?:boolean;error?:string};
type FinalPayload={metrics?:number;error?:string};

function detectDate(filename:string){
  const fr=filename.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/); if(fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso=filename.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/); if(iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return new Date().toISOString().slice(0,10);
}

async function sha256(buffer:ArrayBuffer){
  const digest=await crypto.subtle.digest("SHA-256",buffer);
  return Array.from(new Uint8Array(digest)).map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

async function parseBook(file:File){
  const XLSX=await import("@e965/xlsx");
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:"array",cellDates:true});
  const summary=workbook.Sheets["Synthèse"];
  const production=workbook.Sheets["Tdb Production"];
  const goulot=workbook.Sheets["Goulot"];
  if(!summary||!production||!goulot) throw new Error("Le Book ne contient pas les feuilles Synthèse, Tdb Production et Goulot attendues.");
  const value=(sheet:typeof summary,cell:string)=>{ const parsed=Number(sheet[cell]?.v); if(!Number.isFinite(parsed)) throw new Error(`La donnée ${cell} est absente du Book.`); return parsed; };
  const metrics:Metric[]=[
    {key:"entries_vop",label:"Entrées VOP",value:value(summary,"E4")+value(summary,"E5")},
    {key:"exits_vop",label:"Sorties VOP",value:value(summary,"E6")},
    {key:"factory_stock",label:"Stock usine",value:value(summary,"E8")},
    {key:"stock_over_15d",label:"Stock de plus de 15 jours",value:value(summary,"E10")+value(summary,"E11")},
    {key:"stock_over_20d",label:"Stock de plus de 20 jours",value:value(summary,"E12")+value(summary,"E13")},
    {key:"production_expertise",label:"Production Expertise",value:value(production,"G6")},
    {key:"production_mechanics",label:"Production Mécanique",value:value(production,"M6")},
    {key:"production_dsp",label:"Production DSP",value:value(production,"S6")},
    {key:"production_bodywork",label:"Production Carrosserie",value:value(production,"Y6")},
    {key:"production_preparation",label:"Production Préparation",value:value(production,"AE6")},
    {key:"production_quality",label:"Production Qualité",value:value(production,"AK6")},
    {key:"production_factory_exit",label:"Production Sortie usine",value:value(production,"AQ6")},
    {key:"bottleneck_expertise",label:"Encours Expertise",value:value(goulot,"H14")},
    {key:"bottleneck_chiffrage",label:"Encours Chiffrage",value:value(goulot,"K14")},
    {key:"bottleneck_controle_technique",label:"Encours Contrôle technique",value:value(goulot,"N14")},
    {key:"bottleneck_parc_travaux",label:"Encours Parc travaux",value:value(goulot,"T14")},
    {key:"bottleneck_dsp",label:"Encours DSP",value:value(goulot,"H21")},
    {key:"bottleneck_jantes",label:"Encours Jantes",value:value(goulot,"K21")},
    {key:"bottleneck_mecanique",label:"Encours Mécanique",value:value(goulot,"N21")},
    {key:"bottleneck_carrosserie",label:"Encours Carrosserie",value:value(goulot,"Q21")},
    {key:"bottleneck_preparation",label:"Encours Préparation",value:value(goulot,"T21")},
    {key:"bottleneck_expertise_cadence",label:"Cadence Expertise",value:value(goulot,"H16")},
    {key:"bottleneck_chiffrage_cadence",label:"Cadence Chiffrage",value:value(goulot,"K16")},
    {key:"bottleneck_controle_technique_cadence",label:"Cadence Contrôle technique",value:value(goulot,"N16")},
    {key:"bottleneck_parc_travaux_cadence",label:"Cadence Parc travaux",value:value(goulot,"T16")},
    {key:"bottleneck_dsp_cadence",label:"Cadence DSP",value:value(goulot,"H24")},
    {key:"bottleneck_jantes_cadence",label:"Cadence Jantes",value:value(goulot,"K24")},
    {key:"bottleneck_mecanique_cadence",label:"Cadence Mécanique",value:value(goulot,"N24")},
    {key:"bottleneck_carrosserie_cadence",label:"Cadence Carrosserie",value:value(goulot,"Q24")},
    {key:"bottleneck_preparation_cadence",label:"Cadence Préparation",value:value(goulot,"T24")},
  ];
  return {buffer,metrics,snapshotAt:detectDate(file.name)};
}

export default function OperationalSourcePortal(){
  const [host,setHost]=useState<HTMLElement|null>(null);
  const [file,setFile]=useState<File|null>(null);
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{
    const locate=()=>{
      const old=document.querySelector<HTMLElement>(".book-uploader");
      if(!old?.parentElement){ document.body.classList.remove("crvo-reliable-book-import"); setHost(null); return; }
      let root=document.getElementById("operational-source-portal-root");
      if(!root){ root=document.createElement("div"); root.id="operational-source-portal-root"; old.parentElement.insertBefore(root,old); }
      document.body.classList.add("crvo-reliable-book-import"); setHost(root);
    };
    locate(); const observer=new MutationObserver(locate); observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();document.body.classList.remove("crvo-reliable-book-import");};
  },[]);

  async function upload(){
    if(!file||busy) return;
    setBusy(true); setStatus("Lecture complète : production + encours + cadences…");
    try{
      const authResponse=await fetch("/api/import-book/auth",{cache:"no-store"});
      const auth=await authResponse.json() as {authenticated?:boolean};
      if(!auth.authenticated) throw new Error("Déverrouille d’abord l’accès sécurisé en haut de la page.");
      const parsed=await parseBook(file);
      const hash=await sha256(parsed.buffer);
      setStatus("Archivage et enregistrement des 30 indicateurs du Book…");
      const initResponse=await fetch("/api/import-book/init",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,byteSize:file.size,sha256:hash,snapshotAt:parsed.snapshotAt,contentType:file.type||"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"})});
      const init=await initResponse.json() as InitPayload;
      if(!initResponse.ok) throw new Error(init.duplicate?"Ce Book est déjà présent dans l’historique.":init.error||"Impossible de préparer l’import.");
      if(!init.signedUrl||!init.batchId) throw new Error("Préparation de l’import incomplète.");
      const archive=await fetch(init.signedUrl,{method:"PUT",headers:{"x-upsert":"false"},body:file});
      if(!archive.ok) throw new Error("L’archivage du fichier original a échoué.");
      const finalResponse=await fetch("/api/import-book/finalize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({batchId:init.batchId,metrics:parsed.metrics})});
      const final=await finalResponse.json() as FinalPayload;
      if(!finalResponse.ok) throw new Error(final.error||"La validation du Book a échoué.");
      setStatus(`Book du ${parsed.snapshotAt.split("-").reverse().join("/")} intégré : production, stock, goulots et cadences sont actualisés.`); setFile(null);
      window.setTimeout(()=>window.location.reload(),1100);
    }catch(error){ setStatus(error instanceof Error?error.message:"Erreur pendant l’import du Book."); }
    finally{setBusy(false);}
  }

  if(!host||!host.isConnected) return null;
  return createPortal(<section className="reliable-book-uploader">
    <div className="reliable-book-copy"><span>IMPORT OPÉRATIONNEL FIABILISÉ</span><h3>Ajouter un Book CRVO complet</h3><p>Un seul import met à jour la production, le stock, le vieillissement, les goulots, les cadences et l’historique daté. En cas d’absence FTP, ce Book devient automatiquement la référence la plus récente.</p><div><b>30 KPI contrôlés</b><small>12 production/stock · 9 encours · 9 cadences</small></div></div>
    <div className="reliable-book-actions"><label className={file?"selected":""}><input type="file" accept=".xlsx,.xls" onChange={(e)=>{setFile(e.target.files?.[0]??null);setStatus("");}}/><strong>{file?.name||"Choisir le Book CRVO"}</strong><small>XLSX/XLS · date détectée dans le nom du fichier</small></label><button disabled={!file||busy} onClick={()=>void upload()}>{busy?"Contrôle en cours…":"Importer et actualiser tous les KPI"}</button>{status&&<p>{status}</p>}</div>
  </section>,host);
}
