"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./production-parking-locator.module.css";

type VehicleLocation={registration:string|null;workOrder:string|null;model:string|null;location:string;locationSourceModifiedAt:string|null;site:string|null};
type MapPoint={x:number;y:number;key:string;mode:"zone"|"proximity";note:string};
type LocatorResolution={point:MapPoint|null;satellite:string|null;reason:string|null};

const D_POINTS:Record<number,[number,number]>={1:[44.7,38.8],2:[41.2,38],3:[37.4,37],4:[33,36.1],5:[28.7,35],6:[24,34],7:[19.4,32],8:[44.6,34.8],9:[41.2,33.8],10:[37.3,33],11:[33,32],12:[28.7,31.2],13:[24,30.5],14:[19.4,29.7],15:[44.6,29],16:[40.9,27.9],17:[37.1,27],18:[33,26.2],19:[28.8,25.4],20:[24,24.7],21:[44.6,25.1],22:[40.8,23.8],23:[37,22.7],24:[33,21.8],25:[28.8,20.8],26:[43.4,17.8],27:[39.4,17.1],28:[35.4,16.3],29:[30.6,17.8],30:[43.4,14.9],31:[39.4,14.4],32:[35.3,13.8],33:[40.9,10.5],34:[35.8,9.7]};
const C_POINTS:Record<number,[number,number]>={1:[49.7,51.7],2:[50.3,46.5],3:[51,42.1],4:[51.7,37.5],5:[52.5,32.6],6:[45.4,36.1],7:[44.6,35.7],8:[46.1,28.4],9:[45.3,28],10:[46.5,20.2],11:[45.6,19.8],12:[47.1,13]};
const Z_POINTS:Record<number,[number,number]>={1:[78.9,87.4],2:[79.7,94.1],3:[70.9,86.8],4:[70.2,93.6]};
const V_POINTS:Record<number,[number,number]>={1:[46.4,62.7],2:[46,66.9],3:[45.6,71.1],4:[45.2,75.2]};

function normalize(value:string|null|undefined){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/Ã‰|Ã©/g,"E").toUpperCase().replace(/\s+/g," ").trim()}
function pointForToken(token:string):[number,number]|null{
  const a=token.match(/^A(\d{1,2})$/);if(a){const n=Number(a[1]);if(n===0)return[46.1,8.8];if(n>=1&&n<=14)return[55.9+(n-1)*2.35,6.5+(n-1)*.55]}
  const d=token.match(/^D(\d{1,2})$/);if(d)return D_POINTS[Number(d[1])]||null;
  const c=token.match(/^C(\d{1,2})$/);if(c)return C_POINTS[Number(c[1])]||null;
  const j=token.match(/^J(\d{1,2})$/);if(j){const n=Number(j[1]);if(n>=1&&n<=9)return[73.4-(n-1)*.08,49+(n-1)*3.35];if(n===10)return[72.1,78]}
  const ct=token.match(/^CT(\d{1,2})$/);if(ct){const n=Number(ct[1]);if(n>=1&&n<=9)return[84-(n-1)*.18,40.7+(n-1)*4.45]}
  const m=token.match(/^M(\d{1,2})$/);if(m){const n=Number(m[1]);if(n>=1&&n<=14)return[88.6+(n-1)*.2,38.8+(n-1)*4.05]}
  const z=token.match(/^Z(\d)$/);if(z)return Z_POINTS[Number(z[1])]||null;
  const v=token.match(/^V(\d)$/);if(v)return V_POINTS[Number(v[1])]||null;
  return null;
}
function resolveLocation(location:string,site:string|null):LocatorResolution{
  const raw=normalize(location),context=`${raw} ${normalize(site)}`;
  const satellites:Array<[RegExp,string]>=[[/\bSAINS\b/,"Sains-en-Gohelle"],[/\bWINGLES\b/,"Wingles"],[/\bHERSIN\b/,"Hersin-Coupigny"],[/\bLOOS\b/,"Loos-en-Gohelle"],[/\bBARLIN\b/,"Barlin"]];
  const satellite=satellites.find(([rx])=>rx.test(context));if(satellite)return{point:null,satellite:satellite[1],reason:"La position appartient à un site satellite qui n'est pas représenté sur le plan du parc CRVO Lens fourni."};
  if(/^(PREP|PREPA|PREP[A-Z]*)$/.test(raw))return{point:{x:79.8,y:57,key:"PRÉPA",mode:"zone",note:"Bâtiment Préparation / Qualité / Photo"},satellite:null,reason:null};
  if(/^(MECA|MECANIQUE)$/.test(raw)||/CHARGE EN MECA/.test(raw))return{point:{x:64.5,y:53,key:"MÉCA",mode:"proximity",note:"Atelier mécanique dans le bâtiment EFF · repère fonctionnel"},satellite:null,reason:null};
  if(/^LAVAGE$/.test(raw))return{point:{x:86,y:21,key:"LAVAGE",mode:"zone",note:"Zone lavage du parc Lens"},satellite:null,reason:null};
  const token=raw.match(/\b(CT(?:10|[1-9])|A(?:1[0-4]|[0-9])|D(?:3[0-4]|[12][0-9]|[1-9])|J(?:10|[1-9])|M(?:1[0-4]|[1-9])|Z[1-4]|C(?:1[0-2]|[1-9])|V[1-4])\b/)?.[1]||null;
  if(!token)return{point:null,satellite:null,reason:"Cette désignation existe dans le flux FTP mais n'est pas nommée sur le plan de parc fourni. Aucun emplacement fictif n'est affiché."};
  const coordinates=pointForToken(token);if(!coordinates)return{point:null,satellite:null,reason:`Le repère ${token} n'est pas cartographié sur la version actuelle du plan fourni.`};
  const proximity=/\bFACE\b|\bDEVANT\b|\bEN FACE\b|\bA COTE\b/.test(raw)||raw!==token;
  return{point:{x:coordinates[0],y:coordinates[1],key:token,mode:proximity?"proximity":"zone",note:proximity?`Repère de proximité autour de ${token}`:`Zone ${token} issue du relevé FTP`},satellite:null,reason:null};
}
function formatDate(value:string|null){if(!value)return"Horodatage non disponible";const date=new Date(value);if(Number.isNaN(date.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"Europe/Paris"}).format(date)}

function ParkingMapArt(){
  const zone=(label:string,x:number,y:number,w:number,h:number,tone:"blue"|"yellow"="blue",rotate=0)=><g key={`${label}-${x}-${y}`} transform={`rotate(${rotate} ${x+w/2} ${y+h/2})`} className={tone==="yellow"?styles.zoneGold:styles.zoneBlue}><path d={`M${x+7} ${y} H${x+w} V${y+h-6} L${x+w-7} ${y+h} H${x} V${y+6} Z`}/><path className={styles.zoneGloss} d={`M${x+8} ${y+3} H${x+w-4} V${y+7} H${x+5} Z`}/>{Array.from({length:Math.max(2,Math.floor(w/17))},(_,i)=><line key={i} x1={x+10+i*15} y1={y+h-8} x2={x+13+i*15} y2={y+h-2} className={styles.slotLine}/>) }<text x={x+w/2} y={y+h/2+4}>{label}</text></g>;
  const dLayout:Array<[string,number,number,number,number,number]>=[
    ["D34",385,95,58,40,-8],["D33",447,98,58,40,-5],["D32/D28",360,143,62,40,-8],["D31/D27",426,145,62,40,-5],["D30/D26",494,147,62,40,-2],
    ["D29",320,188,70,39,-12],["D25/D19",395,190,62,41,-9],["D24/D18",463,193,62,41,-6],["D23/D17",531,196,62,41,-3],["D22/D16",599,198,62,41,0],["D21/D15",667,200,62,41,2],
    ["D20",270,235,70,38,-12],["D14/D7",343,240,62,42,-9],["D13/D6",410,242,62,42,-6],["D12/D5",477,244,62,42,-3],["D11/D4",544,246,62,42,0],["D10/D3",611,248,62,42,2],["D9/D2",678,250,62,42,4],["D8/D1",745,252,62,42,5]
  ];
  return <svg className={styles.mapArt} viewBox="0 0 1200 820" preserveAspectRatio="xMidYMid meet" aria-label="Plan fidèle du CRVO Lens, rue Alexis Halette">
    <defs>
      <linearGradient id="asphalt" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#667078"/><stop offset=".45" stopColor="#535d64"/><stop offset="1" stopColor="#3a4349"/></linearGradient>
      <linearGradient id="roof" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d7dde0"/><stop offset=".45" stopColor="#b9c2c7"/><stop offset="1" stopColor="#8d9aa1"/></linearGradient>
      <linearGradient id="roofDark" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#59646b"/><stop offset="1" stopColor="#2f393f"/></linearGradient>
      <linearGradient id="road" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7e878d"/><stop offset="1" stopColor="#5a6369"/></linearGradient>
      <filter id="softShadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#03101a" floodOpacity=".42"/></filter>
      <filter id="outerBlur"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="surface"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="8"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .055 0"/></filter>
      <radialGradient id="siteGlow"><stop offset="0" stopColor="#173e57" stopOpacity=".16"/><stop offset=".75" stopColor="#07131d" stopOpacity=".04"/><stop offset="1" stopColor="#00101d" stopOpacity=".48"/></radialGradient>
    </defs>
    <rect width="1200" height="820" fill="#101a20"/>
    <g filter="url(#outerBlur)" opacity=".58"><path d="M-60 40 H1260 V155 H-60Z" fill="#36444b"/><path d="M-20 690 C150 620 240 690 350 720 S640 760 790 700 S1040 650 1240 720 V850 H-20Z" fill="#1f382c"/><path d="M1110 -20 H1240 V840 H1120Z" fill="#36444b"/></g>
    <path d="M15 126 C170 63 350 45 525 53 C730 62 920 83 1188 113" fill="none" stroke="#30383d" strokeWidth="70"/>
    <path d="M15 126 C170 63 350 45 525 53 C730 62 920 83 1188 113" fill="none" stroke="url(#road)" strokeWidth="58"/>
    <path d="M15 126 C170 63 350 45 525 53 C730 62 920 83 1188 113" fill="none" stroke="#cfd6d9" strokeOpacity=".55" strokeWidth="2" strokeDasharray="24 22"/>
    <path d="M1118 86 C1160 176 1150 311 1149 815" fill="none" stroke="#343c41" strokeWidth="64"/><path d="M1118 86 C1160 176 1150 311 1149 815" fill="none" stroke="url(#road)" strokeWidth="52"/>
    <path d="M0 550 C102 523 145 505 216 468" fill="none" stroke="#343c41" strokeWidth="62"/><path d="M0 550 C102 523 145 505 216 468" fill="none" stroke="url(#road)" strokeWidth="50"/>
    <text x="858" y="87" className={styles.mapRoad}>RUE ALEXIS HALETTE</text>
    <path d="M116 125 L257 96 L279 152 L145 189 Z" fill="url(#roofDark)" stroke="#8a969c" strokeWidth="3" filter="url(#softShadow)"/><text x="194" y="139" className={styles.mapBuilding}>BÂTIMENT</text><text x="194" y="154" className={styles.mapBuilding}>VOISIN</text>

    <path d="M579 127 L871 144 L839 788 L522 764 L527 181 Z" fill="url(#roof)" stroke="#6f7c83" strokeWidth="4" filter="url(#softShadow)"/>
    {Array.from({length:36},(_,i)=><rect key={`skylight-${i}`} x={568+(i%5)*49} y={198+Math.floor(i/5)*75} width="9" height="9" rx="1.5" fill="#eff4f5" opacity=".62"/>)}
    <text x="695" y="455" className={styles.mapEFF}>E F F</text>

    <path d="M864 323 L935 329 L918 686 L850 678 Z" fill="url(#roofDark)" stroke="#7b888e" strokeWidth="3" filter="url(#softShadow)"/>
    <text x="894" y="455" transform="rotate(92 894 455)" className={styles.mapFunction}>PRÉPARATION · QUALITÉ · PHOTO</text>

    <g filter="url(#softShadow)"><path d="M949 143 L1015 147 L1008 286 L944 282 Z" fill="#073c72" stroke="#b9eaff" strokeWidth="2"/><path d="M1043 180 L1092 184 L1087 296 L1039 292 Z" fill="#073c72" stroke="#b9eaff" strokeWidth="2"/></g>
    <text x="980" y="216" transform="rotate(91 980 216)" className={styles.mapLargeLabel}>LAVAGE</text><text x="1065" y="236" transform="rotate(91 1065 236)" className={styles.mapLargeLabel}>LAVAGE</text>

    {dLayout.map(([label,x,y,w,h,r])=>zone(label,x,y,w,h,"blue",r))}
    {zone("A0",512,89,118,24,"blue",4)}
    {Array.from({length:14},(_,i)=>zone(`A${i+1}`,670+i*28,82+i*.85,30,22,"blue",4))}
    {zone("C12",517,123,82,58,"yellow",6)}{zone("C10/C11",512,185,82,58,"yellow",5)}{zone("C9/C8",507,247,82,58,"yellow",4)}{zone("C7/C6",502,309,82,58,"yellow",3)}
    {zone("C5",618,290,64,45,"yellow",5)}{zone("C4",614,339,64,45,"yellow",4)}{zone("C3",610,388,64,45,"yellow",3)}{zone("C2",606,437,64,45,"yellow",2)}{zone("C1",602,486,64,45,"yellow",1)}
    <g className={styles.logisticSouth}>{zone("Z11",137,341,94,42,"yellow",4)}{zone("Z10",130,386,92,38,"yellow",4)}{zone("Z9",224,389,48,38,"yellow",4)}{zone("Z8",276,391,48,38,"yellow",4)}{zone("Z7/Z4",108,429,65,47,"yellow",5)}{zone("Z6/Z3",177,432,65,47,"yellow",4)}{zone("Z5/Z2",246,435,65,47,"yellow",3)}{zone("Z1",315,438,88,50,"yellow",2)}</g>

    {Array.from({length:10},(_,i)=>zone(`J${i+1}`,824,380+i*35,44,31,"blue",1))}
    <g>{Array.from({length:9},(_,i)=>zone(`CT${i+1}`,946,326+i*41,48,34,"blue",1))}</g>
    <g>{Array.from({length:14},(_,i)=>zone(`M${i+1}`,1013,329+i*33,48,29,"blue",1))}</g>
    {zone("Z3",819,712,64,44,"blue",2)}{zone("Z4",816,760,64,44,"blue",2)}{zone("Z1",895,717,64,44,"blue",2)}{zone("Z2",892,765,64,44,"blue",2)}
    {Array.from({length:4},(_,i)=>zone(`V${i+1}`,533,507+i*39,42,33,"blue",2))}

    <path d="M183 515 L265 485 L300 541 L217 569 Z" fill="#073c72" stroke="#d3f0fb" strokeWidth="2" filter="url(#softShadow)"/><text x="242" y="529" transform="rotate(-18 242 529)" className={styles.mapMAD}>MAD</text>

    <g filter="url(#softShadow)"><path d="M414 523 L472 516 L480 575 L422 582 Z" fill="url(#roofDark)" stroke="#88959a" strokeWidth="2"/><rect x="427" y="532" width="13" height="8" fill="#b9c4c8"/><rect x="448" y="530" width="13" height="8" fill="#b9c4c8"/></g><text x="448" y="550" className={styles.guardLabel}>POSTE</text><text x="448" y="563" className={styles.guardLabel}>DE GARDE</text>
    <g className={styles.visitorParking}><path d="M393 588 L489 579 L495 658 L401 666 Z" fill="#515a60" stroke="#8c9aa1" strokeWidth="2"/>{Array.from({length:6},(_,i)=><line key={`pv-${i}`} x1={405+i*14} y1="593" x2={410+i*14} y2="654"/>)}<text x="446" y="628">PARKING VISITEUR</text></g>
    <g filter="url(#softShadow)"><path d="M430 674 L493 670 L500 742 L435 748 Z" fill="url(#roofDark)" stroke="#87959a" strokeWidth="2"/>{[0,1,2,3].map(i=><rect key={i} x={443+(i%2)*25} y={690+Math.floor(i/2)*25} width="12" height="12" fill="#68757b"/> )}</g>
    <g className={styles.staffParking}><path d="M215 635 L398 612 L432 792 L245 811 Z" fill="#555e64" stroke="#87949a" strokeWidth="2"/>{Array.from({length:11},(_,i)=><line key={`staff-${i}`} x1={234+i*16} y1="649" x2={260+i*16} y2="788"/>)}<text x="330" y="724">PARKING DU PERSONNEL</text></g>

    <path d="M105 542 l11 -17 l11 17 z" fill="#d8eef8"/><text x="108" y="566" className={styles.accessLabel}>ACCÈS PRINCIPAL</text>
    <g className={styles.crvoLegend}><rect x="24" y="24" width="126" height="50" rx="8" className={styles.legendGold}/><text x="87" y="45">STOCKAGE</text><text x="87" y="60">LOGISTIQUE</text><rect x="24" y="83" width="126" height="50" rx="8" className={styles.legendBlue}/><text x="87" y="104">STOCKAGE</text><text x="87" y="119">USINE</text></g>
    <rect width="1200" height="820" fill="url(#siteGlow)" pointerEvents="none"/>
    <rect width="1200" height="820" filter="url(#surface)" pointerEvents="none" opacity=".8"/>
  </svg>;
}

function extractTriggerLocation(trigger:HTMLElement){const text=trigger.textContent?.trim()||"",strong=trigger.querySelector("strong")?.textContent?.trim();if(/^POSITION\s+/i.test(text))return text.replace(/^POSITION\s+/i,"").trim();if(strong&&strong!=="—")return strong;return text.split(" · ")[0].replace(/^POSITION\s+/i,"").trim()}
function isUsableLocation(value:string){return Boolean(value&&value!=="—"&&!/indisponible|non fournie/i.test(value))}

export default function ProductionParkingLocatorBridge(){
  const pathname=usePathname();const[vehicle,setVehicle]=useState<VehicleLocation|null>(null);const[loading,setLoading]=useState(false);const isProduction=pathname==="/developpement/production"||pathname.startsWith("/developpement/production/");const resolution=useMemo(()=>vehicle?resolveLocation(vehicle.location,vehicle.site):null,[vehicle]);
  useEffect(()=>{if(!isProduction)return;const decorate=()=>{
    document.querySelectorAll<HTMLElement>('[class*="drawerMeta"] span').forEach(el=>{const loc=extractTriggerLocation(el);if(/^Position\s+/i.test(el.textContent||"")&&isUsableLocation(loc)){el.classList.add(styles.locationTrigger);el.setAttribute("data-parking-location-trigger","true");el.setAttribute("title","Afficher la position sur le parc")}});
    document.querySelectorAll<HTMLElement>('[class*="drawerKpis"] > div').forEach(el=>{if(/^Localisation$/i.test(el.querySelector("span")?.textContent?.trim()||"")){const loc=extractTriggerLocation(el);if(isUsableLocation(loc)){el.classList.add(styles.locationTrigger,styles.kpiLocationTrigger);el.setAttribute("data-parking-location-trigger","true");el.setAttribute("title","Localiser ce véhicule sur le parc")}}});
    document.querySelectorAll<HTMLElement>('[class*="rawFields"] > div').forEach(row=>{if(/^Position$/i.test(row.querySelector("dt")?.textContent?.trim()||"")){const dd=row.querySelector<HTMLElement>("dd");if(dd){const loc=extractTriggerLocation(dd);if(isUsableLocation(loc)){dd.classList.add(styles.locationTrigger,styles.rawLocationTrigger);dd.setAttribute("data-parking-location-trigger","true");dd.setAttribute("title","Afficher la position sur le parc")}}}})
  };
  decorate();const observer=new MutationObserver(decorate);observer.observe(document.body,{childList:true,subtree:true});
  const click=async(event:MouseEvent)=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-parking-location-trigger="true"]'):null;if(!target)return;event.preventDefault();event.stopPropagation();const location=extractTriggerLocation(target);if(!isUsableLocation(location))return;const drawer=target.closest<HTMLElement>('aside[class*="drawer"]');const registration=drawer?.querySelector("header h2")?.textContent?.trim()||null;const model=drawer?.querySelector("header p")?.textContent?.trim()||null;const workOrder=Array.from(drawer?.querySelectorAll<HTMLElement>('[class*="drawerMeta"] span')||[]).find(el=>/^OR\s+/i.test(el.textContent||""))?.textContent?.replace(/^OR\s+/i,"").trim()||null;setVehicle({registration,workOrder,model,location,locationSourceModifiedAt:null,site:null});setLoading(true);const key=registration&&!/sans immatriculation/i.test(registration)?registration:workOrder;if(!key){setLoading(false);return}try{const response=await fetch(`/api/development/production?vehicle=${encodeURIComponent(key)}&_=${Date.now()}`,{cache:"no-store"});if(!response.ok)return;const data=await response.json(),found=data?.detail?.vehicle;if(found?.location)setVehicle({registration:found.registration||registration,workOrder:found.workOrder||workOrder,model:found.model||model,location:found.location,locationSourceModifiedAt:found.locationSourceModifiedAt||null,site:found.site||null})}catch{}finally{setLoading(false)}};
  document.addEventListener("click",click,true);return()=>{observer.disconnect();document.removeEventListener("click",click,true)}},[isProduction]);
  useEffect(()=>{if(!vehicle)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setVehicle(null)};document.addEventListener("keydown",close);const oldOverflow=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.removeEventListener("keydown",close);document.body.style.overflow=oldOverflow}},[vehicle]);
  if(!isProduction||!vehicle||!resolution)return null;
  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Localisation de ${vehicle.registration||"ce véhicule"}`}><button className={styles.backdrop} onClick={()=>setVehicle(null)} aria-label="Fermer la localisation"/><section className={styles.modal}><header className={styles.header}><div className={styles.titleBlock}><div className={styles.liveTag}><i/> LOCALISATION PARC</div><h2>{vehicle.registration||"Véhicule"}</h2><p>{vehicle.model||"Modèle non renseigné"}{vehicle.workOrder?` · OR ${vehicle.workOrder}`:""}</p></div><div className={styles.positionCard}><span>POSITION SOURCE</span><strong>{vehicle.location}</strong><small>{loading?"Actualisation du dernier relevé…":formatDate(vehicle.locationSourceModifiedAt)}</small></div><button className={styles.close} onClick={()=>setVehicle(null)} aria-label="Fermer">×</button></header><div className={styles.mapShell}><div className={styles.mapViewport}><div className={styles.mapCanvas}><ParkingMapArt/><div className={styles.mapTint}/><div className={styles.scanLine}/>{resolution.point&&<div className={styles.marker} style={{left:`${resolution.point.x}%`,top:`${resolution.point.y}%`}}><span className={styles.ringOne}/><span className={styles.ringTwo}/><span className={styles.ringThree}/><div className={styles.markerCore}><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 24l5-9c1-2 3-3 5-3h12c2 0 4 1 5 3l5 9 5 3c2 1 3 3 3 5v11c0 2-1 3-3 3h-2v3c0 2-1 3-3 3h-3c-2 0-3-1-3-3v-3H22v3c0 2-1 3-3 3h-3c-2 0-3-1-3-3v-3h-2c-2 0-3-1-3-3V32c0-2 1-4 3-5l5-3zm7-5l-3 7h24l-3-7c-.5-1-1-1-2-1H25c-1 0-2 0-2 1zm-6 13a4 4 0 100 8 4 4 0 000-8zm30 0a4 4 0 100 8 4 4 0 000-8z"/></svg></div><div className={styles.markerLabel}><span>VÉHICULE LOCALISÉ</span><strong>{vehicle.location}</strong><small>{resolution.point.note}</small></div></div>}{!resolution.point&&<div className={styles.unmappedCard}><div className={styles.unmappedIcon}>◎</div><span>{resolution.satellite?"HORS PLAN LENS":"REPÈRE NON CARTOGRAPHIÉ"}</span><strong>{resolution.satellite||vehicle.location}</strong><p>{resolution.reason}</p></div>}</div></div><aside className={styles.legendPanel}><div className={styles.legendHead}><span>LECTURE DU PLAN</span><b>CRVO LENS</b></div><div className={styles.legendRow}><i className={styles.blueLegend}/><div><strong>Stockage usine</strong><small>Zones bleues du calepinage Lens</small></div></div><div className={styles.legendRow}><i className={styles.yellowLegend}/><div><strong>Stockage logistique</strong><small>Zones jaunes du calepinage Lens</small></div></div><div className={styles.legendRow}><i className={styles.cyanLegend}/><div><strong>Repères bâtiment</strong><small>Préparation / Qualité / Photo + poste de garde</small></div></div><div className={styles.sourceNote}><span>RÉFÉRENCE SITE</span><p>CRVO Lens · Rue Alexis Halette · 62300 Lens. Les extérieurs du site sont volontairement floutés. Le parking visiteur est positionné entre le poste de garde et le bâtiment conservé.</p></div><div className={styles.sourceNote}><span>PRINCIPE DE FIABILITÉ</span><p>Le point est posé uniquement lorsqu'un repère du flux FTP existe réellement sur le plan. « Face / devant » reste un repère de proximité, jamais une place GPS exacte.</p></div></aside></div><footer className={styles.footer}><div><i className={styles.statusDot}/><span>Donnée de position issue du dernier État du Parc FTP disponible</span></div><div className={styles.footerPosition}><span>REPÈRE</span><strong>{resolution.point?.key||resolution.satellite||"NON CARTOGRAPHIÉ"}</strong></div></footer></section></div>;
}
