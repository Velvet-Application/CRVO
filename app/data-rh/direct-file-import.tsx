"use client";

import { DragEvent, useRef, useState } from "react";
import styles from "./data-rh.module.css";

type SourceKey = "rh" | "finance" | "billed_time";
type ImportResult = {
  imported?: boolean;
  duplicate?: boolean;
  rows?: number;
  updatedInvoices?: number;
  staffSaved?: number;
  dateRange?: { min?: string | null; max?: string | null };
  filename?: string;
  error?: string;
  detail?: string;
  headers?: string[];
  existing?: { status?: string; original_filename?: string };
};
type InitResult = {
  ready?: boolean;
  uploadUrl?: string;
  token?: string;
  sender?: string;
  expiresAt?: string;
  error?: string;
};

type Zone = {
  source: SourceKey;
  badge: string;
  title: string;
  subtitle: string;
  detail: string;
};

const zones: Zone[] = [
  { source: "rh", badge: "RH", title: "Data RH", subtitle: "Présence & temps", detail: "Date, nom/prénom, service, équipe, matricule, code pointage et durée." },
  { source: "billed_time", badge: "H", title: "Temps pointé facturé", subtitle: "Heures par dossier", detail: "OR / facture, collaborateur et heures pointées." },
  { source: "finance", badge: "CA", title: "Factures & chiffre d’affaires", subtitle: "CA réalisé", detail: "Date et numéro de facture, dossier, client et montants." },
];

function compactDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
async function readPayload<T extends {error?:string}>(response:Response, fallback:string):Promise<T>{
  const text=await response.text();
  if(!text){
    if(response.status===546)return {error:"Le moteur d’analyse a dépassé sa limite de ressources. Le fichier est désormais préparé dans le navigateur avant envoi ; recharge la page puis réessaie."} as T;
    return {error:`${fallback} (HTTP ${response.status}).`} as T;
  }
  try{return JSON.parse(text) as T;}catch{
    if(response.status===546)return {error:"Le moteur d’analyse a dépassé sa limite de ressources. Recharge la page puis réessaie avec la nouvelle version."} as T;
    return {error:`${fallback} (HTTP ${response.status}) · ${text.slice(0,180).replace(/\s+/g," ")}`} as T;
  }
}

async function prepareUploadFile(file: File) {
  if (/\.csv$/i.test(file.name)) return file;
  if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Format refusé. Utilise CSV, XLSX ou XLS.");

  const XLSX = await import("@e965/xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("Le classeur Excel ne contient aucune feuille exploitable.");

  let bestSheet = workbook.Sheets[workbook.SheetNames[0]];
  let bestRows = -1;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    const rowCount = grid.filter((row) => Array.isArray(row) && row.some((value) => String(value ?? "").trim())).length;
    if (rowCount > bestRows) {
      bestRows = rowCount;
      bestSheet = sheet;
    }
  }
  if (!bestSheet || bestRows <= 0) throw new Error("Le classeur Excel ne contient aucune donnée exploitable.");

  const csv = XLSX.utils.sheet_to_csv(bestSheet, { FS: ";", RS: "\n", blankrows: false });
  if (!csv.trim()) throw new Error("La feuille Excel sélectionnée est vide.");
  const stem = file.name.replace(/\.(xlsx|xls)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new File([csv], `${stem || "export"}.csv`, { type: "text/csv", lastModified: file.lastModified });
}

function UploadZone({ zone }: { zone: Zone }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload(file?: File) {
    if (!file || loading) return;
    setFileName(file.name);
    setResult(null);
    setLoading(true);
    try {
      const preparedFile = await prepareUploadFile(file);
      const initResponse = await fetch("/api/data-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: zone.source, filename: preparedFile.name, byteSize: preparedFile.size }),
      });
      const init = await readPayload<InitResult>(initResponse,"Initialisation de l'import illisible");
      if (!initResponse.ok || !init.ready || !init.uploadUrl || !init.token) {
        throw new Error(init.error || `Initialisation refusée (${initResponse.status}).`);
      }

      const body = new FormData();
      body.set("file", preparedFile, preparedFile.name);
      body.set("source", zone.source);
      body.set("sender", init.sender || "KPI CRVO");
      body.set("messageId", `direct-${Date.now()}-${crypto.randomUUID()}`);
      body.set("originalFilename", file.name);

      let uploadResponse:Response;
      try{
        uploadResponse=await fetch(init.uploadUrl,{
          method:"POST",
          headers:{"x-crvo-ingest-token":init.token},
          body,
        });
      }catch(error){
        throw new Error(error instanceof Error?`Envoi du fichier impossible : ${error.message}`:"Envoi du fichier impossible.");
      }
      const payload=await readPayload<ImportResult>(uploadResponse,"Réponse d'analyse illisible");
      if(!uploadResponse.ok)throw new Error(payload.error||`Import refusé (${uploadResponse.status}).`);
      setResult(payload);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Import impossible." });
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files?.[0]);
  }

  const min = compactDate(result?.dateRange?.min);
  const max = compactDate(result?.dateRange?.max);
  const range = min && max ? (min === max ? min : `${min} → ${max}`) : null;

  return <article className={styles.uploadCard}>
    <div className={styles.uploadHead}><span>{zone.badge}</span><div><strong>{zone.title}</strong><small>{zone.subtitle}</small></div></div>
    <div
      className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""} ${result?.error ? styles.dropZoneError : result?.imported || result?.duplicate ? styles.dropZoneSuccess : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
    >
      <input ref={inputRef} className={styles.fileInput} type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void upload(event.target.files?.[0])}/>
      <b>{loading ? "Préparation, analyse et intégration…" : "Glisse le fichier ici"}</b>
      <span>{loading ? fileName : "ou clique pour choisir un fichier"}</span>
      <small>CSV · XLSX · XLS · 25 Mo max</small>
    </div>
    <p className={styles.uploadHint}>{zone.detail}</p>
    {result?.imported && <div className={styles.importOk}><strong>IMPORTÉ</strong><span>{result.rows ?? 0} lignes intégrées{range ? ` · ${range}` : ""}{zone.source === "rh" && result.staffSaved ? ` · ${result.staffSaved} collaborateurs détectés` : ""}{zone.source === "billed_time" && result.updatedInvoices ? ` · ${result.updatedInvoices} factures rapprochées` : ""}</span></div>}
    {result?.duplicate && <div className={styles.importDuplicate}><strong>DÉJÀ INTÉGRÉ</strong><span>{result.existing?.original_filename || fileName}</span></div>}
    {result?.error && <div className={styles.importError}><strong>À CORRIGER</strong><span>{result.error}</span></div>}
  </article>;
}

export default function DirectFileImport() {
  return <section className={styles.importSection}>
    <div className={styles.importTitle}><div><span>IMPORT DIRECT</span><h2>Dépose les 3 fichiers</h2></div><p>Les fichiers Excel sont préparés localement dans ton navigateur avant l’analyse serveur. Cela évite les limites de ressources tout en gardant le dépôt simple : glisser, contrôler, intégrer.</p></div>
    <div className={styles.uploadGrid}>{zones.map((zone) => <UploadZone key={zone.source} zone={zone}/>)}</div>
  </section>;
}
