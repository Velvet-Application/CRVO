"use client";

import { useEffect } from "react";
import styles from "./expertise-3d-enhancer.module.css";

const PARTS = [
  ["Capot","CAPOT","hood"],["Pavillon","PAVILLON","roof"],["Hayon / coffre","HAYON","tailgate"],["Bouclier AV","BOUCLIER AV","frontBumper"],["Bouclier AR","BOUCLIER AR","rearBumper"],
  ["Porte AVG","PORTE AVG","leftFrontDoor"],["Porte ARG","PORTE ARG","leftRearDoor"],["Porte AVD","PORTE AVD","rightFrontDoor"],["Porte ARD","PORTE ARD","rightRearDoor"],
  ["Aile AVG","AILE AVG","leftFrontWing"],["Aile ARG","AILE ARG","leftRearWing"],["Aile AVD","AILE AVD","rightFrontWing"],["Aile ARD","AILE ARD","rightRearWing"],
  ["Pare-brise","PARE-BRISE","windshield"],["Rétroviseur AVG","RÉTRO G","leftMirror"],["Rétroviseur AVD","RÉTRO D","rightMirror"],
  ["Jante AVG","AVG","wheelFL"],["Jante AVD","AVD","wheelFR"],["Jante ARG","ARG","wheelRL"],["Jante ARD","ARD","wheelRR"],
] as const;

type DetailVehicle={
  client?:string|null;manufacturer?:string|null;model?:string|null;registration?:string|null;folderNumber?:string|null;workOrder?:string|null;vin?:string|null;mileage?:number|null;site?:string|null;location?:string|null;status?:string|null;
};

function findSvgGroup(svg: SVGSVGElement, expected: string) {
  const groups = Array.from(svg.querySelectorAll("g"));
  return groups.find((group) => group.querySelector("text")?.textContent?.trim().toUpperCase() === expected.toUpperCase()) ?? null;
}

function buildViewer(svg: SVGSVGElement) {
  const parent = svg.parentElement;
  if (!parent || parent.querySelector("[data-crvo-expertise-3d]")) return;

  const root = document.createElement("div");
  root.dataset.crvoExpertise3d = "1";
  root.className = styles.viewer;
  root.innerHTML = `
    <div class="${styles.head}"><div><strong>CARROSSERIE ÉCLATÉE 3D</strong><span>Glisser pour tourner à 360° · cliquer sur un élément pour déclarer le dommage</span></div><button type="button" data-reset>RECENTRER</button></div>
    <div class="${styles.stage}" data-stage>
      <div class="${styles.floor}"></div>
      <div class="${styles.scene}" data-scene>
        <div class="${styles.chassis}"><i class="${styles.cabin}"></i><i class="${styles.frameFront}"></i><i class="${styles.frameRear}"></i></div>
        ${PARTS.map(([zone,label,key])=>`<button type="button" class="${styles.part} ${styles[key]}" data-zone="${zone}" data-label="${label}"><span>${label}</span></button>`).join("")}
      </div>
      <div class="${styles.hint}">↔ GLISSER POUR TOURNER</div>
    </div>
    <div class="${styles.controls}"><button type="button" data-left>↶ 45°</button><button type="button" data-right>45° ↷</button></div>`;

  const stage = root.querySelector<HTMLElement>("[data-stage]");
  const scene = root.querySelector<HTMLElement>("[data-scene]");
  if (!stage || !scene) return;
  let yaw = -28;
  let pitch = -12;
  let drag: { x:number; y:number; yaw:number; pitch:number } | null = null;
  const render = () => { scene.style.transform = `rotateX(${pitch}deg) rotateY(${yaw}deg)`; };
  render();

  stage.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag = { x:event.clientX, y:event.clientY, yaw, pitch };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    yaw = drag.yaw + (event.clientX-drag.x)*.5;
    pitch = Math.max(-34,Math.min(18,drag.pitch-(event.clientY-drag.y)*.2));
    render();
  });
  const stop = (event: PointerEvent) => { drag=null; try{stage.releasePointerCapture(event.pointerId)}catch{} };
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);

  root.querySelector<HTMLElement>("[data-reset]")?.addEventListener("click",()=>{yaw=-28;pitch=-12;render();});
  root.querySelector<HTMLElement>("[data-left]")?.addEventListener("click",()=>{yaw-=45;render();});
  root.querySelector<HTMLElement>("[data-right]")?.addEventListener("click",()=>{yaw+=45;render();});
  root.querySelectorAll<HTMLButtonElement>("[data-zone]").forEach((button)=>button.addEventListener("click",()=>{
    const label = button.dataset.label || "";
    const group = findSvgGroup(svg,label);
    if (group) {
      group.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
      button.classList.add(styles.damaged);
    }
  }));

  svg.style.position = "absolute";
  svg.style.width = "1px";
  svg.style.height = "1px";
  svg.style.opacity = "0";
  svg.style.pointerEvents = "none";
  svg.setAttribute("aria-hidden","true");
  parent.insertBefore(root, svg.nextSibling);
}

function textValue(value:unknown){return typeof value==="string"&&value.trim()?value.trim():"—";}
function info(label:string,value:unknown){return `<article class="${styles.identityInfo}"><span>${label}</span><strong>${textValue(value)}</strong></article>`;}

async function enhanceIdentity(){
  const label=Array.from(document.querySelectorAll("span")).find((node)=>node.textContent?.trim()==="DOSSIER EXPERTISE");
  const header=label?.parentElement?.parentElement as HTMLElement|null;
  if(!header)return;
  const spans=Array.from(header.querySelectorAll("span")).map((node)=>node.textContent?.trim()||"");
  const vin=spans.find((value)=>value.startsWith("VIN "))?.slice(4).trim();
  const workOrder=spans.find((value)=>value.startsWith("OR "))?.slice(3).trim();
  const registration=header.querySelector("h2")?.textContent?.trim()||"";
  const vehicleId=(vin&&vin!=="—"?vin:workOrder&&workOrder!=="—"?workOrder:registration).trim();
  if(!vehicleId)return;
  const existing=header.parentElement?.querySelector<HTMLElement>("[data-crvo-mpf-identity]");
  if(existing?.dataset.vehicleKey===vehicleId)return;
  existing?.remove();

  const placeholder=document.createElement("section");
  placeholder.dataset.crvoMpfIdentity="1";
  placeholder.dataset.vehicleKey=vehicleId;
  placeholder.className=styles.identityPreamble;
  placeholder.innerHTML=`<div class="${styles.identityLoading}">Chargement identité dossier MPF…</div>`;
  header.parentElement?.insertBefore(placeholder,header);

  try{
    const response=await fetch(`/api/development/production?vehicle=${encodeURIComponent(vehicleId)}&_=${Date.now()}`,{cache:"no-store"});
    const payload=await response.json() as {detail?:{vehicle?:DetailVehicle}|null};
    const vehicle=payload.detail?.vehicle;
    if(!response.ok||!vehicle)throw new Error(`HTTP ${response.status}`);
    placeholder.innerHTML=`
      <div class="${styles.identityTitle}"><div><span>PRÉAMBULE · IDENTITÉ DOSSIER MPF</span><strong>Client & véhicule</strong></div><small>Données issues du miroir MPF / EtatduParc</small></div>
      <div class="${styles.identityHero}"><article><span>CLIENT / DONNEUR D'ORDRE</span><strong>${textValue(vehicle.client)}</strong></article><article><span>VÉHICULE</span><strong>${textValue(vehicle.manufacturer)} ${textValue(vehicle.model)==="—"?"":textValue(vehicle.model)}</strong><small>${textValue(vehicle.registration)}</small></article></div>
      <div class="${styles.identityGrid}">${info("Dossier MPF",vehicle.folderNumber)}${info("Ordre de réparation",vehicle.workOrder)}${info("VIN",vehicle.vin)}${info("Kilométrage",vehicle.mileage!=null?`${Math.round(Number(vehicle.mileage)).toLocaleString("fr-FR")} km`:null)}${info("Site",vehicle.site)}${info("Position",vehicle.location)}${info("Statut MPF",vehicle.status)}</div>`;
  }catch{
    placeholder.innerHTML=`<div class="${styles.identityLoading}">Identité MPF temporairement indisponible.</div>`;
  }
}

export default function Expertise3dEnhancer(){
  useEffect(()=>{
    const scan=()=>{
      if(window.location.pathname!=="/developpement/expertise")return;
      document.querySelectorAll<SVGSVGElement>('svg[aria-label="Vue véhicule interactive"]').forEach(buildViewer);
      void enhanceIdentity();
    };
    scan();
    const observer=new MutationObserver(scan);
    observer.observe(document.body,{childList:true,subtree:true});
    const timer=window.setInterval(scan,1500);
    return()=>{observer.disconnect();window.clearInterval(timer);};
  },[]);
  return null;
}
