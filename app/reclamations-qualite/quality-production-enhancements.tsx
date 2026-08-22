"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import lightbox from "./quality-photo-lightbox.module.css";
import qualityStyles from "./quality-claims-v2.module.css";
import productionStyles from "./quality-production-dossier.module.css";

const MIN_DATE = "2026-01-01";
const MIN_MONTH = "2026-01";
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)(?:$|[?#])/i;

type ViewerItem = { url:string; label:string };
type ViewerState = { items:ViewerItem[]; index:number };
type ProductionEvent = {event_date?:string|null;event_time?:string|null;status?:string|null;flow?:string|null;registration?:string|null;work_order?:string|null};
type ProductionComment = {author_name?:string|null;body?:string|null;created_at?:string|null};
type ProductionDossier = {
  matched:boolean;
  matchMethod?:string|null;
  confidence?:string|null;
  registration?:string|null;
  workOrder?:string|null;
  vin?:string|null;
  model?:string|null;
  client?:string|null;
  dates?:{created?:string|null;waitingFactory?:string|null;receivedFactory?:string|null;expertise?:string|null;factoryExit?:string|null;returnDone?:string|null};
  leadTimes?:{outboundDays?:number|string|null;storageDays?:number|string|null;factoryDays?:number|string|null;returnDays?:number|string|null;partsDays?:number|string|null};
  current?:{status?:string|null;statusAt?:string|null;mechanics?:string|null;bodywork?:string|null;technicalControl?:string|null;dsp?:string|null;wheels?:string|null;partAvailable?:string|null;partOrderedDays?:number|string|null;alert?:string|null;urgency?:string|null;snapshotAt?:string|null;sourceModifiedAt?:string|null;mileage?:number|string|null};
  workPerformed?:ProductionEvent[];
  timeline?:ProductionEvent[];
  comments?:ProductionComment[];
  commentsAvailable?:boolean;
  commentsNote?:string|null;
};
type ProductionTarget = {host:HTMLElement;claimNumber:string};

type QualitySearchPayload = {claims?:Array<{id:string;claim_number:string}>};
type QualityDetailPayload = {detail?:{productionDossier?:ProductionDossier|null}};

function pad(value:number){return String(value).padStart(2,"0")}
function isoLocal(date:Date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}
function currentMonthValue(){const now=new Date();return `${now.getFullYear()}-${pad(now.getMonth()+1)}`}
function previousCalendarMonth(){
  const now=new Date();
  const first=new Date(now.getFullYear(),now.getMonth()-1,1);
  const last=new Date(now.getFullYear(),now.getMonth(),0);
  return {month:`${first.getFullYear()}-${pad(first.getMonth()+1)}`,from:isoLocal(first),to:isoLocal(last),label:new Intl.DateTimeFormat("fr-FR",{month:"long",year:"numeric"}).format(first)};
}
function setControlledValue(input:HTMLInputElement,value:string){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  setter?.call(input,value);
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
}
function clickApply(){
  window.setTimeout(()=>{
    const apply=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.trim()==="APPLIQUER");
    apply?.click();
  },80);
}
function enhancePeriodControls(){
  const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const history=buttons.find(b=>b.textContent?.trim()==="TOUT L’HISTORIQUE"||b.dataset.period2026==="1");
  if(history){
    const text="DEPUIS JANVIER 2026";
    if(history.textContent!==text)history.textContent=text;
    history.dataset.period2026="1";
  }
  const prev=buttons.find(b=>b.textContent?.startsWith("MOIS PRÉCÉDENT")||b.dataset.previousMonth2026==="1");
  if(prev){
    const p=previousCalendarMonth();
    const text=`MOIS PRÉCÉDENT · ${p.label.toUpperCase()}`;
    if(prev.textContent!==text)prev.textContent=text;
    prev.dataset.previousMonth2026="1";
  }
  const today=isoLocal(new Date());
  const currentMonth=currentMonthValue();
  document.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach(i=>{i.min=MIN_DATE;i.max=today});
  document.querySelectorAll<HTMLInputElement>('input[type="month"]').forEach(i=>{i.min=MIN_MONTH;i.max=currentMonth});
  document.querySelectorAll("select").forEach(s=>{
    if((s.closest("label")?.textContent||"").includes("Année")){
      const currentYear=new Date().getFullYear();
      Array.from(s.options).forEach(o=>{const y=Number(o.value||o.text);const unavailable=y<2026||y>currentYear;o.disabled=unavailable;o.hidden=unavailable});
    }
  });
}
function looksLikePhoto(anchor:HTMLAnchorElement){
  const text=(anchor.textContent||"").trim();
  const upper=text.toUpperCase();
  if(upper.startsWith("PHOTO")||upper.startsWith("IMAGE"))return true;
  if(anchor.href.includes("attachmentId=")&&IMAGE_EXTENSION.test(text))return true;
  return false;
}
function enhancePhotoPreviews(){
  const anchors=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for(const anchor of anchors){
    if(!looksLikePhoto(anchor)||anchor.dataset.photoPreview==="1")continue;
    const label=(anchor.textContent||"Photo").trim();
    anchor.dataset.photoPreview="1";
    anchor.dataset.qualityPhoto="1";
    anchor.removeAttribute("target");
    anchor.removeAttribute("download");
    anchor.setAttribute("role","button");
    anchor.setAttribute("aria-label",`${label} — ouvrir en plein écran`);
    anchor.title="Ouvrir la photo en plein écran";
    anchor.style.display="grid";
    anchor.style.gap="8px";
    anchor.style.minWidth="150px";
    anchor.style.textDecoration="none";
    anchor.style.cursor="zoom-in";
    const image=document.createElement("img");
    image.src=anchor.href;
    image.alt=label;
    image.loading="lazy";
    image.style.width="170px";
    image.style.height="118px";
    image.style.objectFit="cover";
    image.style.borderRadius="12px";
    image.style.border="1px solid rgba(0,79,159,.18)";
    image.style.background="#f3f7fb";
    image.style.pointerEvents="none";
    anchor.insertAdjacentHTML("afterbegin",image.outerHTML);
    const inserted=anchor.querySelector("img");
    inserted?.addEventListener("error",()=>inserted.remove(),{once:true});
  }
}
function currentPhotoItems(){
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-quality-photo="1"]'))
    .map(anchor=>({url:anchor.href,label:(anchor.textContent||"Photo").trim()}))
    .filter((item,index,items)=>item.url&&items.findIndex(other=>other.url===item.url)===index);
}
function applySinceJanuary(){
  const dates=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  if(dates.length<2)return;
  setControlledValue(dates[0],MIN_DATE);
  setControlledValue(dates[1],isoLocal(new Date()));
  clickApply();
}
function applyPreviousMonth(){
  const p=previousCalendarMonth();
  const monthInput=document.querySelector<HTMLInputElement>('input[type="month"]');
  const dates=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));
  if(monthInput)setControlledValue(monthInput,p.month);
  if(dates.length>=2){setControlledValue(dates[0],p.from);setControlledValue(dates[1],p.to)}
  clickApply();
}
async function openClaimFromQuery(){
  const claimId=new URLSearchParams(window.location.search).get("claimId");
  if(!claimId)return;
  try{
    const q=new URLSearchParams({dateFrom:MIN_DATE,dateTo:isoLocal(new Date()),claimId});
    const response=await fetch(`/api/quality-claims-v2?${q.toString()}&_=${Date.now()}`,{cache:"no-store"});
    if(!response.ok)return;
    const payload=await response.json() as {detail?:{claim?:{claim_number?:string}}};
    const claimNumber=payload.detail?.claim?.claim_number;
    if(!claimNumber)return;
    applySinceJanuary();
    let attempts=0;
    const open=()=>{
      const row=Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr")).find(r=>(r.textContent||"").includes(claimNumber));
      if(row){row.click();row.scrollIntoView({behavior:"smooth",block:"center"});return;}
      attempts+=1;if(attempts<28)window.setTimeout(open,250);
    };
    window.setTimeout(open,300);
  }catch{}
}
function formatDate(value:string|null|undefined){
  if(!value)return "—";
  const raw=String(value).trim();
  const d=new Date(raw.length===10?`${raw}T12:00:00`:raw);
  if(Number.isNaN(d.getTime()))return raw;
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Europe/Paris"}).format(d);
}
function formatDateTime(value:string|null|undefined){
  if(!value)return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return String(value);
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);
}
function eventDate(event:ProductionEvent|undefined){
  if(!event?.event_date)return "—";
  return `${formatDate(event.event_date)}${event.event_time?` · ${String(event.event_time).slice(0,5)}`:""}`;
}
function numberDays(value:unknown){
  const n=Number(value);return Number.isFinite(n)?`${n.toLocaleString("fr-FR",{maximumFractionDigits:1})} j`:"—";
}
function detectProductionTarget():ProductionTarget|null{
  const hero=document.querySelector<HTMLElement>(`.${qualityStyles.detailHero}`);
  const claimText=document.querySelector<HTMLElement>(`.${qualityStyles.claimText}`);
  const claimNumber=hero?.querySelector("span")?.textContent?.trim()||"";
  if(!hero||!claimText||!claimNumber)return null;
  let host=document.querySelector<HTMLElement>('[data-quality-production-host="1"]');
  if(!host||host.parentElement!==claimText.parentElement){
    host=document.createElement("div");
    host.dataset.qualityProductionHost="1";
    claimText.insertAdjacentElement("afterend",host);
  }
  return {host,claimNumber};
}
async function loadProductionDossier(claimNumber:string,signal:AbortSignal){
  const base={dateFrom:MIN_DATE,dateTo:isoLocal(new Date()),search:claimNumber};
  const searchQuery=new URLSearchParams(base);
  const first=await fetch(`/api/quality-claims-v2?${searchQuery.toString()}&_=${Date.now()}`,{cache:"no-store",signal});
  if(!first.ok)throw new Error("Dossier de production indisponible.");
  const listing=await first.json() as QualitySearchPayload;
  const claim=listing.claims?.find(c=>c.claim_number===claimNumber);
  if(!claim)return null;
  const detailQuery=new URLSearchParams({dateFrom:MIN_DATE,dateTo:isoLocal(new Date()),claimId:claim.id});
  const second=await fetch(`/api/quality-claims-v2?${detailQuery.toString()}&_=${Date.now()}`,{cache:"no-store",signal});
  if(!second.ok)throw new Error("Rattachement production indisponible.");
  const detail=await second.json() as QualityDetailPayload;
  return detail.detail?.productionDossier??null;
}

function ProductionPanel({dossier,loading,error,timelineOpen,onToggle}:{dossier:ProductionDossier|null;loading:boolean;error:string;timelineOpen:boolean;onToggle:()=>void}){
  if(loading)return <div className={productionStyles.loading}>Recherche automatique du dossier de production CRVO…</div>;
  if(error)return <div className={productionStyles.error}>{error}</div>;
  if(!dossier)return null;
  if(!dossier.matched)return <section className={productionStyles.card}><div className={productionStyles.head}><div><span>DOSSIER DE PRODUCTION</span><h3>Aucun rattachement automatique trouvé</h3></div><em className={`${productionStyles.match} ${productionStyles.noMatch}`}>À RAPPROCHER</em></div><div className={productionStyles.note}>La Toolbox a recherché l’OR, le VIN et l’immatriculation normalisée dans l’État du Parc, le Lead Time, le workload et l’historique des statuts. Le dossier Qualité reste utilisable normalement.</div></section>;

  const timeline=dossier.timeline??[];
  const entryEvent=timeline.find(e=>(e.status||"").toLowerCase()==="réceptionné en usine");
  const exitEvent=[...timeline].reverse().find(e=>(e.status||"").toLowerCase()==="sortie usine");
  const expertiseEvent=timeline.find(e=>(e.status||"").toLowerCase().includes("expertise dynamique en cours"));
  const entry=dossier.dates?.receivedFactory||entryEvent?.event_date;
  const exit=dossier.dates?.factoryExit||exitEvent?.event_date;
  const expertise=dossier.dates?.expertise||expertiseEvent?.event_date;
  const performed=(dossier.workPerformed??[]).filter(e=>(e.status||"").toLowerCase().startsWith("travaux "));
  const visibleTimeline=timelineOpen?timeline:timeline.slice(Math.max(0,timeline.length-10));
  const currentEntries=[
    ["Mécanique",dossier.current?.mechanics],["Carrosserie",dossier.current?.bodywork],["Contrôle technique",dossier.current?.technicalControl],
    ["DSP",dossier.current?.dsp],["Jantes",dossier.current?.wheels],["Pièces",dossier.current?.partAvailable]
  ].filter(([,value])=>value!=null&&String(value).trim()!=="");

  return <section className={productionStyles.card}>
    <div className={productionStyles.head}><div><span>DOSSIER DE PRODUCTION RATTACHÉ</span><h3>{dossier.model||dossier.registration||"Véhicule CRVO"}</h3></div><em className={productionStyles.match}>RATTACHEMENT AUTO · {dossier.matchMethod||"CRVO"}</em></div>
    <div className={productionStyles.identity}><div><span>Immatriculation</span><strong>{dossier.registration||"—"}</strong></div><div><span>OR production</span><strong>{dossier.workOrder||"—"}</strong></div><div><span>VIN</span><strong>{dossier.vin||"—"}</strong></div><div><span>Client production</span><strong>{dossier.client||"—"}</strong></div></div>
    <div className={productionStyles.dates}><div><span>Entrée CRVO</span><strong>{formatDate(entry)}</strong></div><div><span>Expertise</span><strong>{formatDate(expertise)}</strong></div><div className={productionStyles.exit}><span>Sortie usine</span><strong>{formatDate(exit)}</strong></div><div><span>Lead time usine</span><strong>{numberDays(dossier.leadTimes?.factoryDays)}</strong></div></div>
    {dossier.current?.status&&<div className={productionStyles.section}><div className={productionStyles.sectionHead}><strong>Dernière situation connue</strong><small>{formatDateTime(dossier.current.sourceModifiedAt||dossier.current.statusAt)}</small></div><div className={productionStyles.current}><div><span>Statut</span><strong>{dossier.current.status}</strong></div>{currentEntries.map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{String(value)}</strong></div>)}{dossier.current?.mileage&&<div><span>Kilométrage</span><strong>{Number(dossier.current.mileage).toLocaleString("fr-FR")} km</strong></div>}</div></div>}
    <div className={productionStyles.section}><div className={productionStyles.sectionHead}><strong>Travaux confirmés dans l’historique</strong><small>{performed.length} jalon(s)</small></div>{performed.length?<div className={productionStyles.work}>{performed.map((e,i)=><div className={productionStyles.workItem} key={`${e.event_date}-${e.event_time}-${e.status}-${i}`}><time>{eventDate(e)}</time><strong>{e.status}</strong></div>)}</div>:<div className={productionStyles.note}>Aucun statut « Travaux … validés » n’est présent dans l’historique disponible pour ce véhicule.</div>}</div>
    <div className={productionStyles.section}><div className={productionStyles.sectionHead}><strong>Historique complet du véhicule</strong><small>{timeline.length} événement(s)</small></div>{visibleTimeline.length?<div className={productionStyles.timeline}>{visibleTimeline.map((e,i)=><div className={productionStyles.timelineItem} key={`${e.event_date}-${e.event_time}-${e.status}-${i}`}><time>{eventDate(e)}</time><span className={productionStyles.dot}></span><div><strong>{e.status||"Statut non renseigné"}</strong><small>{e.flow||"Flux CRVO"}</small></div></div>)}</div>:<div className={productionStyles.note}>Aucun événement détaillé disponible.</div>}{timeline.length>10&&<button type="button" className={productionStyles.toggle} onClick={onToggle}>{timelineOpen?"RÉDUIRE L’HISTORIQUE":`VOIR LES ${timeline.length} ÉVÉNEMENTS`}</button>}</div>
    <div className={productionStyles.section}><div className={productionStyles.sectionHead}><strong>Commentaires</strong><small>Interne CRVO</small></div>{(dossier.comments??[]).map((c,i)=><div className={productionStyles.comment} key={`${c.created_at}-${i}`}><strong>{c.author_name||"CRVO"}</strong><p>{c.body}</p><small>{formatDateTime(c.created_at)}</small></div>)}<div className={productionStyles.note}>{dossier.commentsNote||"Les commentaires de production ne sont pas encore transmis par les flux sources actuels."}</div></div>
  </section>;
}

export default function QualityProductionEnhancements(){
  const[viewer,setViewer]=useState<ViewerState|null>(null);
  const[productionTarget,setProductionTarget]=useState<ProductionTarget|null>(null);
  const[production,setProduction]=useState<ProductionDossier|null>(null);
  const[productionLoading,setProductionLoading]=useState(false);
  const[productionError,setProductionError]=useState("");
  const[timelineOpen,setTimelineOpen]=useState(false);

  useEffect(()=>{
    const run=()=>{
      enhancePeriodControls();enhancePhotoPreviews();
      const next=detectProductionTarget();
      setProductionTarget(previous=>{
        if(!next)return previous?.host?.isConnected?previous:null;
        if(previous?.host===next.host&&previous.claimNumber===next.claimNumber)return previous;
        return next;
      });
    };
    run();
    void openClaimFromQuery();
    const observer=new MutationObserver(run);
    observer.observe(document.body,{childList:true,subtree:true});
    const onClick=(event:MouseEvent)=>{
      const target=event.target as HTMLElement|null;
      const photo=target?.closest('a[data-quality-photo="1"]') as HTMLAnchorElement|null;
      if(photo){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const items=currentPhotoItems();
        const index=Math.max(0,items.findIndex(item=>item.url===photo.href));
        if(items.length)setViewer({items,index});
        return;
      }
      const button=target?.closest("button") as HTMLButtonElement|null;
      if(!button)return;
      if(button.dataset.period2026==="1"){
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();applySinceJanuary();
      }else if(button.dataset.previousMonth2026==="1"){
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();applyPreviousMonth();
      }
    };
    document.addEventListener("click",onClick,true);
    return()=>{observer.disconnect();document.removeEventListener("click",onClick,true)};
  },[]);

  useEffect(()=>{
    if(!productionTarget){setProduction(null);setProductionError("");return;}
    const controller=new AbortController();
    setProductionLoading(true);setProductionError("");setTimelineOpen(false);
    void loadProductionDossier(productionTarget.claimNumber,controller.signal)
      .then(value=>setProduction(value))
      .catch(error=>{if(!controller.signal.aborted)setProductionError(error instanceof Error?error.message:"Rattachement production indisponible.")})
      .finally(()=>{if(!controller.signal.aborted)setProductionLoading(false)});
    return()=>controller.abort();
  },[productionTarget?.claimNumber,productionTarget?.host]);

  useEffect(()=>{
    if(!viewer)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape")setViewer(null);
      if(event.key==="ArrowLeft")setViewer(state=>state?{...state,index:(state.index-1+state.items.length)%state.items.length}:state);
      if(event.key==="ArrowRight")setViewer(state=>state?{...state,index:(state.index+1)%state.items.length}:state);
    };
    window.addEventListener("keydown",onKey);
    return()=>{document.body.style.overflow=previousOverflow;window.removeEventListener("keydown",onKey)};
  },[viewer]);

  function move(delta:number){
    setViewer(state=>state?{...state,index:(state.index+delta+state.items.length)%state.items.length}:state);
  }

  const active=viewer?.items[viewer.index];
  const productionPortal=useMemo(()=>productionTarget?.host?createPortal(<ProductionPanel dossier={production} loading={productionLoading} error={productionError} timelineOpen={timelineOpen} onToggle={()=>setTimelineOpen(v=>!v)}/>,productionTarget.host):null,[productionTarget,production,productionLoading,productionError,timelineOpen]);

  return <>{productionPortal}{active&&viewer?<div className={lightbox.backdrop} role="dialog" aria-modal="true" aria-label="Photo de la réclamation en plein écran" onMouseDown={e=>{if(e.currentTarget===e.target)setViewer(null)}}>
    <div className={lightbox.stage} onMouseDown={e=>{if(e.currentTarget===e.target)setViewer(null)}}>
      <button type="button" className={lightbox.close} onClick={()=>setViewer(null)} aria-label="Fermer la photo">×</button>
      {viewer.items.length>1&&<button type="button" className={lightbox.previous} onClick={()=>move(-1)} aria-label="Photo précédente">‹</button>}
      <img className={lightbox.image} src={active.url} alt={active.label||"Photo de la réclamation"}/>
      {viewer.items.length>1&&<button type="button" className={lightbox.next} onClick={()=>move(1)} aria-label="Photo suivante">›</button>}
      <div className={lightbox.caption}><strong>{viewer.index+1} / {viewer.items.length}</strong><span>{active.label}</span></div>
    </div>
  </div>:null}</>;
}
