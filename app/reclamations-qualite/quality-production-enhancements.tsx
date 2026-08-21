"use client";

import { useEffect, useState } from "react";
import lightbox from "./quality-photo-lightbox.module.css";

const MIN_DATE = "2026-01-01";
const MIN_MONTH = "2026-01";
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)(?:$|[?#])/i;

type ViewerItem = { url:string; label:string };
type ViewerState = { items:ViewerItem[]; index:number };

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

export default function QualityProductionEnhancements(){
  const[viewer,setViewer]=useState<ViewerState|null>(null);

  useEffect(()=>{
    const run=()=>{enhancePeriodControls();enhancePhotoPreviews()};
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
  return active&&viewer?<div className={lightbox.backdrop} role="dialog" aria-modal="true" aria-label="Photo de la réclamation en plein écran" onMouseDown={e=>{if(e.currentTarget===e.target)setViewer(null)}}>
    <div className={lightbox.stage} onMouseDown={e=>{if(e.currentTarget===e.target)setViewer(null)}}>
      <button type="button" className={lightbox.close} onClick={()=>setViewer(null)} aria-label="Fermer la photo">×</button>
      {viewer.items.length>1&&<button type="button" className={lightbox.previous} onClick={()=>move(-1)} aria-label="Photo précédente">‹</button>}
      <img className={lightbox.image} src={active.url} alt={active.label||"Photo de la réclamation"}/>
      {viewer.items.length>1&&<button type="button" className={lightbox.next} onClick={()=>move(1)} aria-label="Photo suivante">›</button>}
      <div className={lightbox.caption}><strong>{viewer.index+1} / {viewer.items.length}</strong><span>{active.label}</span></div>
    </div>
  </div>:null;
}
