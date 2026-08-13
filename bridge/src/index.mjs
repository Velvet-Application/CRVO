import crypto from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import * as XLSX from "@e965/xlsx";
import { parseEtatduParcVehicleState } from "./ftp-vehicle-state.mjs";

function normalizeRemoteDir(value) {
  const normalized = String(value ?? "/").trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (!normalized || normalized === ".") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function boolEnv(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const cfg = {
  host: process.env.FTP_HOST ?? process.env.SFTP_HOST,
  port: Number(process.env.FTP_PORT ?? process.env.SFTP_PORT ?? "21"),
  username: process.env.FTP_USERNAME ?? process.env.SFTP_USERNAME,
  password: process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD,
  remoteDir: normalizeRemoteDir(process.env.FTP_REMOTE_DIR ?? process.env.SFTP_REMOTE_DIR ?? "/"),
  secure: boolEnv(process.env.FTP_SECURE, false),
  pattern: new RegExp(process.env.FTP_FILE_PATTERN || process.env.SFTP_FILE_PATTERN || "\\.(csv|xls|xlsx)$", "i"),
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
  sourceId: process.env.KPI_SOURCE_ID,
};

const required = { FTP_PASSWORD: cfg.password, SUPABASE_URL: cfg.supabaseUrl, KPI_SOURCE_ID: cfg.sourceId };
const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

const gatewayUrl = `${cfg.supabaseUrl}/functions/v1/kpi-ftp-bridge-gateway`;
const gatewayToken = hash(`kpi-crvo-ftp-bridge:v1:${cfg.password}`);

function log(event, details = {}) { process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`); }

async function gateway(action, { method = "POST", body, params = {}, allowedStatuses = [] } = {}) {
  const url = new URL(gatewayUrl);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { method, headers: { "x-kpi-bridge-token": gatewayToken, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !allowedStatuses.includes(response.status)) throw new Error(`KPI gateway ${response.status}: ${payload.error ?? "unknown error"}`);
  return { status: response.status, payload };
}

async function readConnection() {
  const { payload } = await gateway("connection", { method: "GET", params: { sourceId: cfg.sourceId } });
  const connection = { host: String(payload.host || cfg.host || "").trim(), port: Number(payload.port || cfg.port || 21), username: String(payload.username || cfg.username || "").trim(), password: cfg.password, remoteDir: normalizeRemoteDir(payload.remoteDir || cfg.remoteDir || "/"), secure: typeof payload.secure === "boolean" ? payload.secure : cfg.secure };
  if (!connection.host) throw new Error("FTP host is missing from the active source configuration");
  if (!connection.username) throw new Error("FTP username is missing from the active source configuration");
  if (!Number.isFinite(connection.port) || connection.port <= 0) throw new Error("FTP port must be a valid positive port number");
  return connection;
}

async function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
async function readMappings() { const { payload } = await gateway("mappings", { method: "GET", params: { sourceId: cfg.sourceId } }); return Array.isArray(payload.mappings) ? payload.mappings : []; }

function rawCellValue(workbook, reference) { const separator = reference.lastIndexOf("!"); if (separator <= 0) return undefined; const sheetName = reference.slice(0, separator).trim(); const cell = reference.slice(separator + 1).trim().toUpperCase(); return workbook.Sheets[sheetName]?.[cell]?.v; }
function cellValue(workbook, sourceField) { const expressions = sourceField.split("+").map((part) => part.trim()).filter(Boolean); if (expressions.length === 1) return rawCellValue(workbook, expressions[0]); const rawValues = expressions.map((reference) => rawCellValue(workbook, reference)); if (rawValues.some((value) => value === undefined || value === null || String(value).trim() === "")) return undefined; const values = rawValues.map((value) => Number(value)); return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : undefined; }

function extractMetrics(buffer, filename, mappings) {
  if (!mappings.length) throw new Error("No active FTP field mappings configured");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });
  return mappings.flatMap((mapping) => {
    const raw = cellValue(workbook, mapping.source_field);
    if (raw === undefined || raw === null || String(raw).trim() === "") { log("mapping_skipped", { filename, sourceField: mapping.source_field, metric: mapping.target_metric_key, reason: "missing" }); return []; }
    const value = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (!Number.isFinite(value)) { log("mapping_skipped", { filename, sourceField: mapping.source_field, metric: mapping.target_metric_key, reason: "not_numeric" }); return []; }
    return [{ metric_key: mapping.target_metric_key, metric_label: mapping.target_metric_label, metric_value: value, unit: "count", dimensions: {} }];
  });
}

function csvWorkbook(buffer) { const workbook = XLSX.read(buffer, { type: "buffer", raw: true, dense: false }); const sheetName = workbook.SheetNames[0]; const sheet = sheetName ? workbook.Sheets[sheetName] : undefined; return { workbook, sheet }; }
function inspectCsvSchema(buffer) { const { sheet } = csvWorkbook(buffer); if (!sheet) return { headers: [], rowCount: 0 }; const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false }); const first = Array.isArray(rows[0]) ? rows[0] : []; const headers = first.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 120); return { headers, rowCount: Math.max(0, rows.length - 1) }; }
function csvObjects(buffer) { const { sheet } = csvWorkbook(buffer); if (!sheet) return []; return XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "", blankrows: false }); }
function topCounts(rows, key, limit = 25) { const counts = new Map(); for (const row of rows) { const value = String(row[key] ?? "").trim(); if (!value) continue; counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count })); }

function businessDiagnostics(buffer, filename) {
  const rows = csvObjects(buffer); if (!rows.length) return null;
  if (/^Factory-j\+1\.csv$/i.test(filename)) { const safeFields = ["CAL_DATE", "RDT_LIBELLE", "En attente de transport", "Réceptionnés", "Expertises Dynamiques", "Lavages", "Expertises", "Mecaniques", "Carrosseries", "Fixline 1", "Fixline 2", "Fixline 3", "DSP", "Préparations", "Photos", "Qualités", "Jantes", "Restor-FX", "CT", "Disponibles"]; return { type: "factory_today", rows: rows.slice(0, 50).map((row) => Object.fromEntries(safeFields.map((field) => [field, row[field] ?? ""]))) }; }
  if (/^EtatduParc\.csv$/i.test(filename)) { const flags = ["Mécanique", "Carrosserie", "CT", "DSP", "Jantes", "Pièce disponible", "Pièce commandée (Durée Jours Ou"]; return { type: "park_live", statusCounts: topCounts(rows, "Dernier statut"), alertCounts: topCounts(rows, "Alerte"), urgencyCounts: topCounts(rows, "Urgence"), flagCounts: Object.fromEntries(flags.map((field) => [field, rows.filter((row) => String(row[field] ?? "").trim() !== "").length])) }; }
  if (/^LeadTimeFactoryBI\.csv$/i.test(filename)) return { type: "lead_time", fluxCounts: topCounts(rows, "Flux"), stateCounts: topCounts(rows, "Etat actuel") };
  if (/^Analyse-Temps-Bruts\.csv$/i.test(filename)) return { type: "status_history", fluxCounts: topCounts(rows, "Flux"), statusCounts: topCounts(rows, "Statut", 40) };
  return null;
}

function snapshotDate(file) { const iso = file.name.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`; const french = file.name.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/); if (french) return `${french[3]}-${french[2]}-${french[1]}`; log("snapshot_date_fallback", { filename: file.name, modifiedAt: file.modifyTime }); return new Date(file.modifyTime || Date.now()).toISOString().slice(0, 10); }

async function downloadToBuffer(client, remotePath) { const chunks = []; const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); callback(); } }); await client.downloadTo(sink, remotePath); return Buffer.concat(chunks); }
function modifiedTimestamp(remoteFile) { if (remoteFile.modifiedAt instanceof Date && Number.isFinite(remoteFile.modifiedAt.getTime())) return remoteFile.modifiedAt.getTime(); return Date.now(); }

async function prepareImport(file, buffer, fileHash, snapshotAt) {
  const { status, payload } = await gateway("init", { body: { sourceId: cfg.sourceId, filename: file.name, byteSize: file.size || buffer.length, sha256: fileHash, snapshotAt, remotePath: file.remotePath, modifiedAt: file.modifyTime }, allowedStatuses: [409] });
  if (status === 409 && payload.duplicate) return { duplicate: true, batchId: payload.batchId, signedUrl: null, archivePresent: true, vehicleStateReady: Boolean(payload.vehicleStateReady) };
  if (!payload.batchId || (!payload.signedUrl && !payload.archivePresent)) throw new Error("KPI gateway returned an incomplete FTP import preparation");
  return { duplicate: false, batchId: payload.batchId, signedUrl: payload.signedUrl ?? null, archivePresent: Boolean(payload.archivePresent), vehicleStateReady: Boolean(payload.vehicleStateReady) };
}

async function uploadArchive(signedUrl, buffer) { const response = await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" }, body: buffer }); if (!response.ok) throw new Error(`Archive upload failed: ${response.status} ${await response.text()}`); }

async function syncEtatduParc(batchId, buffer, snapshotAt, sourceModifiedAt) {
  const rows = parseEtatduParcVehicleState(buffer, { snapshotAt, sourceModifiedAt });
  const chunkSize = 350;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    await gateway("vehicle-state", { body: { batchId, rows: chunk, reset: offset === 0, complete: offset + chunkSize >= rows.length } });
  }
  log("ftp_vehicle_state_loaded", { filename: "EtatduParc.csv", batchId, rows: rows.length, snapshotAt });
}

async function run() {
  const ftp = new FtpClient(30_000); ftp.ftp.verbose = false;
  let runId = null; let filesSeen = 0; let filesImported = 0; let filesArchivedPendingMapping = 0; let connection = null;
  try {
    connection = await readConnection();
    const started = await gateway("start-run", { body: { details: { protocol: connection.secure ? "ftps" : "ftp", remote_dir: connection.remoteDir } } }); runId = started.payload.runId ?? null;
    await ftp.access({ host: connection.host, port: connection.port, user: connection.username, password: connection.password, secure: connection.secure });
    log("ftp_connected", { host: connection.host, port: connection.port, secure: connection.secure, remoteDir: connection.remoteDir });
    const mappings = await readMappings(); log("mappings_loaded", { count: mappings.length });
    const remoteFiles = (await ftp.list(connection.remoteDir)).filter((file) => cfg.pattern.test(file.name)); filesSeen = remoteFiles.length; log("ftp_files_listed", { count: filesSeen });

    for (const remoteFile of remoteFiles) {
      const remotePath = path.posix.join(connection.remoteDir, remoteFile.name);
      const buffer = await downloadToBuffer(ftp, remotePath);
      const fileHash = await sha256(buffer);
      const file = { name: remoteFile.name, size: remoteFile.size || buffer.length, modifyTime: modifiedTimestamp(remoteFile), remotePath };
      const date = snapshotDate(file);
      const csvSchema = /\.csv$/i.test(remoteFile.name) ? inspectCsvSchema(buffer) : null;
      if (csvSchema) { log("csv_schema_detected", { filename: remoteFile.name, rowCount: csvSchema.rowCount, headers: csvSchema.headers }); const diagnostics = businessDiagnostics(buffer, remoteFile.name); if (diagnostics) log("csv_business_diagnostics", { filename: remoteFile.name, diagnostics }); }

      const prepared = await prepareImport(file, buffer, fileHash, date);
      if (prepared.signedUrl) await uploadArchive(prepared.signedUrl, buffer);

      if (/^EtatduParc\.csv$/i.test(remoteFile.name) && (!prepared.duplicate || !prepared.vehicleStateReady)) {
        await syncEtatduParc(prepared.batchId, buffer, date, file.modifyTime);
      }

      if (prepared.duplicate) { log("duplicate_skipped", { filename: remoteFile.name, sha256: fileHash }); continue; }

      if (csvSchema) {
        await gateway("archive-only", { body: { batchId: prepared.batchId, metadata: { mapping_status: "pending_csv_schema", csv_headers: csvSchema.headers, csv_row_count: csvSchema.rowCount } } });
        filesArchivedPendingMapping += 1; continue;
      }

      const metrics = extractMetrics(buffer, remoteFile.name, mappings);
      if (!metrics.length) { await gateway("archive-only", { body: { batchId: prepared.batchId, metadata: { mapping_status: "no_matching_excel_metrics" } } }); filesArchivedPendingMapping += 1; log("file_archived_without_metrics", { filename: remoteFile.name, snapshotAt: date }); continue; }
      const finalized = await gateway("finalize", { body: { batchId: prepared.batchId, metrics } }); filesImported += 1; log("file_imported", { filename: remoteFile.name, snapshotAt: date, metrics: finalized.payload.metrics ?? metrics.length, sha256: fileHash });
    }

    const details = { protocol: connection.secure ? "ftps" : "ftp", remote_dir: connection.remoteDir, files_archived_pending_mapping: filesArchivedPendingMapping };
    if (runId) await gateway("finish-run", { body: { runId, status: "success", filesSeen, filesImported, details } });
    log("sync_completed", { filesSeen, filesImported, filesArchivedPendingMapping });
  } catch (error) {
    if (runId) await gateway("finish-run", { body: { runId, status: "failed", filesSeen, filesImported, details: { protocol: connection?.secure ? "ftps" : "ftp", remote_dir: connection?.remoteDir ?? "/", files_archived_pending_mapping: filesArchivedPendingMapping, error: error instanceof Error ? error.message : "unknown" } } }).catch(() => undefined);
    throw error;
  } finally { ftp.close(); }
}

await run();
