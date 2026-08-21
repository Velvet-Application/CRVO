"use client";

import { useEffect, useRef, useState } from "react";
import { createTransphereDailyPdf, type TransphereSummary } from "./transphere-report";
import styles from "./transphere-settings.module.css";

type Payload = TransphereSummary & { connected?: boolean; sourceFile?: string; error?: string };
type MailConfig = { subject: string; body: string; graphConfigured?: boolean; to?: Array<{ address: string }>; error?: string };
type ContractSetting = { id:number; crvo:string; carrier:string; sourceLabel:string; fuelIndexationPct:number; updatedAt?:string|null };
type MatrixConfig = { connected?:boolean; canEdit?:boolean; contractSettings?:ContractSetting[]; error?:string };

function dateLabel(value?: string | null){
  if(!value) return "—";
  const d=new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",timeZone:"UTC"}).format(d);
}
function download(file:File){const url=URL.createObjectURL(file);const a=document.createElement("a");a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
async function base64(file:File){const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(binary)}
function mailto(config:MailConfig){const to=(config.to??[]).map((item)=>item.address).join(";");return `mailto:${to}?subject=${encodeURIComponent(config.subject)}&body=${encodeURIComponent(config.body)}`}

export default function TransphereSettings(){
  const [data,setData]=useState<Payload|null>(null);
  const [contracts,setContracts]=useState<ContractSetting[]>([]);
  const [canEditContracts,setCanEditContracts]=useState(false);
  const [indexationInputs,setIndexationInputs]=useState<Record<number,string>>({});
  const [loading,setLoading]=useState(true);
  const [importing,setImporting]=useState(false);
  const [reporting,setReporting]=useState(false);
  const [savingContract,setSavingContract]=useState<number|null>(null);
  const [notice,setNotice]=useState("");
  const [error,setError]=useState("");
  const inputRef=useRef<HTMLInputElement|null>(null);

  async function load(){
    setLoading(true);setError("");
    try{
      const [dashboardResponse,matrixResponse]=await Promise.all([
        fetch(`/api/transphere/dashboard?_=${Date.now()}`,{cache:"no-store"}),
        fetch(`/api/transphere/transport-matrix?_=${Date.now()}`,{cache:"no-store"}),
      ]);
      const payload=await dashboardResponse.json().catch(()=>({})) as Payload;
      const matrix=await matrixResponse.json().catch(()=>({})) as MatrixConfig;
      if(!dashboardResponse.ok||payload.connected===false)throw new Error(payload.error||"Données Transphère indisponibles.");
      if(!matrixResponse.ok||matrix.connected===false)throw new Error(matrix.error||"Paramètres contrats indisponibles.");
      const contractRows=(matrix.contractSettings??[]).map((row)=>({...row,id:Number(row.id),fuelIndexationPct:Number(row.fuelIndexationPct??10)}));
      setData(payload);setContracts(contractRows);setCanEditContracts(Boolean(matrix.canEdit));
      setIndexationInputs(Object.fromEntries(contractRows.map((row)=>[row.id,String(row.fuelIndexationPct)])));
    }
    catch(cause){setError(cause instanceof Error?cause.message:"Données Transphère indisponibles.")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);

  async function importBook(file:File){
    setImporting(true);setError("");setNotice("");
    try{const form=new FormData();form.set("file",file);const response=await fetch("/api/transphere/import-book",{method:"POST",body:form});const payload=await response.json().catch(()=>({})) as {error?:string;rows?:number;latestDate?:string;sheet?:string};if(!response.ok)throw new Error(payload.error||"Import impossible.");setNotice(`Book importé · ${payload.rows??0} journées · arrêté au ${dateLabel(payload.latestDate)} · onglet ${payload.sheet??"—"}.`);await load()}
    catch(cause){setError(cause instanceof Error?cause.message:"Import impossible.")}
    finally{setImporting(false);if(inputRef.current)inputRef.current.value=""}
  }

  async function saveIndexation(contract:ContractSetting){
    if(!canEditContracts)return;
    const value=Number(String(indexationInputs[contract.id]??contract.fuelIndexationPct).replace(",","."));
    if(!Number.isFinite(value)||value<0||value>100){setError("L’indexation gasoil doit être comprise entre 0 et 100 %.");return}
    setSavingContract(contract.id);setError("");setNotice("");
    try{
      const response=await fetch("/api/transphere/transport-matrix",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"contract_indexation",crvo:contract.crvo,carrier:contract.carrier,sourceLabel:contract.sourceLabel,fuelIndexationPct:value})});
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(result.error||"Mise à jour de l’indexation impossible.");
      setNotice(`Indexation gasoil ${contract.carrier} · ${contract.crvo} mise à ${value.toLocaleString("fr-FR",{maximumFractionDigits:2})} %.`);await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Mise à jour de l’indexation impossible.")}
    finally{setSavingContract(null)}
  }

  async function createReport(){
    if(!data)return;setReporting(true);setError("");setNotice("");let tab:Window|null=null;
    try{
      const [pdf,mailResponse]=await Promise.all([createTransphereDailyPdf(data),fetch(`/api/transphere/animation?_=${Date.now()}`,{cache:"no-store"})]);
      const mail=await mailResponse.json().catch(()=>({})) as MailConfig;
      if(!mailResponse.ok||mail.error)throw new Error(mail.error||"Mail Transphère indisponible.");
      if(mail.graphConfigured){
        tab=window.open("about:blank","_blank");
        const response=await fetch("/api/transphere/animation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject:mail.subject,bodyText:mail.body,filename:pdf.name,pdfBase64:await base64(pdf)})});
        const result=await response.json().catch(()=>({})) as {webLink?:string|null;error?:string};
        if(!response.ok)throw new Error(result.error||"Brouillon Outlook impossible.");
        if(result.webLink){if(tab)tab.location.replace(result.webLink);else window.location.href=result.webLink}else{download(pdf);window.location.href=mailto(mail)}
        setNotice("Reporting Transphère prêt dans Outlook avec le PDF joint.");
      }else{download(pdf);window.location.href=mailto(mail);setNotice("Outlook prérempli ; PDF Transphère téléchargé à joindre.")}
    }catch(cause){if(tab&&!tab.closed)tab.close();setError(cause instanceof Error?cause.message:"Reporting impossible.")}
    finally{setReporting(false)}
  }

  return <div className={styles.page}><div className={styles.shell}>
    <div className={styles.topbar}><a className={styles.back} href="/transphere">← Accueil Transphère</a><div className={styles.brand}><div className={styles.logo} role="img" aria-label="Transphère" /></div></div>
    <section className={styles.hero}><small>03 · PARAMÈTRE</small><h1>Import, reporting & contrats</h1><p>Centralisez l’administration du Book Transphère, la génération du reporting et les paramètres économiques appliqués aux contrats transport.</p>
      <div className={styles.status}><div><span>DERNIER ARRÊTÉ</span><b>{loading?"Chargement…":dateLabel(data?.reportDate)}</b></div><div><span>SOURCE</span><b>{data?.sourceFile||"Book Transphère"}</b></div><div><span>ÉTAT</span><b>{error?"À contrôler":"Prêt"}</b></div></div>
    </section>
    {error?<div className={styles.error}>{error}</div>:null}{notice?<div className={styles.notice}>{notice}</div>:null}
    <section className={styles.grid}>
      <article className={`${styles.card} ${styles.cardDark}`}><div className={styles.icon}>⇧</div><h2>Importer le Book</h2><p>Chargez le fichier Excel Transphère. Les journées et objectifs sont intégrés puis le cockpit est actualisé.</p><label className={styles.upload}>{importing?"Import en cours…":"Choisir le Book Excel"}<input ref={inputRef} className={styles.hidden} type="file" accept=".xlsx,.xls" disabled={importing} onChange={(event)=>{const file=event.target.files?.[0];if(file)void importBook(file)}}/></label><div className={styles.meta}>Formats acceptés : XLSX / XLS · données historisées dans la base.</div></article>
      <article className={styles.card}><div className={styles.icon}>▤</div><h2>Générer le reporting</h2><p>Créez le PDF Transphère et préparez automatiquement le message d’animation avec les destinataires configurés.</p><button className={styles.button} onClick={()=>void createReport()} disabled={reporting||!data}>{reporting?"Génération…":"Reporting 1 clic"}</button><div className={styles.meta}>Le PDF reprend l’arrêté courant : {dateLabel(data?.reportDate)}.</div></article>
    </section>

    <section className={styles.contractPanel}>
      <div className={styles.contractHead}><div><small>INDEXATION GASOIL</small><h2>Réglage par contrat</h2><p>Les prix contractuels partenaires sont enregistrés hors indexation gasoil. La matrice applique automatiquement le pourcentage ci-dessous au tarif de base. Le coût de revient Transphère n’est pas indexé ici.</p></div><b>10 % par défaut</b></div>
      {contracts.length?<div className={styles.contractGrid}>{contracts.map((contract)=><article className={styles.contractRow} key={contract.id}><div><span>{contract.crvo}</span><strong>{contract.carrier}</strong><small>{contract.sourceLabel}</small></div><label><span>Indexation</span><div><input type="number" min="0" max="100" step="0.1" value={indexationInputs[contract.id]??String(contract.fuelIndexationPct)} onChange={(event)=>setIndexationInputs((old)=>({...old,[contract.id]:event.target.value}))} disabled={!canEditContracts}/><b>%</b></div></label><button className={styles.contractButton} onClick={()=>void saveIndexation(contract)} disabled={!canEditContracts||savingContract===contract.id}>{savingContract===contract.id?"Enregistrement…":"Enregistrer"}</button></article>)}</div>:<div className={styles.contractEmpty}>{loading?"Chargement des contrats…":"Aucun contrat partenaire paramétrable."}</div>}
      {!canEditContracts&&contracts.length?<div className={styles.contractReadOnly}>Consultation uniquement · modification réservée aux administrateurs et responsables Transphère.</div>:null}
    </section>
  </div></div>;
}
