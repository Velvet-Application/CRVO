"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./expertise.module.css";
import { EXPERTISE_FORFAITS, GRADE_RULES, REPAIR_METHODS, type GradeKey, type ExpertiseForfait } from "./expertise-data";

type Vehicle={
  registration:string|null;workOrder:string|null;client:string|null;vin:string|null;model:string|null;mileage:number;status:string;statusAgeDays:number;factoryAgeDays:number;
  alert:string|null;urgency:string|null;location:string|null;locationSourceModifiedAt:string|null;sourceType:string;processProfile:"EFF"|"BMW"|"AUTRE"|"EXCLU";inFactory:boolean;
};
type Payload={connected:boolean;sourceModifiedAt:string|null;locationSourceModifiedAt:string|null;vehicles:Vehicle[];error?:string};
type FileRef={id:string;name:string;type:string;createdAt:string};
type Damage={
  id:string;zone:string;zoneLevel:""|"HAUTE"|"BASSE";type:string;description:string;sizeCm:string;method:string;paintFinish:""|"AVEC_DIFF"|"SANS_DIFF";
  forfaitId:string;manualLabel:string;manualHt:string;photos:FileRef[];
};
type GeneralSection={
  maintenanceHistory:""|"OUI"|"NON"|"INCONNU";historyComment:string;generalComment:string;
  exteriorPhotos:FileRef[];interiorPhotos:FileRef[];maintenanceDocuments:FileRef[];otherDocuments:FileRef[];
};
type Tyre={position:"AVG"|"AVD"|"ARG"|"ARD";brand:string;dimension:string;treadMm:string;status:""|"OK"|"SURVEILLER"|"REMPLACER";runflat:boolean};
type MechanicsSection={
  category:""|"A"|"B"|"C";serviceDue:""|"OUI"|"NON";serviceForfaitId:string;
  tyres:Tyre[];tyreForfaitId:string;
  brakeFront:""|"OK"|"PLAQUETTES"|"DISQUES_PLAQUETTES";brakeRear:""|"OK"|"PLAQUETTES"|"DISQUES_PLAQUETTES";
  brakeFrontForfaitId:string;brakeRearForfaitId:string;
  shockFront:""|"OK"|"FUITE"|"JEU"|"REMPLACER";shockRear:""|"OK"|"FUITE"|"JEU"|"REMPLACER";shockManualHt:string;notes:string;
};
type ExpertiseRecord={vehicleKey:string;grade:GradeKey|null;general:GeneralSection;mechanics:MechanicsSection;damages:Damage[];status:"draft"|"completed";updatedAt:string};
type ExpertiseStore=Record<string,ExpertiseRecord>;
type FileBucket="exteriorPhotos"|"interiorPhotos"|"maintenanceDocuments"|"otherDocuments";
type ElementFamily="wheel"|"glass"|"mirror"|"bumper"|"roof"|"simple"|"complex"|"interior"|"other";

const STORE_KEY="crvo-expertise-sandbox-v1";
const PHOTO_DB="crvo-expertise-dev-photos-v1";
const PHOTO_STORE="photos";
const TYRE_POSITIONS:Tyre["position"][]=["AVG","AVD","ARG","ARD"];
const MECHANIC_CATEGORIES={A:"Catégorie A · Petites citadines",B:"Catégorie B · Véhicules courants",C:"Catégorie C · Sportives / gros SUV"} as const;
const BODY_ZONES=["Bouclier AV","Capot","Aile AVG","Porte AVG","Porte ARG","Aile ARG","Hayon / coffre","Aile ARD","Porte ARD","Porte AVD","Aile AVD","Bouclier AR","Pavillon","Pare-brise","Rétroviseur AVG","Rétroviseur AVD","Jante AVG","Jante AVD","Jante ARG","Jante ARD","Intérieur"] as const;
const METHOD_LABELS:Record<string,string>=Object.fromEntries([...REPAIR_METHODS.map(item=>[item.id,item.label]),["LUSTRAGE","Lustrage / correction légère"]]);

function vehicleKey(v:Vehicle){return String(v.vin||v.registration||v.workOrder||`${v.client}-${v.model}`);}
function money(value:number){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(value);}
function fmtDate(value?:string|null){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function isExpertiseStatus(status:string){return /réception|reception|expert|lavage|chiffr|devis|validation/.test(status.toLowerCase());}
function emptyTyres():Tyre[]{return TYRE_POSITIONS.map(position=>({position,brand:"",dimension:"",treadMm:"",status:"",runflat:false}));}
function emptyGeneral():GeneralSection{return{maintenanceHistory:"",historyComment:"",generalComment:"",exteriorPhotos:[],interiorPhotos:[],maintenanceDocuments:[],otherDocuments:[]};}
function emptyMechanics():MechanicsSection{return{category:"",serviceDue:"",serviceForfaitId:"",tyres:emptyTyres(),tyreForfaitId:"",brakeFront:"",brakeRear:"",brakeFrontForfaitId:"",brakeRearForfaitId:"",shockFront:"",shockRear:"",shockManualHt:"",notes:""};}
function emptyRecord(key:string):ExpertiseRecord{return{vehicleKey:key,grade:null,general:emptyGeneral(),mechanics:emptyMechanics(),damages:[],status:"draft",updatedAt:new Date().toISOString()};}
function normalizeRecord(value:Partial<ExpertiseRecord>|undefined,key:string):ExpertiseRecord{
  const base=emptyRecord(key);if(!value)return base;
  return{...base,...value,vehicleKey:key,general:{...base.general,...(value.general||{})},mechanics:{...base.mechanics,...(value.mechanics||{}),tyres:Array.isArray(value.mechanics?.tyres)&&value.mechanics!.tyres.length?value.mechanics!.tyres:base.mechanics.tyres},damages:Array.isArray(value.damages)?value.damages:[]};
}
function familyForZone(zone:string):ElementFamily{
  if(/^Jante/i.test(zone))return"wheel";
  if(/Pare-brise/i.test(zone))return"glass";
  if(/Rétroviseur/i.test(zone))return"mirror";
  if(/Bouclier/i.test(zone))return"bumper";
  if(/Pavillon/i.test(zone))return"roof";
  if(/Capot|Aile AR/i.test(zone))return"complex";
  if(/Aile AV|Porte|Hayon/i.test(zone))return"simple";
  if(/Intérieur/i.test(zone))return"interior";
  return"other";
}
function damageTypesForZone(zone:string){
  const family=familyForZone(zone);
  if(family==="wheel")return["Rayure / frottement","Coup / choc","Déformation / voile","Vernis / peinture endommagé","Cassée / irréparable"];
  if(family==="glass")return["Impact","Fissure","Multi-impact","Rayure vitrage","Autre défaut vitrage"];
  if(family==="mirror")return["Rayure / griffe","Coup / choc","Coquille cassée","Glace endommagée","Clignotant / équipement endommagé"];
  if(family==="interior")return["Tache / salissure","Griffe","Déchirure","Brûlure","Élément cassé / manquant"];
  if(family==="bumper")return["Rayure / griffe","Coup / enfoncement","Bosse","Impact / gravillonnage","Fissure","Déchirure / percement","Élément texturé endommagé"];
  return["Rayure / griffe","Coup / enfoncement","Bosse","Impact / gravillonnage","Déformation","Éclat peinture","Corrosion"];
}
function methodsForZone(zone:string){
  const family=familyForZone(zone);
  if(family==="wheel")return["JANTE","REMPLACEMENT","SURVEILLANCE","HORS_FORFAIT"];
  if(family==="glass")return["PARE_BRISE","REMPLACEMENT","SURVEILLANCE","HORS_FORFAIT"];
  if(family==="interior")return["REMPLACEMENT","SURVEILLANCE","HORS_FORFAIT"];
  if(family==="mirror")return["LUSTRAGE","PEINTURE","PLUME","REMPLACEMENT","SURVEILLANCE","HORS_FORFAIT"];
  return["LUSTRAGE","DSP","PEINTURE","PLUME","REMPLACEMENT","SURVEILLANCE","HORS_FORFAIT"];
}
function paintForfaitIds(zone:string){
  const family=familyForZone(zone);
  if(family==="roof")return["forfait-55","forfait-58"];
  if(family==="mirror")return["forfait-56","forfait-58"];
  if(family==="complex")return["forfait-51","forfait-54","forfait-58"];
  if(family==="bumper")return["forfait-51","forfait-52","forfait-53","forfait-57","forfait-58"];
  if(family==="simple")return["forfait-51","forfait-52","forfait-53","forfait-58"];
  return[];
}
function defaultMethodForZone(zone:string){const family=familyForZone(zone);return family==="wheel"?"JANTE":family==="glass"?"PARE_BRISE":"";}
function newDamage(zone=""):Damage{return{id:crypto.randomUUID(),zone,zoneLevel:"",type:"",description:"",sizeCm:"",method:defaultMethodForZone(zone),paintFinish:"",forfaitId:"",manualLabel:"",manualHt:"",photos:[]};}
function forfaitById(id:string){return EXPERTISE_FORFAITS.find(item=>item.id===id)||null;}
function lineHt(damage:Damage){const forfait=forfaitById(damage.forfaitId);if(forfait)return forfait.ht;const manual=Number(String(damage.manualHt).replace(",","."));return Number.isFinite(manual)?Math.max(0,manual):0;}
function lineTtc(damage:Damage){const forfait=forfaitById(damage.forfaitId);if(forfait)return forfait.ttc;return lineHt(damage)*1.2;}
function forfaitsForDamage(damage:Damage):ExpertiseForfait[]{
  if(!damage.zone)return[];
  if(damage.method==="JANTE")return EXPERTISE_FORFAITS.filter(f=>f.section==="JANTE");
  if(damage.method==="PARE_BRISE")return EXPERTISE_FORFAITS.filter(f=>f.id==="forfait-50");
  if(damage.method==="DSP")return EXPERTISE_FORFAITS.filter(f=>f.section.trim()==="DSP");
  if(damage.method==="PLUME")return EXPERTISE_FORFAITS.filter(f=>f.id==="forfait-59");
  if(damage.method==="PEINTURE"){const ids=new Set(paintForfaitIds(damage.zone));return EXPERTISE_FORFAITS.filter(f=>ids.has(f.id));}
  return[];
}
function mechanicForfaits(kind:"service"|"tyre"|"brake",category:MechanicsSection["category"]){
  if(kind==="tyre")return EXPERTISE_FORFAITS.filter(f=>f.section==="MECANIQUE"&&/Montage et équilibrage|géométrie/i.test(f.label));
  if(!category)return[];
  const marker=`CATÉGORIE ${category}`;
  return EXPERTISE_FORFAITS.filter(f=>f.section==="MECANIQUE"&&f.category?.startsWith(marker)&&(kind==="service"?/Révision simple|Révision intermédiaire|Révision complète/i.test(f.label):/plaquettes|disques & plaquettes/i.test(f.label)));
}
function selectedForfaitTotal(ids:string[]){return ids.reduce((sum,id)=>sum+(forfaitById(id)?.ht||0),0);}
function gradeGuidance(grade:GradeKey|null,damage:Damage){
  if(!grade)return{tone:"warn" as const,text:"Sélectionnez le grade pour contrôler la cohérence de la remise en état."};
  const method=damage.method,level=damage.zoneLevel,size=Number(String(damage.sizeCm).replace(",","."));
  const family=familyForZone(damage.zone);
  if(grade==="ECO"&&!["wheel","glass","interior"].includes(family)&&["DSP","PEINTURE","PLUME","LUSTRAGE"].includes(method))return{tone:"warn" as const,text:"Grade Éco : pas de carrosserie. Le référentiel demande seulement le chiffrage des éléments pouvant bloquer une vente."};
  if((grade==="ECO"||grade==="BRONZE")&&method==="JANTE")return{tone:"warn" as const,text:`${GRADE_RULES[grade].label} : pas de réparation jante selon le cahier des charges fourni.`};
  if(method==="LUSTRAGE")return{tone:"ok" as const,text:"Le lustrage est prévu comme geste de diagnostic / correction légère dans le cahier des charges, mais aucun forfait de lustrage n'existe dans la Grille tarifaire 2026 : montant à paramétrer ou chiffrer manuellement."};
  if(method==="DSP"&&["OR","ARGENT","BRONZE"].includes(grade))return{tone:"ok" as const,text:`${GRADE_RULES[grade].label} : DSP admis sur zones haute et basse.`};
  if(method==="PLUME"){
    if(grade==="BRONZE"&&level==="BASSE")return{tone:"warn" as const,text:"Grade Bronze : retouche plume NON admise en zone basse."};
    if(grade==="ECO")return{tone:"warn" as const,text:"Grade Éco : retouche plume NON admise."};
    return{tone:"ok" as const,text:`${GRADE_RULES[grade].label} : retouche plume compatible sous réserve du contrôle de zone et du défaut.`};
  }
  if(method==="PEINTURE"&&level&&damage.paintFinish){
    if(grade==="BRONZE"){
      if(damage.paintFinish==="SANS_DIFF")return{tone:"warn" as const,text:"Grade Bronze : réparation carrosserie sans différence de teinte = NON."};
      return{tone:size&&size<=5?"warn":"ok" as const,text:"Grade Bronze : réparation avec différence de teinte uniquement au-delà de 5 cm."};
    }
    const thresholds=grade==="ARGENT"?(damage.paintFinish==="AVEC_DIFF"?{HAUTE:1,BASSE:2}:{HAUTE:2,BASSE:4}):(damage.paintFinish==="SANS_DIFF"?{HAUTE:1,BASSE:2}:{HAUTE:0,BASSE:0});
    const threshold=thresholds[level];
    return{tone:size&&size<=threshold?"warn":"ok" as const,text:`${GRADE_RULES[grade].label} : seuil du référentiel ${threshold===0?"toutes rayures":`> ${threshold} cm`} en ${level==="HAUTE"?"zone haute":"zone basse"}.`};
  }
  if(method==="PARE_BRISE")return{tone:"ok" as const,text:"Pare-brise : réparation si impact < 2 cm ou fissure < 6 cm ; les critères de remplacement restent à contrôler."};
  return{tone:"ok" as const,text:`Décision à contrôler avec le ${GRADE_RULES[grade].label}.`};
}
function photoDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(PHOTO_DB,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(PHOTO_STORE))request.result.createObjectStore(PHOTO_STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function putFile(id:string,file:File){const db=await photoDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,"readwrite");tx.objectStore(PHOTO_STORE).put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}
async function getFile(id:string){const db=await photoDb();const blob=await new Promise<Blob|null>((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,"readonly");const req=tx.objectStore(PHOTO_STORE).get(id);req.onsuccess=()=>resolve(req.result instanceof Blob?req.result:null);req.onerror=()=>reject(req.error);});db.close();return blob;}
async function removeFile(id:string){const db=await photoDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,"readwrite");tx.objectStore(PHOTO_STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}

export default function ExpertiseDevelopmentPage(){
  const [payload,setPayload]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [queueMode,setQueueMode]=useState<"expertise"|"all">("expertise");
  const [selectedKey,setSelectedKey]=useState<string|null>(null);
  const [records,setRecords]=useState<ExpertiseStore>({});
  const [storeReady,setStoreReady]=useState(false);
  const [fileUrls,setFileUrls]=useState<Record<string,string>>({});
  const [clientPreview,setClientPreview]=useState(false);

  async function load(){setLoading(true);try{const r=await fetch(`/api/development/production?_=${Date.now()}`,{cache:"no-store"});const data=await r.json() as Payload;if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);setPayload(data);setError("");}catch(e){setError(e instanceof Error?e.message:"Reflet FTP indisponible");}finally{setLoading(false);}}
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{try{const raw=localStorage.getItem(STORE_KEY);if(raw){const parsed=JSON.parse(raw) as Record<string,Partial<ExpertiseRecord>>;setRecords(Object.fromEntries(Object.entries(parsed).map(([key,value])=>[key,normalizeRecord(value,key)])));}}catch{}setStoreReady(true);},[]);
  useEffect(()=>{if(storeReady)localStorage.setItem(STORE_KEY,JSON.stringify(records));},[records,storeReady]);

  const vehicles=payload?.vehicles||[];
  const queue=useMemo(()=>vehicles.filter(v=>v.inFactory&&v.processProfile!=="EXCLU").filter(v=>queueMode==="all"||isExpertiseStatus(v.status)).filter(v=>{const hay=`${v.registration||""} ${v.workOrder||""} ${v.vin||""} ${v.client||""} ${v.model||""} ${v.status}`.toLowerCase();return !query.trim()||hay.includes(query.trim().toLowerCase());}).sort((a,b)=>b.factoryAgeDays-a.factoryAgeDays),[vehicles,queueMode,query]);
  const selected=useMemo(()=>vehicles.find(v=>vehicleKey(v)===selectedKey)||null,[vehicles,selectedKey]);
  const record=selectedKey?normalizeRecord(records[selectedKey],selectedKey):null;
  const selectedGrade=record?.grade?GRADE_RULES[record.grade]:null;
  const allFileRefs=useMemo(()=>record?[...record.general.exteriorPhotos,...record.general.interiorPhotos,...record.general.maintenanceDocuments,...record.general.otherDocuments,...record.damages.flatMap(d=>d.photos)]:[],[record]);
  const fileSignature=allFileRefs.map(item=>item.id).join("|");

  useEffect(()=>{let cancelled=false;const created:string[]=[];async function hydrate(){if(!record){setFileUrls({});return;}const next:Record<string,string>={};for(const ref of allFileRefs){try{const blob=await getFile(ref.id);if(blob){const url=URL.createObjectURL(blob);created.push(url);next[ref.id]=url;}}catch{}}if(!cancelled)setFileUrls(next);}void hydrate();return()=>{cancelled=true;for(const url of created)URL.revokeObjectURL(url);};},[selectedKey,fileSignature]);

  function mutate(updater:(current:ExpertiseRecord)=>ExpertiseRecord){if(!selectedKey)return;setRecords(current=>{const base=normalizeRecord(current[selectedKey],selectedKey);return{...current,[selectedKey]:{...updater(base),updatedAt:new Date().toISOString()}};});}
  function chooseVehicle(v:Vehicle){const key=vehicleKey(v);setSelectedKey(key);setRecords(current=>current[key]?current:{...current,[key]:emptyRecord(key)});setClientPreview(false);}
  function updateGeneral(patch:Partial<GeneralSection>){mutate(current=>({...current,general:{...current.general,...patch}}));}
  function updateMechanics(patch:Partial<MechanicsSection>){mutate(current=>({...current,mechanics:{...current.mechanics,...patch}}));}
  function updateTyre(position:Tyre["position"],patch:Partial<Tyre>){mutate(current=>({...current,mechanics:{...current.mechanics,tyres:current.mechanics.tyres.map(tyre=>tyre.position===position?{...tyre,...patch}:tyre)}}));}
  function addDamage(zone=""){const damage=newDamage(zone);mutate(current=>({...current,damages:[...current.damages,damage]}));window.setTimeout(()=>document.getElementById(`damage-${damage.id}`)?.scrollIntoView({behavior:"smooth",block:"center"}),80);}
  function updateDamage(id:string,patch:Partial<Damage>){mutate(current=>({...current,damages:current.damages.map(d=>{if(d.id!==id)return d;const zoneChanged=patch.zone!==undefined&&patch.zone!==d.zone;const methodChanged=patch.method!==undefined&&patch.method!==d.method;return{...d,...patch,...(zoneChanged?{type:"",method:defaultMethodForZone(String(patch.zone||"")),forfaitId:"",paintFinish:""}:{}),...(methodChanged?{forfaitId:""}:{})};})}));}
  async function deleteDamage(id:string){if(!record)return;const damage=record.damages.find(d=>d.id===id);if(damage)for(const photo of damage.photos){try{await removeFile(photo.id);}catch{}}mutate(current=>({...current,damages:current.damages.filter(d=>d.id!==id)}));}
  async function ingestFiles(files:FileList|null,accept:(file:File)=>boolean){if(!files?.length)return[] as FileRef[];const refs:FileRef[]=[];for(const file of Array.from(files).filter(accept).slice(0,12)){const id=crypto.randomUUID();try{await putFile(id,file);refs.push({id,name:file.name,type:file.type,createdAt:new Date().toISOString()});}catch{}}return refs;}
  async function addGeneralFiles(bucket:FileBucket,files:FileList|null){const refs=await ingestFiles(files,file=>bucket.includes("Photos")?file.type.startsWith("image/"):file.type.startsWith("image/")||file.type==="application/pdf");if(refs.length)mutate(current=>({...current,general:{...current.general,[bucket]:[...current.general[bucket],...refs]}}));}
  async function addDamagePhotos(damageId:string,files:FileList|null){const refs=await ingestFiles(files,file=>file.type.startsWith("image/"));if(refs.length)mutate(current=>({...current,damages:current.damages.map(d=>d.id===damageId?{...d,photos:[...d.photos,...refs]}:d)}));}
  async function deleteGeneralFile(bucket:FileBucket,id:string){try{await removeFile(id);}catch{}mutate(current=>({...current,general:{...current.general,[bucket]:current.general[bucket].filter(ref=>ref.id!==id)}}));}
  async function deleteDamagePhoto(damageId:string,id:string){try{await removeFile(id);}catch{}mutate(current=>({...current,damages:current.damages.map(d=>d.id===damageId?{...d,photos:d.photos.filter(ref=>ref.id!==id)}:d)}));}
  function resetExpertise(){if(!selectedKey||!window.confirm("Effacer l'expertise DEV de ce dossier ?"))return;void Promise.all(allFileRefs.map(ref=>removeFile(ref.id).catch(()=>undefined)));setRecords(current=>{const next={...current};delete next[selectedKey];return next;});setSelectedKey(null);}

  const mechanicsForfaitIds=record?[record.mechanics.serviceForfaitId,record.mechanics.tyreForfaitId,record.mechanics.brakeFrontForfaitId,record.mechanics.brakeRearForfaitId].filter(Boolean):[];
  const shockHt=record?Math.max(0,Number(String(record.mechanics.shockManualHt).replace(",","."))||0):0;
  const mechanicsHt=selectedForfaitTotal(mechanicsForfaitIds)+shockHt;
  const bodyHt=record?record.damages.reduce((sum,d)=>sum+lineHt(d),0):0;
  const bodyTtc=record?record.damages.reduce((sum,d)=>sum+lineTtc(d),0):0;
  const mechanicsTtc=mechanicsForfaitIds.reduce((sum,id)=>sum+(forfaitById(id)?.ttc||0),0)+shockHt*1.2;
  const totalHt=mechanicsHt+bodyHt;
  const totalTtc=mechanicsTtc+bodyTtc;
  const photoCount=record?record.general.exteriorPhotos.length+record.general.interiorPhotos.length+record.damages.reduce((sum,d)=>sum+d.photos.length,0):0;
  const serviceOptions=record?mechanicForfaits("service",record.mechanics.category):[];
  const tyreOptions=mechanicForfaits("tyre",record?.mechanics.category||"");
  const brakeOptions=record?mechanicForfaits("brake",record.mechanics.category):[];

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/crvo-logo.png" alt="CRVO"/><div><span>SAS EXPERTISE · AUCUNE ÉCRITURE FLEETBACK / MPF</span><h1>Expertise & chiffrage</h1><p>Contrôle véhicule, mécanique, carrosserie interactive, forfaits 2026 et médias - alimenté par le miroir FTP.</p></div></div>
      <div className={styles.actions}><button className={styles.ghost} onClick={()=>void load()} disabled={loading}>{loading?"ACTUALISATION…":"ACTUALISER FTP"}</button><a className={styles.button} href="/developpement/production">PRODUCTION LIVE</a></div>
    </header>
    <section className={styles.notice}><strong>DEV SANDBOX</strong><span>Les dossiers sont réels. Photos, documents, contrôles et chiffrages restent dans ce navigateur : aucune écriture Fleetback ou MecaPlanning Factory.</span></section>
    {error&&<div className={styles.error}>{error}</div>}

    <div className={styles.layout}>
      <aside className={styles.queue}>
        <div className={styles.queueHead}><div><span className={styles.eyebrow}>FILE EXPERTISE</span><h2>Dossiers à contrôler</h2></div><small>{queue.length} dossiers</small></div>
        <input className={styles.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Immat, OR, VIN, client, modèle…"/>
        <div className={styles.queueFilters}><button className={queueMode==="expertise"?styles.active:""} onClick={()=>setQueueMode("expertise")}>EXPERTISE / CHIFFRAGE</button><button className={queueMode==="all"?styles.active:""} onClick={()=>setQueueMode("all")}>TOUT LE PARC</button></div>
        <div className={styles.vehicleList}>{queue.slice(0,500).map(v=>{const key=vehicleKey(v),saved=records[key];return <button key={key} className={`${styles.vehicle} ${selectedKey===key?styles.vehicleActive:""}`} onClick={()=>chooseVehicle(v)}><div><strong>{v.registration||"Sans immat"}</strong><span>OR {v.workOrder||"—"} · {v.model||"—"}</span><small>{v.status} · {v.location||"position —"} · J+{Math.round(v.factoryAgeDays)}</small></div>{saved&&<b className={styles.badge}>{saved.status==="completed"?"VALIDÉ DEV":`${saved.damages?.length||0} DÉGÂT${(saved.damages?.length||0)>1?"S":""}`}</b>}</button>;})}</div>
      </aside>

      <section className={styles.workspace}>
        {!selected||!record?<div className={styles.empty}><div><strong>Sélectionnez un dossier</strong><span>L'expertise reprend le véhicule du miroir FTP puis guide l'expert de l'aspect général jusqu'au chiffrage carrosserie.</span></div></div>:<>
          <div className={styles.vehicleHeader}><div><span className={styles.eyebrowLight}>DOSSIER EXPERTISE</span><h2>{selected.registration||"Sans immatriculation"}</h2><p>{selected.client||"—"} · {selected.model||"—"}</p><div className={styles.vehicleHeaderMeta}><span>OR {selected.workOrder||"—"}</span><span>VIN {selected.vin||"—"}</span><span>{Math.round(selected.mileage).toLocaleString("fr-FR")} km</span><span>Position {selected.location||"—"}</span><span>{selected.status}</span></div></div><div className={styles.totals}><small>CHIFFRAGE ACTUEL</small><strong>{money(totalHt)} HT</strong><b>{money(totalTtc)} TTC · {photoCount} photo{photoCount>1?"s":""}</b></div></div>

          <div className={styles.stepRail}><span>01 Aspect général</span><i>›</i><span>02 Mécanique</span><i>›</i><span>03 Carrosserie</span><i>›</i><span>04 Synthèse</span></div>

          <article className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>01 · ASPECT GÉNÉRAL</span><h2>Identité, grade, photos & documents</h2></div><small>Le dossier visuel de référence avant chiffrage</small></div>
            <div className={styles.generalTop}>
              <label className={styles.field}><span>Grade du véhicule</span><select className={styles.select} value={record.grade||""} onChange={e=>mutate(current=>({...current,grade:(e.target.value||null) as GradeKey|null}))}><option value="">À DÉFINIR</option>{(Object.keys(GRADE_RULES) as GradeKey[]).map(key=><option key={key} value={key}>{GRADE_RULES[key].label}</option>)}</select></label>
              <label className={styles.field}><span>Historique d'entretien disponible</span><select className={styles.select} value={record.general.maintenanceHistory} onChange={e=>updateGeneral({maintenanceHistory:e.target.value as GeneralSection["maintenanceHistory"]})}><option value="">À contrôler</option><option value="OUI">OUI</option><option value="NON">NON</option><option value="INCONNU">INCONNU</option></select></label>
              <label className={`${styles.field} ${styles.span2}`}><span>Historique / commentaire général</span><textarea className={styles.textarea} value={record.general.historyComment} onChange={e=>updateGeneral({historyComment:e.target.value})} placeholder="Historique PVO², carnet, factures, réserves, contexte du véhicule…"/></label>
            </div>
            {selectedGrade&&<div className={styles.gradeStrip} style={{borderLeftColor:selectedGrade.accent}}><div><strong>{selectedGrade.label}</strong><span>{selectedGrade.summary}</span></div><div className={styles.gradeQuick}>{selectedGrade.rules.filter(rule=>["Mécanique","Pneumatiques","Freinage","Jantes","Carrosserie"].includes(rule.group)).map(rule=><span key={rule.group}><b>{rule.group}</b>{rule.items[0]}</span>)}</div></div>}
            <div className={styles.mediaGrid}>
              <MediaBox title="Photos extérieur" subtitle="Vue 4 faces, détails généraux" refs={record.general.exteriorPhotos} urls={fileUrls} accept="image/*" capture onAdd={files=>void addGeneralFiles("exteriorPhotos",files)} onDelete={id=>void deleteGeneralFile("exteriorPhotos",id)}/>
              <MediaBox title="Photos intérieur" subtitle="Habitacle, sellerie, coffre" refs={record.general.interiorPhotos} urls={fileUrls} accept="image/*" capture onAdd={files=>void addGeneralFiles("interiorPhotos",files)} onDelete={id=>void deleteGeneralFile("interiorPhotos",id)}/>
              <DocumentBox title="Documents entretien" refs={record.general.maintenanceDocuments} urls={fileUrls} onAdd={files=>void addGeneralFiles("maintenanceDocuments",files)} onDelete={id=>void deleteGeneralFile("maintenanceDocuments",id)}/>
              <DocumentBox title="Autres documents utiles" refs={record.general.otherDocuments} urls={fileUrls} onAdd={files=>void addGeneralFiles("otherDocuments",files)} onDelete={id=>void deleteGeneralFile("otherDocuments",id)}/>
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>02 · MÉCANIQUE</span><h2>Entretien, pneumatiques, freins & amortisseurs</h2></div><small>{money(mechanicsHt)} HT chiffrés sur la partie mécanique</small></div>
            <div className={styles.mechanicTop}>
              <label className={styles.field}><span>Catégorie tarifaire</span><select className={styles.select} value={record.mechanics.category} onChange={e=>updateMechanics({category:e.target.value as MechanicsSection["category"],serviceForfaitId:"",brakeFrontForfaitId:"",brakeRearForfaitId:""})}><option value="">À définir</option>{Object.entries(MECHANIC_CATEGORIES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
              <label className={styles.field}><span>Entretien sous 6 mois / 10 000 km</span><select className={styles.select} value={record.mechanics.serviceDue} onChange={e=>updateMechanics({serviceDue:e.target.value as MechanicsSection["serviceDue"]})}><option value="">À contrôler</option><option value="OUI">OUI</option><option value="NON">NON</option></select></label>
              <label className={`${styles.field} ${styles.span2}`}><span>Forfait entretien proposé</span><select className={styles.select} value={record.mechanics.serviceForfaitId} onChange={e=>updateMechanics({serviceForfaitId:e.target.value})} disabled={!serviceOptions.length}><option value="">{record.mechanics.category?"Aucun / sélectionner…":"Choisir d'abord la catégorie"}</option>{serviceOptions.map(f=><option key={f.id} value={f.id}>{f.label} · {money(f.ht)} HT</option>)}</select></label>
            </div>

            <div className={styles.subSection}><div className={styles.subHead}><div><strong>Pneumatiques</strong><span>Marque, dimension, usure mesurée et RUNFLAT</span></div><label className={styles.inlineSelect}><span>Forfait montage / géométrie</span><select value={record.mechanics.tyreForfaitId} onChange={e=>updateMechanics({tyreForfaitId:e.target.value})}><option value="">Aucun</option>{tyreOptions.map(f=><option key={f.id} value={f.id}>{f.label} · {money(f.ht)} HT</option>)}</select></label></div>
              <div className={styles.tyreTable}><div className={styles.tyreHead}><span>Roue</span><span>Marque</span><span>Dimension</span><span>Usure mm</span><span>État</span><span>RUNFLAT</span></div>{record.mechanics.tyres.map(tyre=><div className={styles.tyreRow} key={tyre.position}><b>{tyre.position}</b><input value={tyre.brand} onChange={e=>updateTyre(tyre.position,{brand:e.target.value})} placeholder="Michelin…"/><input value={tyre.dimension} onChange={e=>updateTyre(tyre.position,{dimension:e.target.value})} placeholder="225/45 R18"/><input inputMode="decimal" value={tyre.treadMm} onChange={e=>updateTyre(tyre.position,{treadMm:e.target.value})} placeholder="3,5"/><select value={tyre.status} onChange={e=>updateTyre(tyre.position,{status:e.target.value as Tyre["status"]})}><option value="">—</option><option value="OK">OK</option><option value="SURVEILLER">À surveiller</option><option value="REMPLACER">À remplacer</option></select><label className={styles.check}><input type="checkbox" checked={tyre.runflat} onChange={e=>updateTyre(tyre.position,{runflat:e.target.checked})}/> Oui</label></div>)}</div>
              <small className={styles.ruleHint}>Cahier des charges fourni : profondeur mini 3,5 mm ; la marque attendue dépend du grade.</small>
            </div>

            <div className={styles.mechGrid}>
              <div className={styles.mechCard}><div className={styles.mechCardHead}><strong>Freinage AV</strong><span>Plaquettes ≥ 5 mm / disque au-dessus cote mini</span></div><select value={record.mechanics.brakeFront} onChange={e=>updateMechanics({brakeFront:e.target.value as MechanicsSection["brakeFront"]})}><option value="">À contrôler</option><option value="OK">Conforme</option><option value="PLAQUETTES">Plaquettes à remplacer</option><option value="DISQUES_PLAQUETTES">Disques + plaquettes</option></select><select value={record.mechanics.brakeFrontForfaitId} onChange={e=>updateMechanics({brakeFrontForfaitId:e.target.value})} disabled={!brakeOptions.length}><option value="">Forfait AV…</option>{brakeOptions.filter(f=>/AVANT/i.test(f.label)).map(f=><option key={f.id} value={f.id}>{f.label} · {money(f.ht)} HT</option>)}</select></div>
              <div className={styles.mechCard}><div className={styles.mechCardHead}><strong>Freinage AR</strong><span>Plaquettes ≥ 5 mm / disque au-dessus cote mini</span></div><select value={record.mechanics.brakeRear} onChange={e=>updateMechanics({brakeRear:e.target.value as MechanicsSection["brakeRear"]})}><option value="">À contrôler</option><option value="OK">Conforme</option><option value="PLAQUETTES">Plaquettes à remplacer</option><option value="DISQUES_PLAQUETTES">Disques + plaquettes</option></select><select value={record.mechanics.brakeRearForfaitId} onChange={e=>updateMechanics({brakeRearForfaitId:e.target.value})} disabled={!brakeOptions.length}><option value="">Forfait AR…</option>{brakeOptions.filter(f=>/ARRIERE/i.test(f.label)).map(f=><option key={f.id} value={f.id}>{f.label} · {money(f.ht)} HT</option>)}</select></div>
              <div className={styles.mechCard}><div className={styles.mechCardHead}><strong>Amortisseurs</strong><span>Contrôle AV / AR</span></div><div className={styles.doubleSelect}><select value={record.mechanics.shockFront} onChange={e=>updateMechanics({shockFront:e.target.value as MechanicsSection["shockFront"]})}><option value="">AV à contrôler</option><option value="OK">AV conforme</option><option value="FUITE">AV fuite</option><option value="JEU">AV jeu / bruit</option><option value="REMPLACER">AV à remplacer</option></select><select value={record.mechanics.shockRear} onChange={e=>updateMechanics({shockRear:e.target.value as MechanicsSection["shockRear"]})}><option value="">AR à contrôler</option><option value="OK">AR conforme</option><option value="FUITE">AR fuite</option><option value="JEU">AR jeu / bruit</option><option value="REMPLACER">AR à remplacer</option></select></div><label className={styles.field}><span>Chiffrage amortisseurs HT</span><input className={styles.input} inputMode="decimal" value={record.mechanics.shockManualHt} onChange={e=>updateMechanics({shockManualHt:e.target.value})} placeholder="Hors forfait grille 2026"/></label><small className={styles.noTariff}>Aucun forfait amortisseur n'est présent dans la grille tarifaire 2026 fournie : chiffrage manuel dans ce SAS.</small></div>
            </div>
            <label className={styles.field}><span>Commentaire mécanique</span><textarea className={styles.textarea} value={record.mechanics.notes} onChange={e=>updateMechanics({notes:e.target.value})} placeholder="Batterie, climatisation, géométrie, diagnostic, fuite, bruit, réserve expert…"/></label>
          </article>

          <article className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>03 · CARROSSERIE</span><h2>Vue véhicule interactive & dommages</h2></div><button className={styles.button} onClick={()=>addDamage("")}>+ DOMMAGE LIBRE</button></div>
            <div className={styles.bodyWorkspace}>
              <div className={styles.vehicleMapCard}><div className={styles.mapIntro}><strong>Sélectionnez directement l'élément</strong><span>Le dommage créé n'affichera ensuite que les typologies, méthodes et forfaits compatibles avec cet élément.</span></div><VehicleMap onSelect={zone=>addDamage(zone)} damageZones={record.damages.map(d=>d.zone)}/><div className={styles.mapLegend}><span><i/> Élément sélectionnable</span><span><i className={styles.damageDot}/> Dommage déjà déclaré</span></div></div>
              <div className={styles.damageColumn}>{!record.damages.length?<div className={styles.noDamage}><strong>Aucun dommage carrosserie déclaré</strong><span>Cliquez sur une aile, une porte, un bouclier, une jante, le capot, le pavillon ou le pare-brise.</span></div>:record.damages.map((damage,index)=>{const types=damageTypesForZone(damage.zone),methods=methodsForZone(damage.zone),forfaits=forfaitsForDamage(damage),forfait=forfaitById(damage.forfaitId),guide=gradeGuidance(record.grade,damage);return <div id={`damage-${damage.id}`} className={styles.damage} key={damage.id}>
                <div className={styles.damageHead}><div><span className={styles.eyebrow}>DOMMAGE #{index+1}</span><strong>{damage.zone||"Élément à sélectionner"}</strong></div><button className={styles.danger} onClick={()=>void deleteDamage(damage.id)}>SUPPRIMER</button></div>
                <div className={styles.damageGrid}>
                  <label className={styles.field}><span>Élément véhicule</span><select className={styles.select} value={damage.zone} onChange={e=>updateDamage(damage.id,{zone:e.target.value})}><option value="">Sélectionner…</option>{BODY_ZONES.map(zone=><option key={zone}>{zone}</option>)}</select></label>
                  <label className={styles.field}><span>Typologie de dommage</span><select className={styles.select} value={damage.type} onChange={e=>updateDamage(damage.id,{type:e.target.value})} disabled={!damage.zone}><option value="">{damage.zone?"Sélectionner…":"Choisir l'élément"}</option>{types.map(type=><option key={type}>{type}</option>)}</select></label>
                  {!['wheel','glass','interior'].includes(familyForZone(damage.zone))&&<label className={styles.field}><span>Zone grade</span><select className={styles.select} value={damage.zoneLevel} onChange={e=>updateDamage(damage.id,{zoneLevel:e.target.value as Damage["zoneLevel"]})}><option value="">À préciser</option><option value="HAUTE">Zone haute</option><option value="BASSE">Zone basse</option></select></label>}
                  <label className={styles.field}><span>Taille / longueur (cm)</span><input className={styles.input} inputMode="decimal" value={damage.sizeCm} onChange={e=>updateDamage(damage.id,{sizeCm:e.target.value})} placeholder="ex. 3,5"/></label>
                  <label className={styles.field}><span>Méthode de remise en état</span><select className={styles.select} value={damage.method} onChange={e=>updateDamage(damage.id,{method:e.target.value})} disabled={!damage.zone}><option value="">Sélectionner…</option>{methods.map(method=><option key={method} value={method}>{METHOD_LABELS[method]||method}</option>)}</select></label>
                  {damage.method==="PEINTURE"&&<label className={styles.field}><span>Rendu peinture</span><select className={styles.select} value={damage.paintFinish} onChange={e=>updateDamage(damage.id,{paintFinish:e.target.value as Damage["paintFinish"]})}><option value="">À préciser</option><option value="AVEC_DIFF">Avec différence de teinte</option><option value="SANS_DIFF">Sans différence de teinte</option></select></label>}
                  <label className={`${styles.field} ${styles.span2}`}><span>Forfait compatible avec {damage.zone||"l'élément"}</span><select className={styles.select} value={damage.forfaitId} onChange={e=>updateDamage(damage.id,{forfaitId:e.target.value})} disabled={!forfaits.length}><option value="">{forfaits.length?"Sélectionner le forfait…":damage.method==="LUSTRAGE"?"Lustrage non tarifé dans la grille 2026":"Aucun forfait automatique"}</option>{forfaits.map(item=><option key={item.id} value={item.id}>{item.label} · {money(item.ht)} HT</option>)}</select></label>
                  <label className={`${styles.field} ${styles.span2}`}><span>Description / décision expert</span><textarea className={styles.textarea} value={damage.description} onChange={e=>updateDamage(damage.id,{description:e.target.value})} placeholder="Décrire le défaut, la décision retenue et la justification…"/></label>
                  {!forfait&&<><label className={styles.field}><span>Libellé hors forfait</span><input className={styles.input} value={damage.manualLabel} onChange={e=>updateDamage(damage.id,{manualLabel:e.target.value})} placeholder={damage.method==="LUSTRAGE"?"Lustrage aile AV…":"Pièce / opération…"}/></label><label className={styles.field}><span>Montant manuel HT</span><input className={styles.input} inputMode="decimal" value={damage.manualHt} onChange={e=>updateDamage(damage.id,{manualHt:e.target.value})} placeholder="0,00"/></label></>}
                </div>
                <div className={`${styles.guidance} ${guide.tone==="warn"?styles.guidanceWarn:""}`}><strong>Contrôle grade :</strong> {guide.text}</div>
                <div className={styles.priceLine}><div><span className={styles.eyebrow}>CHIFFRAGE</span><strong>{forfait?.label||damage.manualLabel||"À chiffrer"}</strong></div><strong>{money(lineHt(damage))} HT · {money(lineTtc(damage))} TTC</strong></div>
                <div className={styles.photos}>{damage.photos.map(photo=><div className={styles.photo} key={photo.id}>{fileUrls[photo.id]?<img src={fileUrls[photo.id]} alt={photo.name}/>:null}<button onClick={()=>void deleteDamagePhoto(damage.id,photo.id)} aria-label="Supprimer la photo">×</button></div>)}<label className={styles.photoAdd}>+ PHOTO DOMMAGE<input type="file" accept="image/*" capture="environment" multiple onChange={e=>{void addDamagePhotos(damage.id,e.target.files);e.currentTarget.value="";}}/></label></div>
              </div>;})}</div>
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.sectionHead}><div><span className={styles.eyebrow}>04 · SYNTHÈSE</span><h2>Expertise prête à challenger</h2></div><small>Dernière modification {fmtDate(record.updatedAt)}</small></div>
            <div className={styles.summary}><article><span>Photos</span><strong>{photoCount}</strong></article><article><span>Dommages</span><strong>{record.damages.length}</strong></article><article><span>Mécanique HT</span><strong>{money(mechanicsHt)}</strong></article><article><span>Carrosserie HT</span><strong>{money(bodyHt)}</strong></article><article className={styles.summaryTotal}><span>Total HT</span><strong>{money(totalHt)}</strong><small>{money(totalTtc)} TTC</small></article></div>
            <label className={styles.field}><span>Conclusion générale expert</span><textarea className={styles.textarea} value={record.general.generalComment} onChange={e=>updateGeneral({generalComment:e.target.value})} placeholder="Conclusion, réserves, décision de remise en état et éléments à faire valider…"/></label>
            <div className={styles.footerActions}><div><button className={styles.ghost} onClick={()=>setClientPreview(true)}>APERÇU CLIENT</button><button className={styles.danger} onClick={resetExpertise}>EFFACER LE BROUILLON</button></div><button className={`${styles.button} ${record.status==="completed"?styles.statusDone:""}`} onClick={()=>mutate(current=>({...current,status:current.status==="completed"?"draft":"completed"}))}>{record.status==="completed"?"EXPERTISE VALIDÉE DEV ✓":"VALIDER L'EXPERTISE DEV"}</button></div>
          </article>
        </>}
      </section>
    </div>

    {clientPreview&&selected&&record&&<><button className={styles.clientBackdrop} onClick={()=>setClientPreview(false)} aria-label="Fermer l'aperçu"/><section className={styles.clientModal}><header className={styles.clientHead}><div><span className={styles.eyebrowLight}>APERÇU RAPPORT CLIENT · DEV</span><h2>{selected.registration||"Véhicule"} · {selected.model||""}</h2><small>Aucune transmission - prévisualisation locale.</small></div><button onClick={()=>setClientPreview(false)}>FERMER</button></header><div className={styles.clientBody}>
      <div className={styles.clientTop}>{record.general.exteriorPhotos[0]&&fileUrls[record.general.exteriorPhotos[0].id]?<img src={fileUrls[record.general.exteriorPhotos[0].id]} alt="Vue extérieure"/>:<div className={styles.clientPlaceholder}>PHOTO EXTÉRIEURE</div>}<div><span className={styles.eyebrow}>EXPERTISE</span><strong>{record.grade?GRADE_RULES[record.grade].label:"Grade à confirmer"}</strong><small>OR {selected.workOrder||"—"} · {selected.client||"—"} · {Math.round(selected.mileage).toLocaleString("fr-FR")} km</small><p>Historique entretien : {record.general.maintenanceHistory||"à contrôler"}</p></div><div className={styles.clientTotal}><span className={styles.eyebrow}>TOTAL PROPOSÉ</span><strong>{money(totalTtc)} TTC</strong></div></div>
      <div className={styles.clientSection}><h3>Mécanique</h3><div className={styles.clientLines}>{mechanicsForfaitIds.map(id=>{const f=forfaitById(id);return f?<div key={id}><span>{f.label}</span><strong>{money(f.ttc)} TTC</strong></div>:null})}{shockHt>0&&<div><span>Amortisseurs / chiffrage manuel</span><strong>{money(shockHt*1.2)} TTC</strong></div>}{!mechanicsForfaitIds.length&&!shockHt&&<small>Aucun travail mécanique chiffré.</small>}</div></div>
      <div className={styles.clientSection}><h3>Carrosserie & dommages</h3>{record.damages.map((damage,index)=>{const first=damage.photos[0],forfait=forfaitById(damage.forfaitId);return <div className={styles.clientDamage} key={damage.id}>{first&&fileUrls[first.id]?<img src={fileUrls[first.id]} alt={first.name}/>:<div className={styles.clientDamagePlaceholder}>PHOTO</div>}<div><strong>{index+1}. {damage.zone||"Dommage"} · {damage.type||"à préciser"}</strong><span>{METHOD_LABELS[damage.method]||"Méthode à définir"}</span><small>{damage.description||"Aucun commentaire expert."}</small><small>{forfait?.label||damage.manualLabel||"Chiffrage à confirmer"}</small></div><span className={styles.clientPrice}>{money(lineTtc(damage))} TTC</span></div>})}{!record.damages.length&&<small>Aucun dommage carrosserie déclaré.</small>}</div>
      {record.general.generalComment&&<div className={styles.clientComment}><strong>Commentaire expert</strong><br/>{record.general.generalComment}</div>}
    </div></section></>}
  </main>;
}

function MediaBox({title,subtitle,refs,urls,accept,capture,onAdd,onDelete}:{title:string;subtitle:string;refs:FileRef[];urls:Record<string,string>;accept:string;capture?:boolean;onAdd:(files:FileList|null)=>void;onDelete:(id:string)=>void}){
  return <div className={styles.mediaBox}><div className={styles.mediaTitle}><div><strong>{title}</strong><span>{subtitle}</span></div><b>{refs.length}</b></div><div className={styles.mediaThumbs}>{refs.map(ref=><div className={styles.mediaThumb} key={ref.id}>{urls[ref.id]?<img src={urls[ref.id]} alt={ref.name}/>:null}<button onClick={()=>onDelete(ref.id)}>×</button></div>)}<label className={styles.mediaAdd}>+ AJOUTER<input type="file" accept={accept} capture={capture?"environment":undefined} multiple onChange={e=>{onAdd(e.target.files);e.currentTarget.value="";}}/></label></div></div>;
}
function DocumentBox({title,refs,urls,onAdd,onDelete}:{title:string;refs:FileRef[];urls:Record<string,string>;onAdd:(files:FileList|null)=>void;onDelete:(id:string)=>void}){
  return <div className={styles.mediaBox}><div className={styles.mediaTitle}><div><strong>{title}</strong><span>PDF ou image</span></div><b>{refs.length}</b></div><div className={styles.documentList}>{refs.map(ref=><div className={styles.document} key={ref.id}><div><strong>{ref.name}</strong><span>{ref.type||"document"}</span></div><div>{urls[ref.id]&&<a href={urls[ref.id]} target="_blank" rel="noreferrer">OUVRIR</a>}<button onClick={()=>onDelete(ref.id)}>×</button></div></div>)}<label className={styles.documentAdd}>+ AJOUTER UN DOCUMENT<input type="file" accept="image/*,application/pdf" multiple onChange={e=>{onAdd(e.target.files);e.currentTarget.value="";}}/></label></div></div>;
}
function VehicleMap({onSelect,damageZones}:{onSelect:(zone:string)=>void;damageZones:string[]}){
  const damaged=new Set(damageZones);
  const cls=(zone:string)=>`${styles.mapZone} ${damaged.has(zone)?styles.mapZoneDamaged:""}`;
  return <svg className={styles.vehicleMap} viewBox="0 0 820 430" role="img" aria-label="Vue véhicule interactive">
    <defs><linearGradient id="bodyGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eaf4fa"/><stop offset="0.55" stopColor="#ffffff"/><stop offset="1" stopColor="#bfd9e7"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#003b63" floodOpacity=".18"/></filter></defs>
    <path d="M190 75 C245 38 575 38 630 75 L696 137 L720 310 C674 354 146 354 100 310 L124 137 Z" fill="url(#bodyGrad)" stroke="#6aa7c5" strokeWidth="4" filter="url(#shadow)"/>
    <path d="M267 94 C315 68 505 68 553 94 L594 145 L568 287 C520 315 300 315 252 287 L226 145 Z" fill="#d8edf6" stroke="#83b8cf" strokeWidth="3"/>
    <path d="M282 104 L538 104 L566 151 L254 151 Z" fill="#9fd4e7" opacity=".65"/>
    <path d="M274 270 L546 270 L568 294 L252 294 Z" fill="#b7dce9" opacity=".65"/>
    <g className={cls("Capot")} onClick={()=>onSelect("Capot")}><path d="M251 156 L569 156 L548 214 L272 214 Z"/><text x="410" y="190">CAPOT</text></g>
    <g className={cls("Pavillon")} onClick={()=>onSelect("Pavillon")}><path d="M294 112 L526 112 L548 150 L272 150 Z"/><text x="410" y="136">PAVILLON</text></g>
    <g className={cls("Pare-brise")} onClick={()=>onSelect("Pare-brise")}><path d="M279 151 L541 151 L524 169 L296 169 Z"/><text x="410" y="164">PARE-BRISE</text></g>
    <g className={cls("Hayon / coffre")} onClick={()=>onSelect("Hayon / coffre")}><path d="M272 220 L548 220 L541 266 L279 266 Z"/><text x="410" y="248">HAYON</text></g>
    <g className={cls("Bouclier AV")} onClick={()=>onSelect("Bouclier AV")}><path d="M147 102 L673 102 L697 136 L123 136 Z"/><text x="410" y="126">BOUCLIER AV</text></g>
    <g className={cls("Bouclier AR")} onClick={()=>onSelect("Bouclier AR")}><path d="M112 304 L708 304 L685 337 L135 337 Z"/><text x="410" y="326">BOUCLIER AR</text></g>
    <g className={cls("Aile AVG")} onClick={()=>onSelect("Aile AVG")}><path d="M154 141 L265 141 L286 214 L155 214 Z"/><text x="211" y="181">AILE AVG</text></g>
    <g className={cls("Aile AVD")} onClick={()=>onSelect("Aile AVD")}><path d="M555 141 L666 141 L665 214 L534 214 Z"/><text x="610" y="181">AILE AVD</text></g>
    <g className={cls("Porte AVG")} onClick={()=>onSelect("Porte AVG")}><path d="M159 217 L286 217 L294 270 L159 270 Z"/><text x="225" y="247">PORTE AVG</text></g>
    <g className={cls("Porte AVD")} onClick={()=>onSelect("Porte AVD")}><path d="M526 217 L661 217 L661 270 L518 270 Z"/><text x="592" y="247">PORTE AVD</text></g>
    <g className={cls("Porte ARG")} onClick={()=>onSelect("Porte ARG")}><path d="M164 273 L294 273 L282 301 L170 301 Z"/><text x="226" y="291">PORTE ARG</text></g>
    <g className={cls("Porte ARD")} onClick={()=>onSelect("Porte ARD")}><path d="M526 273 L656 273 L650 301 L538 301 Z"/><text x="594" y="291">PORTE ARD</text></g>
    <g className={cls("Aile ARG")} onClick={()=>onSelect("Aile ARG")}><path d="M121 273 L161 273 L167 301 L130 301 Z"/><text x="71" y="292">AILE ARG</text></g>
    <g className={cls("Aile ARD")} onClick={()=>onSelect("Aile ARD")}><path d="M659 273 L699 273 L690 301 L653 301 Z"/><text x="749" y="292">AILE ARD</text></g>
    <g className={cls("Rétroviseur AVG")} onClick={()=>onSelect("Rétroviseur AVG")}><path d="M132 171 L154 164 L156 189 L134 194 Z"/><text x="74" y="185">RÉTRO G</text></g>
    <g className={cls("Rétroviseur AVD")} onClick={()=>onSelect("Rétroviseur AVD")}><path d="M666 164 L688 171 L686 194 L664 189 Z"/><text x="744" y="185">RÉTRO D</text></g>
    <g className={cls("Jante AVG")} onClick={()=>onSelect("Jante AVG")}><circle cx="165" cy="150" r="27"/><text x="165" y="154">AVG</text></g>
    <g className={cls("Jante AVD")} onClick={()=>onSelect("Jante AVD")}><circle cx="655" cy="150" r="27"/><text x="655" y="154">AVD</text></g>
    <g className={cls("Jante ARG")} onClick={()=>onSelect("Jante ARG")}><circle cx="165" cy="289" r="27"/><text x="165" y="293">ARG</text></g>
    <g className={cls("Jante ARD")} onClick={()=>onSelect("Jante ARD")}><circle cx="655" cy="289" r="27"/><text x="655" y="293">ARD</text></g>
  </svg>;
}
