"use client";

import { DragEvent, useRef, useState } from "react";
import styles from "./data-rh.module.css";

type SourceKey = "rh" | "finance" | "billed_time";
type ImportResult = {
  imported?: boolean;
  duplicate?: boolean;
  rows?: number;
  updatedInvoices?: number;
  dateRange?: { min?: string | null; max?: string | null };
  filename?: string;
  error?: string;
  existing?: { status?: string; original_filename?: string };
};

type Zone = {
  source: SourceKey;
  badge: string;
  title: string;
  subtitle: string;
  detail: string;
};

const zones: Zone[] = [
  { source: "rh", badge: "RH", title: "Data RH", subtitle: "Présence & temps", detail: "Date, collaborateur, code temps et durée." },
  { source: "billed_time", badge: "H", title: "Temps pointé facturé", subtitle: "Heures par dossier", detail: "OR / facture, collaborateur et heures pointées." },
  { source: "finance", badge: "CA", title: "Factures & chiffre d’affaires", subtitle: "CA réalisé", detail: "Date et numéro de facture, dossier, client et montants." },
];

function compactDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
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
      const body = new FormData();
      body.set("file", file, file.name);
      body.set("source", zone.source);
      const response = await fetch("/api/data-import", { method: "POST", body });
      const payload = await response.json().catch(() => ({ error: "Réponse serveur illisible." })) as ImportResult;
      if (!response.ok) throw new Error(payload.error || `Import refusé (${response.status}).`);
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
      <b>{loading ? "Analyse et intégration…" : "Glisse le fichier ici"}</b>
      <span>{loading ? fileName : "ou clique pour choisir un fichier"}</span>
      <small>CSV · XLSX · XLS · 25 Mo max</small>
    </div>
    <p className={styles.uploadHint}>{zone.detail}</p>
    {result?.imported && <div className={styles.importOk}><strong>IMPORTÉ</strong><span>{result.rows ?? 0} lignes intégrées{range ? ` · ${range}` : ""}{zone.source === "billed_time" && result.updatedInvoices ? ` · ${result.updatedInvoices} factures rapprochées` : ""}</span></div>}
    {result?.duplicate && <div className={styles.importDuplicate}><strong>DÉJÀ INTÉGRÉ</strong><span>{result.existing?.original_filename || fileName}</span></div>}
    {result?.error && <div className={styles.importError}><strong>À CORRIGER</strong><span>{result.error}</span></div>}
  </article>;
}

export default function DirectFileImport() {
  return <section className={styles.importSection}>
    <div className={styles.importTitle}><div><span>IMPORT DIRECT</span><h2>Dépose les 3 fichiers</h2></div><p>Chaque fichier est contrôlé, archivé, analysé puis intégré dans son jeu de données. Un même fichier ne peut pas être intégré deux fois.</p></div>
    <div className={styles.uploadGrid}>{zones.map((zone) => <UploadZone key={zone.source} zone={zone}/>)}</div>
  </section>;
}
