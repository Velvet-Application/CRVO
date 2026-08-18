"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type Vehicle = {
  registration:string|null; workOrder:string|null; client:string|null; vin:string|null; model:string|null; mileage:number;
  status:string; statusAgeDays:number; factoryAgeDays:number; alert:string|null; urgency:string|null; partAvailable:string|null;
  partOrderedDays:number; location:string|null; locationSourceModifiedAt:string|null; site:string|null; manufacturer:string|null; folderNumber:string|null;
  processProfile:"EFF"|"BMW"|"AUTRE"|"EXCLU"; inFactory:boolean;
};
type Payload = { connected:boolean; vehicles:Vehicle[] };
type OverlayStore = { overlays?:Record<string,{comments?:Array<{text:string;actor:string;at:string}>}> };
type StageKey = "expertise"|"chiffrage"|"ct"|"mpr"|"travaux"|"preparation"|"qualite"|"sortie"|"anomalie";

const STORE_KEY="crvo-production-sandbox-v1";
const STAGES:Array<[StageKey,string]>=[
  ["expertise","Expertise"],["chiffrage","Chiffrage / validation"],["ct","Contrôle technique"],["mpr","MPR / pièces"],
  ["travaux","Travaux"],["preparation","Préparation"],["qualite","Qualité"],["sortie","Photos / sortie"],["anomalie","Anomalies"],
];

function stageOf(status:string,partStatus?:string|null):StageKey{
  const s=(status||"").toLowerCase(),p=(partStatus||"").toLowerCase();
  if(/anomal/.test(s))return "anomalie";
  if(/photo|sortie usine/.test(s))return "sortie";
  if(/qualit/.test(s))return "qualite";
  if(/prépar|prepar/.test(s))return "preparation";
  if(/mécan|mecan|carross|fixline|dsp|jante|restor|travaux/.test(s))return /command|a commander|indisponible|pas d'engagement/.test(p)?"mpr":"travaux";
  if(/contrôle technique|controle technique|départ ct|depart ct/.test(s))return "ct";
  if(/chiffr|devis|validation/.test(s))return "chiffrage";
  if(/expert|lavage|réceptionné|receptionne/.test(s))return "expertise";
  if(/command|a commander|indisponible|pas d'engagement/.test(p))return "mpr";
  return "travaux";
}
function stageLabel(v:Vehicle){const key=stageOf(v.status,v.partAvailable);return STAGES.find(([k])=>k===key)?.[1]||key;}
function vehicleKey(v:Vehicle){return String(v.vin||v.registration||v.workOrder||`${v.client}-${v.model}`);}
function normalize(value?:string|null){return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"");}
function fmtDate(value?:string|null){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function readComment(v:Vehicle){try{const raw=localStorage.getItem(STORE_KEY);if(!raw)return null;const parsed=JSON.parse(raw) as OverlayStore;return parsed.overlays?.[vehicleKey(v)]?.comments?.[0]??null;}catch{return null;}}
function isProductionTable(table:HTMLTableElement){const text=table.querySelector("thead")?.textContent||"";return /Dossier/i.test(text)&&/(Statut|FIFO|RUN)/i.test(text);}
function rowVehicle(row:HTMLTableRowElement,vehicles:Vehicle[]){
  const tokens=(row.textContent||"").split(/\s+/).map(normalize).filter(Boolean);
  return vehicles.find(v=>tokens.includes(normalize(v.registration))||tokens.includes(normalize(v.workOrder)))||null;
}

export default function ProductionAdvancedTools(){
  const pathname=usePathname();
  const [payload,setPayload]=useState<Payload|null>(null);
  const [hover,setHover]=useState<{vehicle:Vehicle;x:number;y:number;comment:{text:string;actor:string;at:string}|null}|null>(null);

  useEffect(()=>{
    if(pathname!=="/developpement/production")return;
    let active=true;
    const load=async()=>{try{const r=await fetch(`/api/development/production?_=${Date.now()}`,{cache:"no-store"});if(!r.ok)return;const p=await r.json() as Payload;if(active)setPayload(p);}catch{}};
    void load();const timer=window.setInterval(()=>void load(),60000);return()=>{active=false;window.clearInterval(timer);};
  },[pathname]);

  const vehicles=useMemo(()=>payload?.vehicles||[],[payload]);

  useEffect(()=>{
    if(pathname!=="/developpement/production")return;
    const move=(event:MouseEvent)=>{
      const target=event.target as HTMLElement|null;
      const row=target?.closest("tbody tr") as HTMLTableRowElement|null;
      const table=row?.closest("table") as HTMLTableElement|null;
      if(!row||!table||!isProductionTable(table)){setHover(null);return;}
      const vehicle=rowVehicle(row,vehicles);if(!vehicle){setHover(null);return;}
      setHover({vehicle,x:event.clientX,y:event.clientY,comment:readComment(vehicle)});
    };
    const leave=()=>setHover(null);
    document.addEventListener("mousemove",move);
    document.addEventListener("mouseleave",leave);
    return()=>{document.removeEventListener("mousemove",move);document.removeEventListener("mouseleave",leave);};
  },[pathname,vehicles]);

  if(pathname!=="/developpement/production"||!hover)return null;
  return <div style={{position:"fixed",zIndex:1500,left:Math.min(hover.x+18,window.innerWidth-390),top:Math.min(hover.y+14,window.innerHeight-250),width:360,padding:14,border:"1px solid #bcd8e7",borderTop:"4px solid #009edb",borderRadius:12,background:"#fff",boxShadow:"0 18px 46px rgba(0,47,82,.22)",pointerEvents:"none",fontFamily:"Exo,Arial,sans-serif"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12}}><div><span style={eyebrow}>DOSSIER</span><strong style={{display:"block",fontSize:17,color:"#004f9f"}}>{hover.vehicle.registration||"Sans immat"}</strong><small style={muted}>{hover.vehicle.model||"Modèle non renseigné"} · OR {hover.vehicle.workOrder||"—"}</small></div><b style={{alignSelf:"start",padding:"5px 7px",borderRadius:7,background:"#e8f6fb",color:"#006fae",fontSize:8}}>{stageLabel(hover.vehicle)}</b></div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:10}}><Info label="Localisation" value={hover.vehicle.location||"Non disponible"}/><Info label="Âge usine" value={`J+${Math.round(hover.vehicle.factoryAgeDays)}`}/><Info label="Statut" value={hover.vehicle.status}/><Info label="MPR" value={hover.vehicle.partAvailable||"Non renseigné"}/></div>
    <div style={{marginTop:8,padding:9,borderRadius:8,background:hover.vehicle.alert?"#fff7db":"#f4f8fa"}}><span style={eyebrow}>ALERTE / POINT D'ATTENTION</span><strong style={{display:"block",marginTop:3,fontSize:9,color:"#36566b"}}>{hover.vehicle.alert||"Aucune alerte FTP"}</strong></div>
    <div style={{marginTop:6,padding:9,borderRadius:8,background:hover.comment?"#eef8fc":"#f4f8fa"}}><span style={eyebrow}>DERNIER COMMENTAIRE DEV</span><strong style={{display:"block",marginTop:3,fontSize:9,color:"#36566b"}}>{hover.comment?.text||"Aucun commentaire"}</strong>{hover.comment&&<small style={muted}>{hover.comment.actor} · {fmtDate(hover.comment.at)}</small>}</div>
  </div>;
}

function Info({label,value}:{label:string;value:string}){return <div style={{padding:8,borderRadius:8,background:"#f3f8fa"}}><span style={eyebrow}>{label}</span><strong style={{display:"block",marginTop:3,fontSize:9,color:"#31566d",wordBreak:"break-word"}}>{value}</strong></div>;}
const eyebrow:React.CSSProperties={fontSize:7,fontWeight:800,color:"#009edb",letterSpacing:".08em"};
const muted:React.CSSProperties={display:"block",marginTop:3,fontSize:7,color:"#7a909e"};
