"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./pr-catalog-importer.module.css";

type SourceRow=Record<string,unknown>;
type MappedRow={row_no:number;reference:string|null;manufacturer_label:string|null;description:string|null;purchase_price_ht:number|null;source_stock_qty:number|null;source_cmm:number|null;source_pamp:number|null;location_code:string|null;last_entry_date:string|null;last_issue_date:string|null;category_code:string|null;accounting_class:string|null;replacement_reference:string|null};
type Analysis={sheetName:string;rows:number;validRows:number;uniqueItems:number;distinctReferences:number;brands:number;crossBrandCollisions:number;duplicatePairs:number;positiveStockRows:number;negativeStockRows:number;positiveStockQty:number;cmmRows:number;pampRows:number;locationRows:number;preview:MappedRow[]};
type ImportReport={sourceRows?:number;validRows?:number;uniqueCatalogItems?:number;distinctReferences?:number;brands?:number;crossBrandReferenceCollisions?:number;duplicateReferenceBrandRows?:number;sourcePositiveStockRows?:number;sourceNegativeStockRows?:number;sourcePositiveStockQuantity?:number;sourceCmmRows?:number;sourcePampRows?:number;sourceLocationRows?:number;stockImported?:boolean;stockImportNote?:string};

type BeginResult={batchId?:string;duplicate?:boolean;status?:string;report?:ImportReport;error?:string};
type CompleteResult={batchId?:string;report?:ImportReport;error?:string};

const EXPECTED=["Référence","Marque","Libellé","Prix Achat","Qté Stock","CMM","PAMP","Casier 1","D. Dernière Entrée","D. Dern. Sortie","Catégorie Pièce (code)","V. Comptable","Remplacée par"];
const CHUNK=750;

function text(v:unknown){if(v===null||v===undefined)return null;const s=String(v).trim();return s||null;}
function numberValue(v:unknown){if(v===null||v===undefined||v==="")return null;if(typeof v==="number")return Number.isFinite(v)?v:null;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null;}
function isoDate(v:unknown){
  if(v===null||v===undefined||v==="")return null;
  if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);
  if(typeof v==="number"&&Number.isFinite(v)){const millis=Date.UTC(1899,11,30)+Math.round(v*86400000);return new Date(millis).toISOString().slice(0,10);}
  const raw=String(v).trim();if(!raw)return null;
  const fr=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(fr){const y=fr[3].length===2?`20${fr[3]}`:fr[3];return `${y}-${fr[2].padStart(2,"0")}-${fr[1].padStart(2,"0")}`;}
  const d=new Date(raw);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function normalizeHeader(v:unknown){return String(v??"").trim().replace(/\s+/g," ");}
function pick(row:SourceRow,key:string){if(key in row)return row[key];const normalized=normalizeHeader(key).toLowerCase();for(const [k,v] of Object.entries(row)){if(normalizeHeader(k).toLowerCase()===normalized)return v;}return null;}
function mapped(row:SourceRow,index:number):MappedRow{return {row_no:index+2,reference:text(pick(row,"Référence")),manufacturer_label:text(pick(row,"Marque")),description:text(pick(row,"Libellé")),purchase_price_ht:numberValue(pick(row,"Prix Achat")),source_stock_qty:numberValue(pick(row,"Qté Stock")),source_cmm:numberValue(pick(row,"CMM")),source_pamp:numberValue(pick(row,"PAMP")),location_code:text(pick(row,"Casier 1")),last_entry_date:isoDate(pick(row,"D. Dernière Entrée")),last_issue_date:isoDate(pick(row,"D. Dern. Sortie")),category_code:text(pick(row,"Catégorie Pièce (code)")),accounting_class:text(pick(row,"V. Comptable")),replacement_reference:text(pick(row,"Remplacée par"))};}
function formatInt(v:number){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0}).format(v);}
function formatQty(v:number){return new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1}).format(v);}
async function jsonPost(body:Record<string,unknown>){const r=await fetch("/api/development/pr",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json() as Record<string,unknown>;if(!r.ok)throw new Error(String(data.error||`HTTP ${r.status}`));return data;}

export default function PrCatalogImporter(){
  const [file,setFile]=useState<File|null>(null);
  const [rows,setRows]=useState<MappedRow[]>([]);
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const [fingerprint,setFingerprint]=useState("");
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");
  const [report,setReport]=useState<ImportReport|null>(null);

  async function chooseFile(next:File|null){
    setFile(next);setRows([]);setAnalysis(null);setFingerprint("");setProgress(0);setStatus("");setError("");setReport(null);
    if(!next)return;
    try{
      setBusy(true);setStatus("Lecture du classeur…");
      const buffer=await next.arrayBuffer();
      const digest=await crypto.subtle.digest("SHA-256",buffer.slice(0));
      setFingerprint(Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join(""));
      const XLSX=await import("@e965/xlsx");
      const workbook=XLSX.read(buffer,{type:"array",cellDates:true});
      const sheetName=workbook.SheetNames[0];
      if(!sheetName)throw new Error("Le classeur ne contient aucune feuille.");
      const sheet=workbook.Sheets[sheetName];
      const raw=XLSX.utils.sheet_to_json<SourceRow>(sheet,{defval:null,raw:true});
      if(!raw.length)throw new Error("La première feuille est vide.");
      const observed=new Set(Object.keys(raw[0]||{}).map(normalizeHeader));
      const missing=EXPECTED.slice(0,3).filter(h=>!observed.has(h));
      if(missing.length)throw new Error(`Colonnes obligatoires absentes : ${missing.join(", ")}.`);
      const data=raw.map(mapped);
      const pairSet=new Set<string>();const refSet=new Set<string>();const brandSet=new Set<string>();const refBrands=new Map<string,Set<string>>();
      let validRows=0,positiveStockRows=0,negativeStockRows=0,positiveStockQty=0,cmmRows=0,pampRows=0,locationRows=0;
      for(const row of data){
        const ref=(row.reference||"").toUpperCase();const brand=(row.manufacturer_label||"").toUpperCase();
        if(ref&&row.description){validRows++;pairSet.add(`${ref}\u0000${brand}`);refSet.add(ref);brandSet.add(brand);const brands=refBrands.get(ref)||new Set<string>();brands.add(brand);refBrands.set(ref,brands);}
        if((row.source_stock_qty||0)>0){positiveStockRows++;positiveStockQty+=row.source_stock_qty||0;}if((row.source_stock_qty||0)<0)negativeStockRows++;
        if(row.source_cmm!==null)cmmRows++;if(row.source_pamp!==null)pampRows++;if(row.location_code)locationRows++;
      }
      let collisions=0;for(const brands of refBrands.values())if(brands.size>1)collisions++;
      setRows(data);
      setAnalysis({sheetName,rows:data.length,validRows,uniqueItems:pairSet.size,distinctReferences:refSet.size,brands:brandSet.size,crossBrandCollisions:collisions,duplicatePairs:Math.max(0,validRows-pairSet.size),positiveStockRows,negativeStockRows,positiveStockQty,cmmRows,pampRows,locationRows,preview:data.slice(0,10)});
      setStatus("Classeur analysé. Prêt pour l'import catalogue.");
    }catch(e){setError(e instanceof Error?e.message:"Lecture du fichier impossible.");}
    finally{setBusy(false);}
  }

  async function importCatalog(){
    if(!file||!analysis||!rows.length||!fingerprint)return;
    setBusy(true);setError("");setReport(null);setProgress(0);
    try{
      setStatus("Ouverture du lot d'import…");
      const begin=await jsonPost({action:"beginCatalogImport",sourceName:file.name,sourceFingerprint:fingerprint,mapping:{sheet:analysis.sheetName,headers:EXPECTED,mode:"managed-reference-catalog",stockPolicy:"source-only"}}) as BeginResult;
      if(begin.duplicate){setReport(begin.report||null);setProgress(100);setStatus("Ce fichier a déjà été importé : aucun doublon créé.");return;}
      if(!begin.batchId)throw new Error("Le lot d'import n'a pas été créé.");
      for(let start=0;start<rows.length;start+=CHUNK){
        const chunk=rows.slice(start,start+CHUNK);
        setStatus(`Import des références ${formatInt(start+1)} à ${formatInt(Math.min(start+CHUNK,rows.length))} / ${formatInt(rows.length)}…`);
        await jsonPost({action:"importCatalogChunk",batchId:begin.batchId,rows:chunk});
        setProgress(Math.round((Math.min(start+CHUNK,rows.length)/rows.length)*96));
      }
      setStatus("Contrôle final et consolidation du catalogue…");
      const complete=await jsonPost({action:"completeCatalogImport",batchId:begin.batchId}) as CompleteResult;
      setReport(complete.report||null);setProgress(100);setStatus("Référentiel PR importé. Le stock physique reste volontairement inchangé.");
    }catch(e){setError(e instanceof Error?e.message:"Import impossible.");setStatus("Import interrompu.");}
    finally{setBusy(false);}
  }

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.hero}><div><div className={styles.eyebrow}>PR / MAGASIN · IMPORT RÉFÉRENTIEL</div><h1>Références gérées</h1><p>Charge un catalogue de références connues sans fabriquer de stock. Les informations de quantité, CMM, PAMP et casier présentes dans le fichier restent archivées comme données source jusqu'à l'intégration d'un inventaire certifié.</p></div><Link className={styles.back} href="/developpement/pr">← Retour PR</Link></header>
    <div className={styles.warning}><strong>Garde-fou stock</strong><span>Cet import crée ou met à jour les fiches pièces. Il ne génère aucun mouvement <b>Stock initial</b> et ne modifie donc pas le stock physique. La clé métier est désormais <b>Référence + Marque</b> afin de gérer les références identiques utilisées par plusieurs constructeurs.</span></div>
    {error&&<div className={styles.error}>{error}</div>}
    {report&&<div className={styles.success}><strong>Import terminé.</strong> {report.stockImportNote||"Le catalogue a été intégré sans mouvement de stock."}</div>}
    <section className={styles.card}><div className={styles.drop}><div><strong>Sélectionner le fichier Excel des références gérées</strong><input type="file" accept=".xlsx,.xls" disabled={busy} onChange={e=>void chooseFile(e.target.files?.[0]||null)}/><small>Format reconnu : Référence · Marque · Libellé · Prix Achat · Qté Stock · CMM · PAMP · Casier · dates · catégorie · valeur comptable · remplacement.</small></div></div>{file&&<div className={styles.meta}><span className={styles.chip}>{file.name}</span><span className={styles.chip}>{(file.size/1024/1024).toFixed(2)} Mo</span>{analysis&&<span className={styles.chip}>Feuille : {analysis.sheetName}</span>}{fingerprint&&<span className={styles.chip}>SHA-256 : {fingerprint.slice(0,12)}…</span>}</div>}</section>
    {analysis&&<><section className={styles.kpis}><article className={styles.kpi}><span>Lignes source</span><strong>{formatInt(analysis.rows)}</strong><small>{formatInt(analysis.validRows)} exploitables</small></article><article className={styles.kpi}><span>Fiches Réf. + Marque</span><strong>{formatInt(analysis.uniqueItems)}</strong><small>{formatInt(analysis.distinctReferences)} références brutes</small></article><article className={styles.kpi}><span>Marques</span><strong>{formatInt(analysis.brands)}</strong><small>{formatInt(analysis.crossBrandCollisions)} références multi-marques</small></article><article className={styles.kpi}><span>Doublons même marque</span><strong>{formatInt(analysis.duplicatePairs)}</strong><small>consolidés à l'import</small></article><article className={styles.kpi}><span>Qté source positive</span><strong>{formatQty(analysis.positiveStockQty)}</strong><small>{formatInt(analysis.positiveStockRows)} lignes · non injectées</small></article><article className={styles.kpi}><span>Qté source négative</span><strong>{formatInt(analysis.negativeStockRows)}</strong><small>signalées, non injectées</small></article><article className={styles.kpi}><span>CMM renseignée</span><strong>{formatInt(analysis.cmmRows)}</strong><small>conservée comme source</small></article><article className={styles.kpi}><span>PAMP renseigné</span><strong>{formatInt(analysis.pampRows)}</strong><small>{formatInt(analysis.locationRows)} casiers renseignés</small></article></section>
      <section className={styles.card}><h2 className={styles.sectionTitle}>Aperçu des 10 premières lignes</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Référence</th><th>Marque</th><th>Libellé</th><th>PA</th><th>Qté source</th><th>CMM</th><th>PAMP</th><th>Casier</th><th>Cat.</th><th>V. comptable</th></tr></thead><tbody>{analysis.preview.map(row=><tr key={`${row.row_no}-${row.reference}-${row.manufacturer_label}`}><td>{row.reference||"—"}</td><td>{row.manufacturer_label||"—"}</td><td>{row.description||"—"}</td><td>{row.purchase_price_ht??"—"}</td><td>{row.source_stock_qty??"—"}</td><td>{row.source_cmm??"—"}</td><td>{row.source_pamp??"—"}</td><td>{row.location_code||"—"}</td><td>{row.category_code||"—"}</td><td>{row.accounting_class||"—"}</td></tr>)}</tbody></table></div><div className={styles.actions}><button className={styles.primary} disabled={busy||!rows.length} onClick={()=>void importCatalog()}>{busy?"IMPORT EN COURS…":"IMPORTER LE RÉFÉRENTIEL"}</button><div className={styles.progress}><i style={{width:`${progress}%`}}/></div><span className={styles.progressLabel}>{progress}% · {status}</span></div></section>
    </>}
    {report&&<section className={styles.card}><h2 className={styles.sectionTitle}>Rapport d'intégration</h2><div className={styles.reportGrid}><article className={styles.reportItem}><span>Lignes source</span><strong>{formatInt(Number(report.sourceRows)||0)}</strong></article><article className={styles.reportItem}><span>Fiches catalogue</span><strong>{formatInt(Number(report.uniqueCatalogItems)||0)}</strong></article><article className={styles.reportItem}><span>Références distinctes</span><strong>{formatInt(Number(report.distinctReferences)||0)}</strong></article><article className={styles.reportItem}><span>Marques</span><strong>{formatInt(Number(report.brands)||0)}</strong></article><article className={styles.reportItem}><span>Collisions multi-marques</span><strong>{formatInt(Number(report.crossBrandReferenceCollisions)||0)}</strong></article><article className={styles.reportItem}><span>Doublons Réf. + Marque</span><strong>{formatInt(Number(report.duplicateReferenceBrandRows)||0)}</strong></article></div></section>}
  </div></main>;
}
