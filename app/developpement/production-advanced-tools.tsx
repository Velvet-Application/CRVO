"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type Vehicle = {
  registration:string|null; workOrder:string|null; client:string|null; vin:string|null; model:string|null; mileage:number;
  status:string; statusAgeDays:number; factoryAgeDays:number; alert:string|null; urgency:string|null; partAvailable:string|null;
  partOrderedDays:number; location:string|null; locationSourceModifiedAt:string|null; site:string|null; manufacturer:string|null; folderNumber:string|null;
  processProfile:"EFF"|"BMW"|"AUTRE"|"EXCLU"; inFactory:boolean;
};
type Fifo = {
  sectorKey:string; sectorLabel:string; registration:string|null; workOrder:string|null; status:string|null; alert:string|null; urgency:string|null;
  statusAgeDays:number; factoryAgeDays:number; fifoAgeDays:number;
};
type Payload = { connected:boolean; sourceModifiedAt:string|null; locationSourceModifiedAt:string|null; vehicles:Vehicle[]; fifo:Fifo[] };
type OverlayStore = { overlays?:Record<string,{comments?:Array<{text:string;actor:string;at:string}>}> };
type ToolMode = "run"|"fifo"|null;

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
function fmtDate(value?:string|null){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function isBlocked(part?:string|null){return /COMMANDEE|A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT/i.test(part||"");}
function isUrgent(v:Vehicle){return /oui|urgence/i.test(`${v.urgency||""} ${v.alert||""}`);}
function dossierTable(){return Array.from(document.querySelectorAll("table")).find(table=>table.querySelector("thead")?.textContent?.includes("Statut source / simulé"))??null;}
function rowRegistration(row:HTMLTableRowElement){return row.querySelector("td strong")?.textContent?.trim().toUpperCase()||"";}
function readComment(v:Vehicle){try{const raw=localStorage.getItem(STORE_KEY);if(!raw)return null;const parsed=JSON.parse(raw) as OverlayStore;return parsed.overlays?.[vehicleKey(v)]?.comments?.[0]??null;}catch{return null;}}

export default function ProductionAdvancedTools(){
  const pathname=usePathname();
  const [payload,setPayload]=useState<Payload|null>(null);
  const [mode,setMode]=useState<ToolMode>(null);
  const [runStage,setRunStage]=useState<StageKey>("preparation");
  const [fifoSector,setFifoSector]=useState("preparation");
  const [hover,setHover]=useState<{vehicle:Vehicle;x:number;y:number;comment:{text:string;actor:string;at:string}|null}|null>(null);

  useEffect(()=>{
    if(pathname!=="/developpement/production")return;
    let active=true;
    const load=async()=>{try{const r=await fetch(`/api/development/production?_=${Date.now()}`,{cache:"no-store"});if(!r.ok)return;const p=await r.json() as Payload;if(active)setPayload(p);}catch{}};
    void load();const timer=window.setInterval(()=>void load(),60000);return()=>{active=false;window.clearInterval(timer);};
  },[pathname]);

  const byRegistration=useMemo(()=>new Map((payload?.vehicles||[]).filter(v=>v.registration).map(v=>[String(v.registration).toUpperCase(),v])),[payload]);
  const fifoByReg=useMemo(()=>{const m=new Map<string,Fifo[]>();for(const f of payload?.fifo||[]){const k=String(f.registration||"").toUpperCase();if(!k)continue;m.set(k,[...(m.get(k)||[]),f]);}return m;},[payload]);

  useEffect(()=>{
    if(pathname!=="/developpement/production"||!payload)return;
    let scheduled=0;
    const enrich=()=>{
      const table=dossierTable();if(!table)return;
      const head=table.querySelector("thead tr");
      if(head&&!head.querySelector('[data-crvo-location-head="1"]')){
        const th=document.createElement("th");th.textContent="Localisation";th.dataset.crvoLocationHead="1";
        head.insertBefore(th,head.children[5]||null);
      }
      table.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach(row=>{
        if(row.querySelector('[data-crvo-location-cell="1"]'))return;
        const v=byRegistration.get(rowRegistration(row));
        const td=document.createElement("td");td.dataset.crvoLocationCell="1";
        const strong=document.createElement("strong");strong.textContent=v?.location||"—";strong.style.color=v?.location?"#004f9f":"#a4b1b9";strong.style.fontSize="8px";
        const small=document.createElement("small");small.textContent=v?.location?`Position · ${fmtDate(v.locationSourceModifiedAt)}`:"Position non fournie dans le flux disponible";small.style.display="block";small.style.marginTop="3px";small.style.fontSize="6px";small.style.color="#8196a3";
        td.append(strong,small);row.insertBefore(td,row.children[5]||null);
      });
    };
    const schedule=()=>{window.clearTimeout(scheduled);scheduled=window.setTimeout(enrich,20);};
    enrich();const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();window.clearTimeout(scheduled);};
  },[pathname,payload,byRegistration]);

  useEffect(()=>{
    if(pathname!=="/developpement/production")return;
    const move=(event:MouseEvent)=>{
      const target=event.target as HTMLElement|null;const row=target?.closest("tbody tr") as HTMLTableRowElement|null;const table=row?.closest("table");
      if(!row||!table?.querySelector("thead")?.textContent?.includes("Statut source / simulé")){setHover(null);return;}
      const v=byRegistration.get(rowRegistration(row));if(!v){setHover(null);return;}
      setHover({vehicle:v,x:event.clientX,y:event.clientY,comment:readComment(v)});
    };
    const leave=(event:MouseEvent)=>{const target=event.target as HTMLElement|null;if(!target?.closest("tbody tr"))setHover(null);};
    document.addEventListener("mousemove",move);document.addEventListener("mouseleave",leave);
    return()=>{document.removeEventListener("mousemove",move);document.removeEventListener("mouseleave",leave);};
  },[pathname,byRegistration]);

  const runRows=useMemo(()=>{
    const rows=(payload?.vehicles||[]).filter(v=>v.inFactory&&stageOf(v.status,v.partAvailable)===runStage);
    return rows.map(v=>{
      const fifo=Math.max(0,...(fifoByReg.get(String(v.registration||"").toUpperCase())||[]).map(f=>f.fifoAgeDays));
      const ready=!isBlocked(v.partAvailable);const score=(isUrgent(v)?100000:0)+(ready?10000:0)+fifo*100+v.factoryAgeDays;
      return{v,fifo,ready,score};
    }).sort((a,b)=>b.score-a.score).slice(0,100);
  },[payload,runStage,fifoByReg]);
  const fifoSectors=useMemo(()=>Array.from(new Map((payload?.fifo||[]).map(f=>[f.sectorKey,f.sectorLabel])).entries()).sort((a,b)=>a[1].localeCompare(b[1],"fr")),[payload]);
  const fifoRows=useMemo(()=>(payload?.fifo||[]).filter(f=>f.sectorKey===fifoSector).sort((a,b)=>b.fifoAgeDays-a.fifoAgeDays),[payload,fifoSector]);

  if(pathname!=="/developpement/production")return null;
  return <>
    <div style={{position:"fixed",right:18,top:88,zIndex:1180,display:"flex",gap:6,padding:5,border:"1px solid #cfe2ec",borderRadius:12,background:"rgba(255,255,255,.96)",boxShadow:"0 8px 24px rgba(0,79,159,.12)"}}>
      <button onClick={()=>setMode(mode==="run"?null:"run")} style={toolButton(mode==="run")}>RUN</button>
      <button onClick={()=>setMode(mode==="fifo"?null:"fifo")} style={toolButton(mode==="fifo")}>FIFO</button>
    </div>

    {hover&&<div style={{position:"fixed",zIndex:1500,left:Math.min(hover.x+18,window.innerWidth-390),top:Math.min(hover.y+14,window.innerHeight-250),width:360,padding:14,border:"1px solid #bcd8e7",borderTop:"4px solid #009edb",borderRadius:12,background:"#fff",boxShadow:"0 18px 46px rgba(0,47,82,.22)",pointerEvents:"none",fontFamily:"Exo,Arial,sans-serif"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12}}><div><span style={eyebrow}>DOSSIER</span><strong style={{display:"block",fontSize:17,color:"#004f9f"}}>{hover.vehicle.registration||"Sans immat"}</strong><small style={muted}>{hover.vehicle.model||"Modèle non renseigné"} · OR {hover.vehicle.workOrder||"—"}</small></div><b style={{alignSelf:"start",padding:"5px 7px",borderRadius:7,background:"#e8f6fb",color:"#006fae",fontSize:8}}>{stageLabel(hover.vehicle)}</b></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:10}}>
        <Info label="Localisation" value={hover.vehicle.location||"Non disponible"}/><Info label="Âge usine" value={`J+${Math.round(hover.vehicle.factoryAgeDays)}`}/>
        <Info label="Statut" value={hover.vehicle.status}/><Info label="MPR" value={hover.vehicle.partAvailable||"Non renseigné"}/>
      </div>
      <div style={{marginTop:8,padding:9,borderRadius:8,background:hover.vehicle.alert?"#fff7db":"#f4f8fa"}}><span style={eyebrow}>ALERTE / POINT D'ATTENTION</span><strong style={{display:"block",marginTop:3,fontSize:9,color:"#36566b"}}>{hover.vehicle.alert||"Aucune alerte FTP"}</strong></div>
      <div style={{marginTop:6,padding:9,borderRadius:8,background:hover.comment?"#eef8fc":"#f4f8fa"}}><span style={eyebrow}>DERNIER COMMENTAIRE DEV</span><strong style={{display:"block",marginTop:3,fontSize:9,color:"#36566b"}}>{hover.comment?.text||"Aucun commentaire"}</strong>{hover.comment&&<small style={muted}>{hover.comment.actor} · {fmtDate(hover.comment.at)}</small>}</div>
    </div>}

    {mode&&<><button aria-label="Fermer" onClick={()=>setMode(null)} style={{position:"fixed",zIndex:1250,inset:0,border:0,background:"rgba(7,36,55,.34)",backdropFilter:"blur(2px)"}}/><section style={{position:"fixed",zIndex:1300,left:30,right:30,top:70,bottom:30,borderRadius:18,background:"#f7fbfd",boxShadow:"0 24px 80px rgba(0,40,70,.30)",overflow:"auto",fontFamily:"Exo,Arial,sans-serif"}}>
      <header style={{position:"sticky",top:0,zIndex:2,display:"flex",alignItems:"center",justifyContent:"space-between",gap:20,padding:"18px 22px",borderBottom:"1px solid #d5e5ed",background:"rgba(255,255,255,.96)"}}><div><span style={eyebrow}>PRODUCTION LIVE · REFLET FTP</span><h2 style={{margin:"3px 0 0",fontSize:28,color:"#004f9f",fontStyle:"italic"}}>{mode==="run"?"RUN de production":"FIFO industriel"}</h2><p style={{margin:"5px 0 0",fontSize:9,color:"#6f8796"}}>{mode==="run"?"Ordre DEV proposé : urgence, disponibilité MPR puis FIFO. Aucune écriture MPF.":"File réelle calculée depuis le parc courant et les règles FIFO du KPI."}</p></div><div style={{display:"flex",alignItems:"center",gap:10}}><small style={muted}>Parc {fmtDate(payload?.sourceModifiedAt)} · position {fmtDate(payload?.locationSourceModifiedAt)}</small><button onClick={()=>setMode(null)} style={{border:0,borderRadius:9,padding:"10px 14px",background:"#004f9f",color:"#fff",fontWeight:800,cursor:"pointer"}}>FERMER</button></div></header>
      {mode==="run"?<RunPanel rows={runRows} stage={runStage} setStage={setRunStage}/>:<FifoPanel rows={fifoRows} sectors={fifoSectors} sector={fifoSector} setSector={setFifoSector} vehicles={byRegistration}/>} 
    </section></>}
  </>;
}

function RunPanel({rows,stage,setStage}:{rows:Array<{v:Vehicle;fifo:number;ready:boolean;score:number}>;stage:StageKey;setStage:(v:StageKey)=>void}){
  return <div style={{padding:22}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}><label style={{display:"grid",gap:4,fontSize:8,color:"#567183"}}><span>ÉTAPE / RUN</span><select value={stage} onChange={e=>setStage(e.target.value as StageKey)} style={selectStyle}>{STAGES.filter(([k])=>!['anomalie','mpr'].includes(k)).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label><div style={{padding:"9px 13px",borderRadius:10,background:"#e9f6fb"}}><span style={eyebrow}>DOSSIERS CANDIDATS</span><strong style={{display:"block",fontSize:23,color:"#004f9f",fontStyle:"italic"}}>{rows.length}</strong></div></div>
    <div style={tableBox}><table style={tableStyle}><thead><tr>{["#","Dossier","Client / véhicule","Localisation","Statut","MPR","FIFO","Âge usine","Motif priorité"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={vehicleKey(r.v)}><td style={tdStyle}><strong style={{color:"#004f9f"}}>{i+1}</strong></td><td style={tdStyle}><b>{r.v.registration||"—"}</b><small style={smallBlock}>OR {r.v.workOrder||"—"}</small></td><td style={tdStyle}><b>{r.v.client||"—"}</b><small style={smallBlock}>{r.v.model||"—"}</small></td><td style={tdStyle}><b>{r.v.location||"—"}</b></td><td style={tdStyle}>{r.v.status}</td><td style={tdStyle}><b style={{color:r.ready?"#1b837f":"#bd6a00"}}>{r.v.partAvailable||"—"}</b></td><td style={tdStyle}><strong>{r.fifo.toFixed(1)} j</strong></td><td style={tdStyle}>J+{Math.round(r.v.factoryAgeDays)}</td><td style={tdStyle}>{isUrgent(r.v)?"URGENCE · ":""}{r.ready?"MPR OK · ":"MPR À SÉCURISER · "}FIFO</td></tr>)}</tbody></table></div>
  </div>;
}
function FifoPanel({rows,sectors,sector,setSector,vehicles}:{rows:Fifo[];sectors:Array<[string,string]>;sector:string;setSector:(v:string)=>void;vehicles:Map<string,Vehicle>}){
  return <div style={{padding:22}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}><label style={{display:"grid",gap:4,fontSize:8,color:"#567183"}}><span>FILE FIFO</span><select value={sector} onChange={e=>setSector(e.target.value)} style={selectStyle}>{sectors.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label><div style={{padding:"9px 13px",borderRadius:10,background:"#e9f6fb"}}><span style={eyebrow}>DOSSIERS DANS LA FILE</span><strong style={{display:"block",fontSize:23,color:"#004f9f",fontStyle:"italic"}}>{rows.length}</strong></div></div>
    <div style={tableBox}><table style={tableStyle}><thead><tr>{["Rang","Dossier","Localisation","Statut","FIFO","Âge statut","Âge usine","Alerte"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>{rows.map((f,i)=>{const v=vehicles.get(String(f.registration||"").toUpperCase());return <tr key={`${f.sectorKey}-${f.registration}-${f.workOrder}-${i}`}><td style={tdStyle}><strong style={{color:"#004f9f"}}>{i+1}</strong></td><td style={tdStyle}><b>{f.registration||"—"}</b><small style={smallBlock}>OR {f.workOrder||"—"}</small></td><td style={tdStyle}><b>{v?.location||"—"}</b></td><td style={tdStyle}>{f.status||"—"}</td><td style={tdStyle}><strong>{f.fifoAgeDays.toFixed(1)} j</strong></td><td style={tdStyle}>{f.statusAgeDays.toFixed(1)} j</td><td style={tdStyle}>J+{Math.round(f.factoryAgeDays)}</td><td style={tdStyle}>{f.alert||"—"}</td></tr>})}</tbody></table></div>
  </div>;
}
function Info({label,value}:{label:string;value:string}){return <div style={{padding:8,borderRadius:8,background:"#f3f8fa"}}><span style={eyebrow}>{label}</span><strong style={{display:"block",marginTop:3,fontSize:9,color:"#31556c"}}>{value}</strong></div>}
const eyebrow:React.CSSProperties={fontSize:7,fontWeight:800,letterSpacing:".08em",color:"#009edb"};
const muted:React.CSSProperties={display:"block",marginTop:3,fontSize:7,color:"#7e939f"};
const selectStyle:React.CSSProperties={minWidth:220,padding:"10px 12px",border:"1px solid #cbdde7",borderRadius:9,background:"#fff",color:"#264c63",fontWeight:700};
const tableBox:React.CSSProperties={overflow:"auto",border:"1px solid #d8e6ed",borderRadius:12,background:"#fff"};
const tableStyle:React.CSSProperties={width:"100%",borderCollapse:"collapse",minWidth:1100,fontSize:9};
const thStyle:React.CSSProperties={position:"sticky",top:0,padding:"10px 11px",background:"#edf5f9",color:"#567184",fontSize:7,textTransform:"uppercase",letterSpacing:".06em",textAlign:"left"};
const tdStyle:React.CSSProperties={padding:"10px 11px",borderTop:"1px solid #e4edf2",verticalAlign:"top",color:"#35576b"};
const smallBlock:React.CSSProperties={display:"block",marginTop:3,fontSize:7,color:"#8396a2"};
function toolButton(active:boolean):React.CSSProperties{return{border:0,borderRadius:8,padding:"9px 13px",background:active?"#004f9f":"#eef6fa",color:active?"#fff":"#004f9f",fontWeight:900,fontSize:9,cursor:"pointer",letterSpacing:".05em"};}
