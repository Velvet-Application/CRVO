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
type RhBatchStart = ImportResult & { ready?: boolean; batchId?: string };
type RhRow = {
  row_index: number;
  work_date: string;
  mechanic_name: string;
  time_code: string | null;
  time_description: string | null;
  time_value: number;
  matricule: string | null;
  service: string | null;
  team_code: string | null;
  first_name: string | null;
  last_name: string | null;
};
type Zone = { source: SourceKey; badge: string; title: string; subtitle: string; detail: string };

const zones: Zone[] = [
  { source: "rh", badge: "RH", title: "Data RH", subtitle: "Présence & temps", detail: "Date, nom/prénom, service, équipe, matricule, code pointage et durée." },
  { source: "billed_time", badge: "H", title: "Temps pointé facturé", subtitle: "Heures par dossier", detail: "OR / facture, collaborateur et heures pointées." },
  { source: "finance", badge: "CA", title: "Factures & chiffre d’affaires", subtitle: "CA réalisé", detail: "Date et numéro de facture, dossier, client et montants." },
];

function compactDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}
async function readPayload<T extends { error?: string }>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  if (!text) return { error: `${fallback} (HTTP ${response.status}).` } as T;
  try { return JSON.parse(text) as T; }
  catch { return { error: `${fallback} (HTTP ${response.status}) · ${text.slice(0, 180).replace(/\s+/g, " ")}` } as T; }
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
    if (rowCount > bestRows) { bestRows = rowCount; bestSheet = sheet; }
  }
  if (!bestSheet || bestRows <= 0) throw new Error("Le classeur Excel ne contient aucune donnée exploitable.");
  const csv = XLSX.utils.sheet_to_csv(bestSheet, { FS: ";", RS: "\n", blankrows: false });
  if (!csv.trim()) throw new Error("La feuille Excel sélectionnée est vide.");
  const stem = file.name.replace(/\.(xlsx|xls)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return new File([csv], `${stem || "export"}.csv`, { type: "text/csv", lastModified: file.lastModified });
}

function key(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function text(value: unknown, max = 300) { const valueText = String(value ?? "").trim(); return valueText ? valueText.slice(0, max) : null; }
function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let source = String(value ?? "").trim().replace(/[\s\u00a0€]/g, "").replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  const comma = source.lastIndexOf(","), dot = source.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) source = comma > dot ? source.replace(/\./g, "").replace(",", ".") : source.replace(/,/g, "");
  else if (comma >= 0) source = source.replace(",", ".");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}
function dateValue(value: unknown) {
  const source = String(value ?? "").trim();
  let match = source.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return null;
}
function pick(row: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[key(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

const rhHeaderHints = new Set([
  "date", "work_date", "date_pointage", "codet", "type_temps", "nombre_heures", "nom_prenom", "nom_et_prenom",
  "collaborateur", "code_pointage", "code_temps", "duree", "heures", "matricule", "service", "equipe", "team",
]);
function parseDelimited(source: string) {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].map((item) => ({ item, count: firstLine.split(item).length })).sort((a, b) => b.count - a.count)[0]?.item ?? ";";
  const grid: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) grid.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell); if (row.some((value) => value.trim())) grid.push(row);
  if (!grid.length) return { headers: [] as string[], rows: [] as Record<string, unknown>[] };
  const headerIndex = grid.slice(0, 30).map((values, index) => {
    const normalized = values.map(key).filter(Boolean);
    return { index, score: normalized.filter((item) => rhHeaderHints.has(item)).length * 20 + Math.min(normalized.length, 12) };
  }).sort((a, b) => b.score - a.score)[0]?.index ?? 0;
  const seen = new Map<string, number>();
  const headers = (grid[headerIndex] ?? []).map((value, index) => key(value) || `col_${index + 1}`).map((name) => {
    const count = (seen.get(name) ?? 0) + 1; seen.set(name, count); return count === 1 ? name : `${name}_${count}`;
  });
  const rows = grid.slice(headerIndex + 1).filter((values) => values.some((value) => value.trim())).map((values) => {
    const record: Record<string, unknown> = {};
    headers.forEach((name, index) => { record[name] = values[index] ?? null; });
    return record;
  });
  return { headers, rows };
}
async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function normalizeRh(file: File) {
  const parsed = parseDelimited(await file.text());
  const rows: RhRow[] = [];
  for (let index = 0; index < parsed.rows.length; index++) {
    const row = parsed.rows[index];
    const workDate = dateValue(pick(row, ["date", "work_date", "date_pointage"]));
    const mechanicName = text(pick(row, ["nom_prenom", "nom_et_prenom", "collaborateur", "salarie", "salarié", "mechanic_name", "mecanicien", "operateur", "nom"]), 250);
    const timeValue = numberValue(pick(row, ["nombre_heures", "time_value", "temps", "heures", "duree", "durée"]));
    if (!workDate || !mechanicName || timeValue === null) continue;
    const rawTeam = key(pick(row, ["equipe", "équipe", "team", "equipe_code", "groupe"]));
    const teamMatch = rawTeam.match(/(?:^|_)(?:equipe_?|team_?)?([abc])(?:_|$)/) || rawTeam.match(/^([abc])$/);
    rows.push({
      row_index: index + 1,
      work_date: workDate,
      mechanic_name: mechanicName,
      time_code: text(pick(row, ["codet", "time_code", "code_pointage", "code_temps", "code"]), 80),
      time_description: text(pick(row, ["type_temps", "time_description", "libelle", "description"])),
      time_value: timeValue,
      matricule: text(pick(row, ["matricule", "employee_id", "id_salarie", "code_salarie"]), 100),
      service: text(pick(row, ["service", "secteur", "atelier", "department", "departement"]), 160),
      team_code: teamMatch ? teamMatch[1].toUpperCase() : null,
      first_name: text(pick(row, ["prenom", "prénom", "first_name", "firstname"]), 120),
      last_name: text(pick(row, ["nom_famille", "last_name", "lastname"]), 120),
    });
  }
  if (!rows.length) throw new Error(`Aucune ligne RH reconnue. Colonnes détectées : ${parsed.headers.join(", ") || "aucune"}.`);
  const dates = rows.map((row) => row.work_date).sort();
  return { rows, headers: parsed.headers, minDate: dates[0], maxDate: dates.at(-1)!, sha256: await sha256File(file) };
}

function UploadZone({ zone }: { zone: Zone }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  async function uploadRh(file: File, preparedFile: File) {
    setProgress("Lecture du fichier RH sur ton poste…");
    const normalized = await normalizeRh(preparedFile);
    setProgress(`${normalized.rows.length.toLocaleString("fr-FR")} lignes reconnues · préparation de l’intégration…`);
    const startResponse = await fetch("/api/data-import/rh-batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", filename: file.name, sha256: normalized.sha256, byteSize: preparedFile.size, minDate: normalized.minDate, maxDate: normalized.maxDate, totalRows: normalized.rows.length, headers: normalized.headers }),
    });
    const start = await readPayload<RhBatchStart>(startResponse, "Initialisation RH illisible");
    if (!startResponse.ok) throw new Error(start.error || `Initialisation RH refusée (${startResponse.status}).`);
    if (start.duplicate) { setResult(start); return; }
    if (!start.ready || !start.batchId) throw new Error("Le serveur n’a pas créé le lot RH.");

    const chunkSize = 1500;
    for (let offset = 0; offset < normalized.rows.length; offset += chunkSize) {
      const chunk = normalized.rows.slice(offset, offset + chunkSize);
      const response = await fetch("/api/data-import/rh-batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chunk", batchId: start.batchId, rows: chunk }),
      });
      const payload = await readPayload<{ error?: string }>(response, "Bloc RH illisible");
      if (!response.ok) throw new Error(payload.error || `Intégration RH interrompue (${response.status}).`);
      const done = Math.min(offset + chunk.length, normalized.rows.length);
      setProgress(`Intégration RH ${Math.round(done / normalized.rows.length * 100)} % · ${done.toLocaleString("fr-FR")} / ${normalized.rows.length.toLocaleString("fr-FR")} lignes`);
    }
    setProgress("Finalisation des heures de présence…");
    const finishResponse = await fetch("/api/data-import/rh-batch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finish", batchId: start.batchId }),
    });
    const finish = await readPayload<ImportResult>(finishResponse, "Finalisation RH illisible");
    if (!finishResponse.ok || !finish.imported) throw new Error(finish.error || `Finalisation RH refusée (${finishResponse.status}).`);
    setResult(finish);
  }

  async function upload(file?: File) {
    if (!file || loading) return;
    setFileName(file.name); setResult(null); setProgress(""); setLoading(true);
    try {
      const preparedFile = await prepareUploadFile(file);
      if (zone.source === "rh") {
        await uploadRh(file, preparedFile);
        return;
      }
      const initResponse = await fetch("/api/data-import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: zone.source, filename: preparedFile.name, byteSize: preparedFile.size }),
      });
      const init = await readPayload<InitResult>(initResponse, "Initialisation de l'import illisible");
      if (!initResponse.ok || !init.ready || !init.uploadUrl || !init.token) throw new Error(init.error || `Initialisation refusée (${initResponse.status}).`);
      const body = new FormData();
      body.set("file", preparedFile, preparedFile.name); body.set("source", zone.source); body.set("sender", init.sender || "KPI CRVO");
      body.set("messageId", `direct-${Date.now()}-${crypto.randomUUID()}`); body.set("originalFilename", file.name);
      const uploadResponse = await fetch(init.uploadUrl, { method: "POST", headers: { "x-crvo-ingest-token": init.token }, body });
      const payload = await readPayload<ImportResult>(uploadResponse, "Réponse d'analyse illisible");
      if (!uploadResponse.ok) throw new Error(payload.error || `Import refusé (${uploadResponse.status}).`);
      setResult(payload);
    } catch (error) { setResult({ error: error instanceof Error ? error.message : "Import impossible." }); }
    finally { setLoading(false); setProgress(""); if (inputRef.current) inputRef.current.value = ""; }
  }

  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files?.[0]); }
  const min = compactDate(result?.dateRange?.min), max = compactDate(result?.dateRange?.max);
  const range = min && max ? (min === max ? min : `${min} → ${max}`) : null;

  return <article className={styles.uploadCard}>
    <div className={styles.uploadHead}><span>{zone.badge}</span><div><strong>{zone.title}</strong><small>{zone.subtitle}</small></div></div>
    <div className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""} ${result?.error ? styles.dropZoneError : result?.imported || result?.duplicate ? styles.dropZoneSuccess : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={drop}
      onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
      <input ref={inputRef} className={styles.fileInput} type="file" accept=".csv,.xlsx,.xls" onChange={(event) => void upload(event.target.files?.[0])}/>
      <b>{loading ? "Analyse et intégration…" : "Glisse le fichier ici"}</b>
      <span>{loading ? (progress || fileName) : "ou clique pour choisir un fichier"}</span>
      <small>CSV · XLSX · XLS · 25 Mo max</small>
    </div>
    <p className={styles.uploadHint}>{zone.detail}</p>
    {result?.imported && <div className={styles.importOk}><strong>IMPORTÉ</strong><span>{result.rows ?? 0} lignes intégrées{range ? ` · ${range}` : ""}{zone.source === "rh" && result.staffSaved ? ` · ${result.staffSaved} collaborateurs détectés` : ""}{zone.source === "billed_time" && result.updatedInvoices ? ` · ${result.updatedInvoices} factures rapprochées` : ""}</span></div>}
    {result?.duplicate && <div className={styles.importDuplicate}><strong>DÉJÀ INTÉGRÉ</strong><span>{result.filename || result.existing?.original_filename || fileName}</span></div>}
    {result?.error && <div className={styles.importError}><strong>À CORRIGER</strong><span>{result.error}</span></div>}
  </article>;
}

export default function DirectFileImport() {
  return <section className={styles.importSection}>
    <div className={styles.importTitle}><div><span>IMPORT DIRECT</span><h2>Dépose les 3 fichiers</h2></div><p>Le fichier RH est lu localement puis intégré par petits blocs sécurisés. Les gros exports ne dépendent plus de la limite de calcul des fonctions Supabase.</p></div>
    <div className={styles.uploadGrid}>{zones.map((zone) => <UploadZone key={zone.source} zone={zone}/>)}</div>
  </section>;
}
