"use client";

import { useEffect } from "react";

const MIN_DATE = "2026-01-01";
const MIN_MONTH = "2026-01";

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
  document.querySelectorAll<HTMLSelectElement>("select").forEach(s=>{
    if((s.closest("label")?.textContent||"").includes("Année")){
      const currentYear=new Date().getFullYear();
      Array.from(s.options).forEach(o=>{const y=Number(o.value||o.text);const unavailable=y<2026||y>currentYear;o.disabled=unavailable;o.hidden=unavailable});
    }
  });
}
function enhancePhotoPreviews(){
  const anchors=Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for(const anchor of anchors){
    const text=(anchor.textContent||"").trim().toUpperCase();
    if(!text.startsWith("PHOTO")||anchor.dataset.photoPreview==="1")continue;
    anchor.dataset.photoPreview="1";
    anchor.style.display="grid";
    anchor.style.gap="8px";
    anchor.style.minWidth="150px";
    anchor.style.textDecoration="none";
    const image=document.createElement("img");
    image.src=anchor.href;
    image.alt=text;
    image.loading="lazy";
    image.style.width="170px";
    image.style.height="118px";
    image.style.objectFit="cover";
    image.style.borderRadius="12px";
    image.style.border="1px solid rgba(0,79,159,.18)";
    image.style.background="#f3f7fb";
    image.addEventListener("error",()=>image.remove(),{once:true});
    anchor.prepend(image);
  }
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

export default function QualityProductionEnhancements(){
  useEffect(()=>{
    const run=()=>{enhancePeriodControls();enhancePhotoPreviews()};
    run();
    const observer=new MutationObserver(run);
    observer.observe(document.body,{childList:true,subtree:true});
    const onClick=(event:MouseEvent)=>{
      const button=(event.target as HTMLElement|null)?.closest("button") as HTMLButtonElement|null;
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
  return null;
}
