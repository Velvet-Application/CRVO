"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import styles from "./production-parking-locator.module.css";

type VehicleLocation={registration:string|null;workOrder:string|null;model:string|null;location:string;locationSourceModifiedAt:string|null;site:string|null};
type MapPoint={x:number;y:number;key:string;mode:"zone"|"proximity";note:string};
type LocatorResolution={point:MapPoint|null;satellite:string|null;reason:string|null};

const ZONE_POINTS:Record<string,[number,number]>={"A0":[42.44,11.75],"A1":[53.21,7.39],"A2":[55.87,7.38],"A3":[58.53,7.37],"A4":[61.18,7.36],"A5":[63.83,7.35],"A6":[66.47,7.35],"A7":[69.1,7.34],"A8":[71.73,7.33],"A9":[74.35,7.32],"A10":[76.97,7.31],"A11":[79.58,7.3],"A12":[82.18,7.29],"A13":[84.78,7.28],"A14":[87.38,7.27],"C1":[53.72,46.04],"C2":[53.75,41.09],"C3":[53.71,37.34],"C4":[53.55,29.02],"C5":[53.6,33.28],"C6":[43.76,36.17],"C7":[43.76,36.17],"C8":[43.76,28.83],"C9":[43.76,28.83],"C10":[43.6,21.9],"C11":[43.6,21.9],"C12":[43.78,15.73],"CT1":[89.99,28.77],"CT2":[90.03,33.0],"CT3":[90.07,37.23],"CT4":[90.1,41.46],"CT5":[90.14,45.7],"CT6":[90.18,49.94],"CT7":[90.21,54.18],"CT8":[90.25,58.42],"CT9":[90.29,62.66],"D1":[36.96,36.36],"D2":[33.26,36.48],"D3":[29.49,36.51],"D4":[25.76,36.51],"D5":[21.85,36.57],"D6":[17.77,36.67],"D7":[12.66,37.17],"D8":[36.96,36.36],"D9":[33.26,36.48],"D10":[29.49,36.51],"D11":[25.76,36.51],"D12":[21.85,36.57],"D13":[17.77,36.67],"D14":[12.66,37.17],"D15":[36.95,29.07],"D16":[33.19,29.09],"D17":[29.51,29.29],"D18":[25.57,29.33],"D19":[21.83,29.42],"D20":[18.0,29.94],"D21":[36.95,29.07],"D22":[33.19,29.09],"D23":[29.51,29.29],"D24":[25.57,29.33],"D25":[21.83,29.42],"D26":[36.91,22.18],"D27":[33.2,22.16],"D28":[29.5,22.15],"D29":[25.24,22.85],"D30":[36.91,22.18],"D31":[33.2,22.16],"D32":[29.5,22.15],"D33":[35.98,15.88],"D34":[30.98,16.39],"J1":[78.74,37.76],"J2":[78.76,40.21],"J3":[78.78,42.67],"J4":[78.79,45.12],"J5":[78.81,47.58],"J6":[78.83,50.04],"J7":[78.85,52.5],"J8":[78.86,54.96],"J9":[78.88,57.42],"J10":[80.52,62.68],"M1":[94.03,26.22],"M2":[94.07,30.08],"M3":[94.1,33.94],"M4":[94.14,37.81],"M5":[94.17,41.67],"M6":[94.21,45.54],"M7":[94.25,49.41],"M8":[94.28,53.28],"M9":[94.32,57.15],"M10":[94.35,61.03],"M11":[94.39,64.91],"M12":[94.42,68.79],"M13":[94.46,72.67],"M14":[94.5,76.55],"V1":[49.75,56.5],"V2":[49.76,59.84],"V3":[49.77,63.19],"V4":[49.78,66.53],"Z1":[89.54,68.75],"Z2":[89.59,74.64],"Z3":[80.8,69.1],"Z4":[80.84,75.0],"Z11":[19.57,50.11],"Z12":[14.24,50.9],"Z13":[10.36,51.05],"Z14":[6.35,51.13],"Z15":[14.24,50.9],"Z16":[10.36,51.05],"Z17":[6.35,51.13],"Z18":[23.56,43.84],"Z19":[19.69,45.29],"Z110":[15.72,45.34],"Z111":[11.75,45.44],"Z112":[7.77,45.64],"Z113":[23.56,43.84]};

function normalize(value:string|null|undefined){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/Ã‰|Ã©/g,"E").toUpperCase().replace(/\s+/g," ").trim()}
function pointForToken(token:string):[number,number]|null{return ZONE_POINTS[token]||null}

function resolveLocation(location:string,site:string|null):LocatorResolution{
  const raw=normalize(location),context=`${raw} ${normalize(site)}`;
  const satellites:Array<[RegExp,string]>=[[/\bSAINS\b/,"Sains-en-Gohelle"],[/\bWINGLES\b/,"Wingles"],[/\bHERSIN\b/,"Hersin-Coupigny"],[/\bLOOS\b/,"Loos-en-Gohelle"],[/\bBARLIN\b/,"Barlin"]];
  const satellite=satellites.find(([rx])=>rx.test(context));
  if(satellite)return{point:null,satellite:satellite[1],reason:"La position appartient à un site satellite qui n'est pas représenté sur la vue aérienne du CRVO Lens."};
  if(/^(PREP|PREPA|PREP[A-Z]*)$/.test(raw))return{point:{x:85.8,y:49,key:"PRÉPA",mode:"zone",note:"Bâtiment Préparation / Qualité / Photo"},satellite:null,reason:null};
  if(/^(MECA|MECANIQUE)$/.test(raw)||/CHARGE EN MECA/.test(raw))return{point:{x:52.5,y:54,key:"MÉCA",mode:"proximity",note:"Repère fonctionnel Expertise / Mécanique / Carrosserie / Magasin"},satellite:null,reason:null};
  if(/^LAVAGE$/.test(raw))return{point:{x:86.2,y:16.02,key:"LAVAGE",mode:"zone",note:"Zone lavage du parc Lens"},satellite:null,reason:null};
  const token=raw.match(/\b(CT[1-9]|A(?:1[0-4]|[0-9])|D(?:3[0-4]|[12][0-9]|[1-9])|J(?:10|[1-9])|M(?:1[0-4]|[1-9])|Z(?:11[0-3]|1[1-9]|[1-4])|C(?:1[0-2]|[1-9])|V[1-4])\b/)?.[1]||null;
  if(!token)return{point:null,satellite:null,reason:"Cette désignation existe dans le flux FTP mais n'est pas encore rattachée à un repère du calepinage. Aucun emplacement fictif n'est affiché."};
  const coordinates=pointForToken(token);
  if(!coordinates)return{point:null,satellite:null,reason:`Le repère ${token} n'est pas cartographié sur la version actuelle du calepinage.`};
  const proximity=/\bFACE\b|\bDEVANT\b|\bEN FACE\b|\bA COTE\b/.test(raw)||raw!==token;
  return{point:{x:coordinates[0],y:coordinates[1],key:token,mode:proximity?"proximity":"zone",note:proximity?`Repère de proximité autour de ${token}`:`Position ${token} issue du calepinage CRVO`},satellite:null,reason:null};
}

function formatDate(value:string|null){
  if(!value)return"Horodatage non disponible";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value;
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Europe/Paris"}).format(date)
}

function extractTriggerLocation(trigger:HTMLElement){
  const text=trigger.textContent?.trim()||"",strong=trigger.querySelector("strong")?.textContent?.trim();
  if(/^POSITION\s+/i.test(text))return text.replace(/^POSITION\s+/i,"").trim();
  if(strong&&strong!=="—")return strong;
  return text.split(" · ")[0].replace(/^POSITION\s+/i,"").trim()
}
function isUsableLocation(value:string){return Boolean(value&&value!=="—"&&!/indisponible|non fournie/i.test(value))}

export default function ProductionParkingLocatorBridge(){
  const pathname=usePathname();
  const[vehicle,setVehicle]=useState<VehicleLocation|null>(null);
  const[loading,setLoading]=useState(false);
  const isProduction=pathname==="/developpement/production"||pathname.startsWith("/developpement/production/");
  const resolution=useMemo(()=>vehicle?resolveLocation(vehicle.location,vehicle.site):null,[vehicle]);

  useEffect(()=>{
    if(!isProduction)return;
    const decorate=()=>{
      document.querySelectorAll<HTMLElement>('[class*="drawerMeta"] span').forEach(el=>{
        const loc=extractTriggerLocation(el);
        if(/^Position\s+/i.test(el.textContent||"")&&isUsableLocation(loc)){
          el.classList.add(styles.locationTrigger);
          el.setAttribute("data-parking-location-trigger","true");
          el.setAttribute("title","Afficher la position sur le parc")
        }
      });
      document.querySelectorAll<HTMLElement>('[class*="drawerKpis"] > div').forEach(el=>{
        if(/^Localisation$/i.test(el.querySelector("span")?.textContent?.trim()||"")){
          const loc=extractTriggerLocation(el);
          if(isUsableLocation(loc)){
            el.classList.add(styles.locationTrigger,styles.kpiLocationTrigger);
            el.setAttribute("data-parking-location-trigger","true");
            el.setAttribute("title","Localiser ce véhicule sur le parc")
          }
        }
      });
      document.querySelectorAll<HTMLElement>('[class*="rawFields"] > div').forEach(row=>{
        if(/^Position$/i.test(row.querySelector("dt")?.textContent?.trim()||"")){
          const dd=row.querySelector<HTMLElement>("dd");
          if(dd){
            const loc=extractTriggerLocation(dd);
            if(isUsableLocation(loc)){
              dd.classList.add(styles.locationTrigger,styles.rawLocationTrigger);
              dd.setAttribute("data-parking-location-trigger","true");
              dd.setAttribute("title","Afficher la position sur le parc")
            }
          }
        }
      })
    };
    decorate();
    const observer=new MutationObserver(decorate);
    observer.observe(document.body,{childList:true,subtree:true});
    const click=async(event:MouseEvent)=>{
      const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-parking-location-trigger="true"]'):null;
      if(!target)return;
      event.preventDefault();event.stopPropagation();
      const location=extractTriggerLocation(target);
      if(!isUsableLocation(location))return;
      const drawer=target.closest<HTMLElement>('aside[class*="drawer"]');
      const registration=drawer?.querySelector("header h2")?.textContent?.trim()||null;
      const model=drawer?.querySelector("header p")?.textContent?.trim()||null;
      const workOrder=Array.from(drawer?.querySelectorAll<HTMLElement>('[class*="drawerMeta"] span')||[]).find(el=>/^OR\s+/i.test(el.textContent||""))?.textContent?.replace(/^OR\s+/i,"").trim()||null;
      setVehicle({registration,workOrder,model,location,locationSourceModifiedAt:null,site:null});
      setLoading(true);
      const key=registration&&!/sans immatriculation/i.test(registration)?registration:workOrder;
      if(!key){setLoading(false);return}
      try{
        const response=await fetch(`/api/development/production?vehicle=${encodeURIComponent(key)}&_=${Date.now()}`,{cache:"no-store"});
        if(!response.ok)return;
        const data=await response.json(),found=data?.detail?.vehicle;
        if(found?.location)setVehicle({registration:found.registration||registration,workOrder:found.workOrder||workOrder,model:found.model||model,location:found.location,locationSourceModifiedAt:found.locationSourceModifiedAt||null,site:found.site||null})
      }catch{}finally{setLoading(false)}
    };
    document.addEventListener("click",click,true);
    return()=>{observer.disconnect();document.removeEventListener("click",click,true)}
  },[isProduction]);

  useEffect(()=>{
    if(!vehicle)return;
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setVehicle(null)};
    document.addEventListener("keydown",close);
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.removeEventListener("keydown",close);document.body.style.overflow=oldOverflow}
  },[vehicle]);

  if(!isProduction||!vehicle||!resolution)return null;

  const aerialStyle:CSSProperties={
    backgroundImage:'url("/crvo-lens-aerial-source.jpeg")',
    backgroundPosition:"center",
    backgroundSize:"100% 100%",
    backgroundRepeat:"no-repeat"
  };

  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Localisation de ${vehicle.registration||"ce véhicule"}`}>
    <button className={styles.backdrop} onClick={()=>setVehicle(null)} aria-label="Fermer la localisation"/>
    <section className={styles.modal}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={styles.liveTag}><i/> LOCALISATION PARC</div>
          <h2>{vehicle.registration||"Véhicule"}</h2>
          <p>{vehicle.model||"Modèle non renseigné"}{vehicle.workOrder?` · OR ${vehicle.workOrder}`:""}</p>
        </div>
        <div className={styles.positionCard}>
          <span>POSITION SOURCE</span><strong>{vehicle.location}</strong>
          <small>{loading?"Actualisation du dernier relevé…":formatDate(vehicle.locationSourceModifiedAt)}</small>
        </div>
        <button className={styles.close} onClick={()=>setVehicle(null)} aria-label="Fermer">×</button>
      </header>

      <div className={styles.mapShell}>
        <div className={styles.mapViewport}>
          <div className={styles.mapCanvas} style={aerialStyle}>
            <div className={styles.scanLine}/>
            {resolution.point&&<div className={styles.marker} style={{left:`${resolution.point.x}%`,top:`${resolution.point.y}%`}}>
              <span className={styles.ringOne}/><span className={styles.ringTwo}/><span className={styles.ringThree}/>
              <div className={styles.markerCore}><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 24l5-9c1-2 3-3 5-3h12c2 0 4 1 5 3l5 9 5 3c2 1 3 3 3 5v11c0 2-1 3-3 3h-2v3c0 2-1 3-3 3h-3c-2 0-3-1-3-3v-3H22v3c0 2-1 3-3 3h-3c-2 0-3-1-3-3v-3h-2c-2 0-3-1-3-3V32c0-2 1-4 3-5l5-3zm7-5l-3 7h24l-3-7c-.5-1-1-1-2-1H25c-1 0-2 0-2 1zm-6 13a4 4 0 100 8 4 4 0 000-8zm30 0a4 4 0 100 8 4 4 0 000-8z"/></svg></div>
              <div className={styles.markerLabel}><span>VÉHICULE LOCALISÉ</span><strong>{vehicle.location}</strong><small>{resolution.point.note}</small></div>
            </div>}
            {!resolution.point&&<div className={styles.unmappedCard}><div className={styles.unmappedIcon}>◎</div><span>{resolution.satellite?"HORS PLAN LENS":"REPÈRE NON CARTOGRAPHIÉ"}</span><strong>{resolution.satellite||vehicle.location}</strong><p>{resolution.reason}</p></div>}
          </div>
        </div>

        <aside className={styles.legendPanel}>
          <div className={styles.legendHead}><span>CALAGE INTERNE</span><b>CRVO LENS</b></div>
          <div className={styles.sourceNote}><span>VUE AÉRIENNE</span><p>Photo originale fournie par l’utilisateur, affichée sans reconstruction et sans zonage visible.</p></div>
          <div className={styles.sourceNote}><span>CALEPINAGE INVISIBLE</span><p>Les zones du plan parking sont utilisées uniquement pour calculer les coordonnées du marqueur. Elles ne sont jamais dessinées sur la carte.</p></div>
          <div className={styles.sourceNote}><span>PRINCIPE DE FIABILITÉ</span><p>Le point est affiché uniquement quand le repère FTP correspond à une zone identifiée du calepinage. « Face / devant » reste un repère de proximité.</p></div>
        </aside>
      </div>

      <footer className={styles.footer}>
        <div><i className={styles.statusDot}/><span>Donnée de position issue du dernier État du Parc FTP disponible</span></div>
        <div className={styles.footerPosition}><span>REPÈRE</span><strong>{resolution.point?.key||resolution.satellite||"NON CARTOGRAPHIÉ"}</strong></div>
      </footer>
    </section>
  </div>;
}
