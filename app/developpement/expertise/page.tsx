"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./expertise.module.css";
import { AUDIT_QUESTIONS, DAMAGE_TYPES, EXPERTISE_FORFAITS, GRADE_RULES, REPAIR_METHODS, VEHICLE_ZONES, type GradeKey, type ExpertiseForfait } from "./expertise-data";

type Vehicle={
  registration:string|null;workOrder:string|null;client:string|null;vin:string|null;model:string|null;mileage:number;status:string;statusAgeDays:number;factoryAgeDays:number;
  alert:string|null;urgency:string|null;location:string|null;locationSourceModifiedAt:string|null;sourceType:string;processProfile:"EFF"|"BMW"|"AUTRE"|"EXCLU";inFactory:boolean;
};
type Payload={connected:boolean;sourceModifiedAt:string|null;locationSourceModifiedAt:string|null;vehicles:Vehicle[];error?:string};
type AuditAnswer={answer:""|"OUI"|"NON"|"NA";comment:string};
type PhotoRef={id:string;name:string;type:string;createdAt:string};
type Damage={
  id:string;zone:string;zoneLevel:""|"HAUTE"|"BASSE";type:string;description:string;sizeCm:string;method:string;paintFinish:""|"AVEC_DIFF"|"SANS_DIFF";
  forfaitId:string;manualLabel:string;manualHt:string;photos:PhotoRef[];
};
type ExpertiseRecord={vehicleKey:string;grade:GradeKey|null;audit:Record<string,AuditAnswer>;damages:Damage[];generalComment:string;status:"draft"|"completed";updatedAt:string};
type ExpertiseStore=Record<string,ExpertiseRecord>;

const STORE_KEY="crvo-expertise-sandbox-v1";
const PHOTO_DB="crvo-expertise-dev-photos-v1";
const PHOTO_STORE="photos";

function vehicleKey(v:Vehicle){return String(v.vin||v.registration||v.workOrder||`${v.client}-${v.model}`);}
function money(value:number){return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(value);}
function fmtDate(value?:string|null){if(!value)return "—";const d=new Date(value);if(Number.isNaN(d.getTime()))return value;return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(d);}
function isExpertiseStatus(status:string){return /réception|reception|expert|lavage|chiffr|devis|validation/.test(status.toLowerCase());}
function emptyRecord(key:string):ExpertiseRecord{return{vehicleKey:key,grade:null,audit:{},damages:[],generalComment:"",status:"draft",updatedAt:new Date().toISOString()};}
function newDamage():Damage{return{id:crypto.randomUUID(),zone:"",zoneLevel:"",type:"",description:"",sizeCm:"",method:"",paintFinish:"",forfaitId:"",manualLabel:"",manualHt:"",photos:[]};}
function forfaitById(id:string){return EXPERTISE_FORFAITS.find(item=>item.id===id)||null;}
function lineHt(damage:Damage){const forfait=forfaitById(damage.forfaitId);if(forfait)return forfait.ht;const manual=Number(String(damage.manualHt).replace(",","."));return Number.isFinite(manual)?Math.max(0,manual):0;}
function lineTtc(damage:Damage){const forfait=forfaitById(damage.forfaitId);if(forfait)return forfait.ttc;return lineHt(damage)*1.2;}
function photoDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(PHOTO_DB,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(PHOTO_STORE))request.result.createObjectStore(PHOTO_STORE);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function putPhoto(id:string,file:File){const db=await photoDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,"readwrite");tx.objectStore(PHOTO_STORE).put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}
async function getPhoto(id:string){const db=await photoDb();const blob=await new Promise<Blob|null>((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,"readonly");const req=tx.objectStore(PHOTO_STORE).get(id);req.onsuccess=()=>resolve(req.result instanceof Blob?req.result:null);req.onerror=()=>reject(req.error);});db.close();return blob;}
async function removePhoto(id:string){const db=await photoDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction(PHOTO_STORE,"readwrite");tx.objectStore(PHOTO_STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();}

function forfaitsForDamage(damage:Damage):ExpertiseForfait[]{
  if(damage.method==="PARE_BRISE")return EXPERTISE_FORFAITS.filter(f=>/pare-brise/i.test(f.label));
  if(damage.method==="PLUME")return EXPERTISE_FORFAITS.filter(f=>f.section==="PEINTURE"&&/éclats|rayures/i.test(f.label));
  const method=REPAIR_METHODS.find(item=>item.id===damage.method);
  if(!method?.section)return[];
  return EXPERTISE_FORFAITS.filter(f=>f.section===method.section);
}
function gradeGuidance(grade:GradeKey|null,damage:Damage){
  if(!grade)return{tone:"warn" as const,text:"Sélectionnez d'abord le grade du véhicule pour contrôler la cohérence de la méthode de réparation."};
  const method=damage.method,level=damage.zoneLevel,size=Number(String(damage.sizeCm).replace(",","."));
  const body=["DSP","PEINTURE","PLUME"].includes(method);
  if(grade==="ECO"&&body)return{tone:"warn" as const,text:"Grade Éco : pas de carrosserie. Le référentiel demande uniquement le chiffrage des éléments pouvant bloquer une vente."};
  if(grade==="ECO"&&method==="JANTE")return{tone:"warn" as const,text:"Grade Éco : pas de réparation jante selon le cahier des charges fourni."};
  if(grade==="BRONZE"&&method==="JANTE")return{tone:"warn" as const,text:"Grade Bronze : pas de réparation jante ; l'enjoliveur n'est remplacé que selon la règle du grade."};
  if(method==="DSP"&&["OR","ARGENT","BRONZE"].includes(grade))return{tone:"ok" as const,text:`${GRADE_RULES[grade].label} : DSP admis sur zones haute et basse.`};
  if(method==="PLUME"){
    if(grade==="BRONZE"&&level==="BASSE")return{tone:"warn" as const,text:"Grade Bronze : retouche plume NON admise en zone basse."};
    if(grade==="ECO")return{tone:"warn" as const,text:"Grade Éco : retouche plume NON admise."};
    return{tone:"ok" as const,text:`${GRADE_RULES[grade].label} : retouche plume compatible avec la zone sélectionnée sous réserve du contrôle expert.`};
  }
  if(method==="PEINTURE"&&level&&damage.paintFinish){
    if(grade==="BRONZE"){
      if(damage.paintFinish==="SANS_DIFF")return{tone:"warn" as const,text:"Grade Bronze : réparation carrosserie sans différence de teinte = NON selon le référentiel."};
      return{tone:size&&size<=5?"warn":"ok" as const,text:"Grade Bronze : réparation avec différence de teinte uniquement au-delà de 5 cm, zone haute comme zone basse."};
    }
    const thresholds=grade==="ARGENT"?(damage.paintFinish==="AVEC_DIFF"?{HAUTE:1,BASSE:2}:{HAUTE:2,BASSE:4}):(damage.paintFinish==="SANS_DIFF"?{HAUTE:1,BASSE:2}:{HAUTE:0,BASSE:0});
    const threshold=thresholds[level];
    return{tone:size&&size<=threshold?"warn":"ok" as const,text:`${GRADE_RULES[grade].label} : seuil indicatif du tableau ${threshold===0?"toutes rayures":`> ${threshold} cm`} pour ${level==="HAUTE"?"zone haute":"zone basse"} (${damage.paintFinish==="AVEC_DIFF"?"avec":"sans"} différence de teinte).`};
  }
  if(method==="PARE_BRISE")return{tone:"ok" as const,text:"Pare-brise : réparation si diamètre < 2 cm ou fissure < 6 cm ; les critères de remplacement du cahier des charges restent à contrôler."};
  return{tone:"ok" as const,text:`Méthode à contrôler avec le ${GRADE_RULES[grade].label}. Le cahier des charges complet reste visible dans l'audit.`};
}

export default function ExpertiseDevelopmentPage(){
  const [payload,setPayload]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [queueMode,setQueueMode]=useState<"expertise"|"all">("expertise");
  const [selectedKey,setSelectedKey]=useState<string|null>(null);
  const [records,setRecords]=useState<ExpertiseStore>({});
  const [storeReady,setStoreReady]=useState(false);
  const [photoUrls,setPhotoUrls]=useState<Record<string,string>>({});
  const [clientPreview,setClientPreview]=useState(false);

  async function load(){setLoading(true);try{const r=await fetch(`/api/development/production?_=${Date.now()}`,{cache:"no-store"});const data=await r.json() as Payload;if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);setPayload(data);setError("");}catch(e){setError(e instanceof Error?e.message:"Reflet FTP indisponible");}finally{setLoading(false);}}
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{try{const raw=localStorage.getItem(STORE_KEY);if(raw)setRecords(JSON.parse(raw) as ExpertiseStore);}catch{}setStoreReady(true);},[]);
  useEffect(()=>{if(storeReady)localStorage.setItem(STORE_KEY,JSON.stringify(records));},[records,storeReady]);

  const vehicles=payload?.vehicles||[];
  const queue=useMemo(()=>vehicles.filter(v=>v.inFactory&&v.processProfile!=="EXCLU").filter(v=>queueMode==="all"||isExpertiseStatus(v.status)).filter(v=>{const hay=`${v.registration||""} ${v.workOrder||""} ${v.vin||""} ${v.client||""} ${v.model||""} ${v.status}`.toLowerCase();return !query.trim()||hay.includes(query.trim().toLowerCase());}).sort((a,b)=>b.factoryAgeDays-a.factoryAgeDays),[vehicles,queueMode,query]);
  const selected=useMemo(()=>vehicles.find(v=>vehicleKey(v)===selectedKey)||null,[vehicles,selectedKey]);
  const record=selectedKey?(records[selectedKey]||emptyRecord(selectedKey)):null;
  const photoSignature=record?.damages.flatMap(d=>d.photos.map(p=>p.id)).join("|")||"";

  useEffect(()=>{let cancelled=false;const created:string[]=[];async function hydrate(){if(!record){setPhotoUrls({});return;}const next:Record<string,string>={};for(const damage of record.damages){for(const photo of damage.photos){try{const blob=await getPhoto(photo.id);if(blob){const url=URL.createObjectURL(blob);created.push(url);next[photo.id]=url;}}catch{}}}if(!cancelled)setPhotoUrls(next);}void hydrate();return()=>{cancelled=true;for(const url of created)URL.revokeObjectURL(url);};},[selectedKey,photoSignature]);

  function mutate(updater:(current:ExpertiseRecord)=>ExpertiseRecord){if(!selectedKey)return;setRecords(current=>{const base=current[selectedKey]||emptyRecord(selectedKey);return{...current,[selectedKey]:{...updater(base),updatedAt:new Date().toISOString()}};});}
  function chooseVehicle(v:Vehicle){const key=vehicleKey(v);setSelectedKey(key);setRecords(current=>current[key]?current:{...current,[key]:emptyRecord(key)});setClientPreview(false);}
  function updateAudit(id:string,patch:Partial<AuditAnswer>){mutate(current=>({...current,audit:{...current.audit,[id]:{answer:current.audit[id]?.answer||"",comment:current.audit[id]?.comment||"",...patch}}}));}
  function addDamage(){mutate(current=>({...current,damages:[...current.damages,newDamage()]}));}
  function updateDamage(id:string,patch:Partial<Damage>){mutate(current=>({...current,damages:current.damages.map(d=>d.id===id?{...d,...patch,...(patch.method!==undefined?{forfaitId:""}:{})}:d)}));}
  async function deleteDamage(id:string){if(!record)return;const damage=record.damages.find(d=>d.id===id);if(damage)for(const photo of damage.photos){try{await removePhoto(photo.id);}catch{}}mutate(current=>({...current,damages:current.damages.filter(d=>d.id!==id)}));}
  async function addPhotos(damageId:string,files:FileList|null){if(!files?.length)return;const accepted=Array.from(files).filter(file=>file.type.startsWith("image/")).slice(0,8);const refs:PhotoRef[]=[];for(const file of accepted){const id=crypto.randomUUID();try{await putPhoto(id,file);refs.push({id,name:file.name,type:file.type,createdAt:new Date().toISOString()});}catch{}}if(refs.length)mutate(current=>({...current,damages:current.damages.map(d=>d.id===damageId?{...d,photos:[...d.photos,...refs]}:d)}));}
  async function deletePhoto(damageId:string,photoId:string){try{await removePhoto(photoId);}catch{}mutate(current=>({...current,damages:current.damages.map(d=>d.id===damageId?{...d,photos:d.photos.filter(p=>p.id!==photoId)}:d)}));}
  function resetExpertise(){if(!selectedKey||!window.confirm("Effacer l'expertise DEV de ce dossier ?"))return;const photos=record?.damages.flatMap(d=>d.photos)||[];void Promise.all(photos.map(p=>removePhoto(p.id).catch(()=>undefined)));setRecords(current=>{const next={...current};delete next[selectedKey];return next;});setSelectedKey(null);}

  const totals=useMemo(()=>{if(!record)return{ht:0,ttc:0,photos:0};return{ht:record.damages.reduce((sum,d)=>sum+lineHt(d),0),ttc:record.damages.reduce((sum,d)=>sum+lineTtc(d),0),photos:record.damages.reduce((sum,d)=>sum+d.photos.length,0)};},[record]);
  const answered=record?AUDIT_QUESTIONS.filter(q=>record.audit[q.id]?.answer).length:0;
  const selectedGrade=record?.grade?GRADE_RULES[record.grade]:null;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/crvo-logo.png" alt="CRVO"/><div><span>SAS EXPERTISE · AUCUNE ÉCRITURE FLEETBACK / MPF</span><h1>Expertise & chiffrage</h1><p>Audit, dommages, méthode de réparation, forfaits 2026 et photos - alimenté par le miroir FTP.</p></div></div>
      <div className={styles.actions}><button className={styles.ghost} onClick={()=>void load()} disabled={loading}>{loading?"ACTUALISATION…":"ACTUALISER FTP"}</button><a className={styles.button} href="/developpement/production">PRODUCTION LIVE</a></div>
    </header>
    <section className={styles.notice}><strong>DEV SANDBOX</strong><span>Les dossiers sont réels. Les réponses d'audit, dommages, chiffrages et photos restent dans ce navigateur. Aucun envoi client, aucune écriture Fleetback ou MecaPlanning Factory.</span></section>
    {error&&<div style={{marginTop:10,padding:10,borderRadius:9,background:"#ffe5e3",color:"#a42f2b",fontSize:9,fontWeight:800}}>{error}</div>}

    <div className={styles.layout}>
      <aside className={styles.queue}>
        <div className={styles.queueHead}><div><span className={styles.eyebrow}>FILE EXPERTISE</span><h2>Dossiers à contrôler</h2></div><small>{queue.length} dossiers</small></div>
        <input className={styles.search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Immat, OR, VIN, client, modèle…"/>
        <div className={styles.queueFilters}><button className={queueMode==="expertise"?styles.active:""} onClick={()=>setQueueMode("expertise")}>EXPERTISE / CHIFFRAGE</button><button className={queueMode==="all"?styles.active:""} onClick={()=>setQueueMode("all")}>TOUT LE PARC</button></div>
        <div className={styles.vehicleList}>{queue.slice(0,500).map(v=>{const key=vehicleKey(v),saved=records[key];return <button key={key} className={`${styles.vehicle} ${selectedKey===key?styles.vehicleActive:""}`} onClick={()=>chooseVehicle(v)}><div><strong>{v.registration||"Sans immat"}</strong><span>OR {v.workOrder||"—"} · {v.model||"—"}</span><small>{v.status} · {v.location||"position —"} · J+{Math.round(v.factoryAgeDays)}</small></div>{saved&&<b className={styles.badge}>{saved.status==="completed"?"VALIDÉ DEV":`${saved.damages.length} DÉGÂT${saved.damages.length>1?"S":""}`}</b>}</button>;})}</div>
      </aside>

      <section className={styles.workspace}>
        {!selected||!record?<div className={styles.empty}><div><strong>Sélectionnez un dossier</strong><span>L'expertise reprend le véhicule réel du miroir FTP et crée un dossier de contrôle local sans impact sur MPF.</span></div></div>:<>
          <div className={styles.vehicleHeader}><div><span className={styles.eyebrow} style={{color:"#80dcff"}}>DOSSIER EXPERTISE</span><h2>{selected.registration||"Sans immatriculation"}</h2><p>{selected.client||"—"} · {selected.model||"—"}</p><div className={styles.vehicleHeaderMeta}><span>OR {selected.workOrder||"—"}</span><span>VIN {selected.vin||"—"}</span><span>{Math.round(selected.mileage).toLocaleString("fr-FR")} km</span><span>Position {selected.location||"—"}</span><span>{selected.status}</span></div></div><div className={styles.totals}><small>CHIFFRAGE ACTUEL</small><strong>{money(totals.ht)} HT</strong><b>{money(totals.ttc)} TTC · {totals.photos} photo{totals.photos>1?"s":""}</b></div></div>

          <div className={styles.grid}>
            <article className={`${styles.panel} ${styles.wide}`}>
              <div className={styles.sectionHead}><div><span className={styles.eyebrow}>01 · CAHIER DES CHARGES</span><h2>Grade & règles applicables</h2></div><small>Référentiel GRADES / LABELS fourni</small></div>
              <div className={styles.gradeRow}><label className={styles.field}><span>Grade du véhicule</span><select className={styles.gradeSelect} value={record.grade||""} onChange={e=>mutate(current=>({...current,grade:(e.target.value||null) as GradeKey|null}))}><option value="">À DÉFINIR</option>{(Object.keys(GRADE_RULES) as GradeKey[]).map(key=><option key={key} value={key}>{GRADE_RULES[key].label}</option>)}</select></label>{selectedGrade?<div className={styles.gradeCard} style={{borderLeftColor:selectedGrade.accent}}><strong>{selectedGrade.label}</strong><p>{selectedGrade.summary}</p></div>:<div className={styles.gradeCard}><strong>Grade à confirmer</strong><p>Le grade pilote les tolérances de remise en état et les contrôles affichés à l'expert.</p></div>}</div>
              {selectedGrade&&<div className={styles.gradeRules}>{selectedGrade.rules.map(rule=><div className={styles.rule} key={rule.group}><b>{rule.group}</b><ul>{rule.items.map(item=><li key={item}>{item}</li>)}</ul></div>)}</div>}
            </article>

            <article className={`${styles.panel} ${styles.wide}`}>
              <div className={styles.sectionHead}><div><span className={styles.eyebrow}>02 · AUDIT EXPERT</span><h2>Contrôle guidé du dossier</h2></div><small>{answered}/{AUDIT_QUESTIONS.length} réponses</small></div>
              <div className={styles.audit}>{AUDIT_QUESTIONS.map(question=>{const answer=record.audit[question.id]||{answer:"",comment:""};return <div className={styles.auditRow} key={question.id}><div><strong>{question.label}</strong><small>{question.group}</small></div><div className={styles.auditControls}><select className={styles.select} value={answer.answer} onChange={e=>updateAudit(question.id,{answer:e.target.value as AuditAnswer["answer"]})}><option value="">—</option><option value="OUI">OUI</option><option value="NON">NON</option><option value="NA">N/A</option></select><input className={styles.input} value={answer.comment} onChange={e=>updateAudit(question.id,{comment:e.target.value})} placeholder="Commentaire / mesure…"/></div></div>;})}</div>
            </article>

            <article className={`${styles.panel} ${styles.wide}`}>
              <div className={styles.sectionHead}><div><span className={styles.eyebrow}>03 · DOMMAGES & MÉTHODES</span><h2>Déclarer et chiffrer les travaux</h2></div><button className={styles.button} onClick={addDamage}>+ AJOUTER UN DOMMAGE</button></div>
              {!record.damages.length?<div style={{padding:20,border:"1px dashed #bdd8e7",borderRadius:10,textAlign:"center",fontSize:8,color:"#718795"}}>Aucun dommage déclaré. L'expert peut ajouter un dommage, sa typologie, la méthode de réparation, le forfait 2026 et les photos justificatives.</div>:<div className={styles.damageList}>{record.damages.map((damage,index)=>{const forfaitOptions=forfaitsForDamage(damage),forfait=forfaitById(damage.forfaitId),guide=gradeGuidance(record.grade,damage);return <div className={styles.damage} key={damage.id}>
                <div className={styles.damageHead}><strong>Dommage #{index+1} · {damage.zone||"zone à préciser"}</strong><button className={styles.danger} onClick={()=>void deleteDamage(damage.id)}>SUPPRIMER</button></div>
                <div className={styles.damageGrid}>
                  <label className={styles.field}><span>Zone véhicule</span><select className={styles.select} value={damage.zone} onChange={e=>updateDamage(damage.id,{zone:e.target.value})}><option value="">Sélectionner…</option>{VEHICLE_ZONES.map(zone=><option key={zone}>{zone}</option>)}</select></label>
                  <label className={styles.field}><span>Zone grade</span><select className={styles.select} value={damage.zoneLevel} onChange={e=>updateDamage(damage.id,{zoneLevel:e.target.value as Damage["zoneLevel"]})}><option value="">N/A</option><option value="HAUTE">Zone haute</option><option value="BASSE">Zone basse</option></select></label>
                  <label className={styles.field}><span>Typologie</span><select className={styles.select} value={damage.type} onChange={e=>updateDamage(damage.id,{type:e.target.value})}><option value="">Sélectionner…</option>{DAMAGE_TYPES.map(type=><option key={type}>{type}</option>)}</select></label>
                  <label className={styles.field}><span>Taille / longueur (cm)</span><input className={styles.input} inputMode="decimal" value={damage.sizeCm} onChange={e=>updateDamage(damage.id,{sizeCm:e.target.value})} placeholder="ex. 3,5"/></label>
                  <label className={styles.field}><span>Méthode de réparation</span><select className={styles.select} value={damage.method} onChange={e=>updateDamage(damage.id,{method:e.target.value})}><option value="">Sélectionner…</option>{REPAIR_METHODS.map(method=><option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
                  <label className={styles.field}><span>Rendu peinture</span><select className={styles.select} value={damage.paintFinish} onChange={e=>updateDamage(damage.id,{paintFinish:e.target.value as Damage["paintFinish"]})} disabled={damage.method!=="PEINTURE"}><option value="">N/A</option><option value="AVEC_DIFF">Avec différence de teinte</option><option value="SANS_DIFF">Sans différence de teinte</option></select></label>
                  <label className={`${styles.field} ${styles.span2}`}><span>Forfait 2026 associé</span><select className={styles.select} value={damage.forfaitId} onChange={e=>updateDamage(damage.id,{forfaitId:e.target.value})} disabled={!forfaitOptions.length}><option value="">{forfaitOptions.length?"Sélectionner le forfait…":"Aucun forfait automatique - chiffrage manuel"}</option>{forfaitOptions.map(item=><option key={item.id} value={item.id}>{item.category?`${item.category} · `:""}{item.label} · {money(item.ht)} HT</option>)}</select></label>
                  <label className={`${styles.field} ${styles.span2}`}><span>Libellé / commentaire dommage</span><textarea className={styles.textarea} value={damage.description} onChange={e=>updateDamage(damage.id,{description:e.target.value})} placeholder="Décrire précisément le dommage, la décision expert et la justification…"/></label>
                  <label className={styles.field}><span>Libellé hors forfait</span><input className={styles.input} value={damage.manualLabel} onChange={e=>updateDamage(damage.id,{manualLabel:e.target.value})} placeholder="Pièce / opération…" disabled={Boolean(forfait)}/></label>
                  <label className={styles.field}><span>Montant manuel HT</span><input className={styles.input} inputMode="decimal" value={damage.manualHt} onChange={e=>updateDamage(damage.id,{manualHt:e.target.value})} placeholder="0,00" disabled={Boolean(forfait)}/></label>
                </div>
                <div className={`${styles.guidance} ${guide.tone==="warn"?styles.guidanceWarn:""}`}><strong>Contrôle grade :</strong> {guide.text}</div>
                <div className={styles.priceLine}><div><span className={styles.eyebrow}>CHIFFRAGE</span><strong>{forfait?.label||damage.manualLabel||"À chiffrer"}</strong></div><strong>{money(lineHt(damage))} HT · {money(lineTtc(damage))} TTC</strong></div>
                <div className={styles.photos}>{damage.photos.map(photo=><div className={styles.photo} key={photo.id}>{photoUrls[photo.id]?<img src={photoUrls[photo.id]} alt={photo.name}/>:null}<button onClick={()=>void deletePhoto(damage.id,photo.id)} aria-label="Supprimer la photo">×</button></div>)}<label className={styles.photoAdd}>+ PHOTO<input type="file" accept="image/*" capture="environment" multiple onChange={e=>{void addPhotos(damage.id,e.target.files);e.currentTarget.value="";}}/></label></div>
              </div>;})}</div>}
            </article>

            <article className={`${styles.panel} ${styles.wide}`}>
              <div className={styles.sectionHead}><div><span className={styles.eyebrow}>04 · SYNTHÈSE</span><h2>Expertise prête à challenger</h2></div><small>Dernière modification {fmtDate(record.updatedAt)}</small></div>
              <div className={styles.summary}><article><span>Audit répondu</span><strong>{answered}/{AUDIT_QUESTIONS.length}</strong></article><article><span>Dommages</span><strong>{record.damages.length}</strong></article><article><span>Photos</span><strong>{totals.photos}</strong></article><article><span>Total HT</span><strong>{money(totals.ht)}</strong></article></div>
              <label className={styles.field} style={{marginTop:9}}><span>Commentaire général expert</span><textarea className={styles.textarea} value={record.generalComment} onChange={e=>mutate(current=>({...current,generalComment:e.target.value}))} placeholder="Conclusion, réserves, éléments à faire valider…"/></label>
              <div className={styles.footerActions}><div style={{display:"flex",gap:7}}><button className={styles.ghost} onClick={()=>setClientPreview(true)}>APERÇU CLIENT</button><button className={styles.danger} onClick={resetExpertise}>EFFACER LE BROUILLON</button></div><button className={`${styles.button} ${record.status==="completed"?styles.statusDone:""}`} onClick={()=>mutate(current=>({...current,status:current.status==="completed"?"draft":"completed"}))}>{record.status==="completed"?"EXPERTISE VALIDÉE DEV ✓":"VALIDER L'EXPERTISE DEV"}</button></div>
            </article>
          </div>
        </>}
      </section>
    </div>

    {clientPreview&&selected&&record&&<><button className={styles.clientBackdrop} onClick={()=>setClientPreview(false)} aria-label="Fermer l'aperçu"/><section className={styles.clientModal}><header className={styles.clientHead}><div><span className={styles.eyebrow} style={{color:"#8fe5ff"}}>APERÇU RAPPORT CLIENT · DEV</span><h2>{selected.registration||"Véhicule"} · {selected.model||""}</h2><small style={{color:"#c9efff"}}>Aucune transmission - prévisualisation locale inspirée du parcours visuel actuel.</small></div><button onClick={()=>setClientPreview(false)}>FERMER</button></header><div className={styles.clientBody}>
      <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",paddingBottom:12,borderBottom:"1px solid #e1ebf0"}}><div><span className={styles.eyebrow}>EXPERTISE</span><strong style={{display:"block",marginTop:4,color:"#004f9f",fontSize:16}}>{record.grade?GRADE_RULES[record.grade].label:"Grade à confirmer"}</strong><small style={{display:"block",marginTop:4,color:"#718896"}}>OR {selected.workOrder||"—"} · {selected.client||"—"} · {Math.round(selected.mileage).toLocaleString("fr-FR")} km</small></div><div style={{textAlign:"right"}}><span className={styles.eyebrow}>TOTAL PROPOSÉ</span><strong style={{display:"block",marginTop:4,color:"#004f9f",fontSize:22}}>{money(totals.ttc)} TTC</strong></div></div>
      {record.damages.map((damage,index)=>{const first=damage.photos[0],forfait=forfaitById(damage.forfaitId);return <div className={styles.clientDamage} key={damage.id}>{first&&photoUrls[first.id]?<img src={photoUrls[first.id]} alt={first.name}/>:<div style={{display:"grid",placeItems:"center",width:145,height:95,borderRadius:8,background:"#edf3f6",color:"#8aa0ad",fontSize:8}}>PHOTO NON AJOUTÉE</div>}<div><strong>{index+1}. {damage.zone||"Dommage"} · {damage.type||"typologie à préciser"}</strong><span>{REPAIR_METHODS.find(m=>m.id===damage.method)?.label||"Méthode à définir"}</span><small>{damage.description||"Aucun commentaire expert."}</small><small>{forfait?.label||damage.manualLabel||"Chiffrage à confirmer"}</small></div><span className={styles.clientPrice}>{money(lineTtc(damage))} TTC</span></div>;})}
      {!record.damages.length&&<div style={{padding:30,textAlign:"center",color:"#748b99",fontSize:9}}>Aucun travail déclaré dans cette expertise.</div>}
      {record.generalComment&&<div style={{marginTop:12,padding:12,borderRadius:9,background:"#f4f8fa",color:"#456579",fontSize:8,lineHeight:1.5}}><strong>Commentaire expert</strong><br/>{record.generalComment}</div>}
    </div></section></>}
  </main>;
}
