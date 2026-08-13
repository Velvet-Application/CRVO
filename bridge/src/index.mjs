import crypto from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import * as XLSX from "@e965/xlsx";

function normalizeRemoteDir(value) {
  const normalized = String(value ?? "/").trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (!normalized || normalized === ".") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function boolEnv(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

const cfg = {
  // FTP_* est la configuration cible. Les anciens secrets SFTP_* restent acceptés
  // temporairement pour assurer une bascule sans interruption du job GitHub Actions.
  host: process.env.FTP_HOST ?? process.env.SFTP_HOST,
  port: Number(process.env.FTP_PORT ?? process.env.SFTP_PORT ?? "21"),
  username: process.env.FTP_USERNAME ?? process.env.SFTP_USERNAME,
  password: process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD,
  remoteDir: normalizeRemoteDir(process.env.FTP_REMOTE_DIR ?? process.env.SFTP_REMOTE_DIR ?? "/"),
  secure: boolEnv(process.env.FTP_SECURE, false),
  pattern: new RegExp(process.env.FTP_FILE_PATTERN ?? process.env.SFTP_FILE_PATTERN ?? "\\.(csv|xls|xlsx)$", "i"),
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
  secretKey: process.env.SUPABASE_SECRET_KEY,
  sourceId: process.env.KPI_SOURCE_ID,
  archiveBucket: process.env.SUPABASE_ARCHIVE_BUCKET ?? "kpi-raw-archive",
};

const required = {
  FTP_HOST: cfg.host,
  FTP_USERNAME: cfg.username,
  FTP_PASSWORD: cfg.password,
  FTP_REMOTE_DIR: cfg.remoteDir,
  SUPABASE_URL: cfg.supabaseUrl,
  SUPABASE_SECRET_KEY: cfg.secretKey,
  KPI_SOURCE_ID: cfg.sourceId,
};
const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
if (!Number.isFinite(cfg.port) || cfg.port <= 0) throw new Error("FTP_PORT must be a valid positive port number");

function apiHeaders(extra = {}) {
  const headers = { apikey: cfg.secretKey, "Content-Type": "application/json", ...extra };
  if (cfg.secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.secretKey}`;
  return headers;
}

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`);
}

async function supabase(pathname, init = {}) {
  const response = await fetch(`${cfg.supabaseUrl}${pathname}`, { ...init, headers: apiHeaders(init.headers ?? {}) });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("json") ? response.json() : response.text();
}

async function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function existingBatch(hash) {
  const rows = await supabase(`/rest/v1/kpi_import_batches?sha256=eq.${hash}&select=id,status&limit=1`, { method: "GET" });
  return rows?.[0] ?? null;
}

async function createBatch(file, hash, snapshotAt) {
  const [batch] = await supabase("/rest/v1/kpi_import_batches", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      source_id: cfg.sourceId,
      snapshot_at: snapshotAt,
      original_filename: file.name,
      sha256: hash,
      byte_size: file.size,
      status: "received",
      archive_status: "pending",
      metadata: { remote_path: file.remotePath, modified_at: file.modifyTime, source_priority: "ftp" },
    }),
  });
  return batch;
}

async function updateBatch(id, patch) {
  await supabase(`/rest/v1/kpi_import_batches?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
}

async function archiveOriginal(buffer, objectPath, contentType) {
  return supabase(`/storage/v1/object/${cfg.archiveBucket}/${objectPath}`, {
    method: "POST",
    headers: { "Content-Type": contentType, "x-upsert": "false" },
    body: buffer,
  });
}

async function ensureArchiveBucket() {
  const response = await fetch(`${cfg.supabaseUrl}/storage/v1/bucket/${cfg.archiveBucket}`, { headers: apiHeaders() });
  if (response.ok) return;
  if (response.status !== 404) throw new Error(`Bucket lookup failed: ${response.status} ${await response.text()}`);
  await supabase("/storage/v1/bucket", { method: "POST", body: JSON.stringify({ id: cfg.archiveBucket, name: cfg.archiveBucket, public: false }) });
}

async function readMappings() {
  return supabase(`/rest/v1/kpi_field_mappings?source_id=eq.${cfg.sourceId}&is_active=eq.true&select=source_field,target_metric_key,target_metric_label,aggregation`, { method: "GET" });
}

function rawCellValue(workbook, reference) {
  const separator = reference.lastIndexOf("!");
  if (separator <= 0) return undefined;
  const sheetName = reference.slice(0, separator).trim();
  const cell = reference.slice(separator + 1).trim().toUpperCase();
  return workbook.Sheets[sheetName]?.[cell]?.v;
}

function cellValue(workbook, sourceField) {
  const expressions = sourceField.split("+").map((part) => part.trim()).filter(Boolean);
  if (expressions.length === 1) return rawCellValue(workbook, expressions[0]);
  const values = expressions.map((reference) => Number(rawCellValue(workbook, reference)));
  return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function extractMetrics(buffer, filename, mappings) {
  if (!mappings.length) throw new Error("No active FTP field mappings configured");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });
  return mappings.flatMap((mapping) => {
    const raw = cellValue(workbook, mapping.source_field);
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    if (!Number.isFinite(value)) {
      log("mapping_skipped", { filename, sourceField: mapping.source_field, metric: mapping.target_metric_key, reason: "not_numeric" });
      return [];
    }
    return [{ metric_key: mapping.target_metric_key, metric_label: mapping.target_metric_label, metric_value: value, unit: "count", dimensions: {} }];
  });
}

function snapshotDate(file) {
  const iso = file.name.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const french = file.name.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/);
  if (french) return `${french[3]}-${french[2]}-${french[1]}`;
  log("snapshot_date_fallback", { filename: file.name, modifiedAt: file.modifyTime });
  return new Date(file.modifyTime || Date.now()).toISOString().slice(0, 10);
}

async function downloadToBuffer(client, remotePath) {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  await client.downloadTo(sink, remotePath);
  return Buffer.concat(chunks);
}

function modifiedTimestamp(remoteFile) {
  if (remoteFile.modifiedAt instanceof Date && Number.isFinite(remoteFile.modifiedAt.getTime())) return remoteFile.modifiedAt.getTime();
  return Date.now();
}

async function run() {
  const ftp = new FtpClient(30_000);
  ftp.ftp.verbose = false;
  const run = await supabase("/rest/v1/kpi_bridge_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "running", details: { protocol: cfg.secure ? "ftps" : "ftp", remote_dir: cfg.remoteDir } }) });
  const runId = run[0].id;
  let filesSeen = 0;
  let filesImported = 0;
  try {
    await ftp.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.username,
      password: cfg.password,
      secure: cfg.secure,
    });
    log("ftp_connected", { host: cfg.host, port: cfg.port, secure: cfg.secure, remoteDir: cfg.remoteDir });

    await ensureArchiveBucket();
    const mappings = await readMappings();
    log("mappings_loaded", { count: mappings.length });

    const remoteFiles = (await ftp.list(cfg.remoteDir)).filter((file) => cfg.pattern.test(file.name));
    filesSeen = remoteFiles.length;

    for (const remoteFile of remoteFiles) {
      const remotePath = path.posix.join(cfg.remoteDir, remoteFile.name);
      const buffer = await downloadToBuffer(ftp, remotePath);
      const hash = await sha256(buffer);
      if (await existingBatch(hash)) {
        log("duplicate_skipped", { filename: remoteFile.name, sha256: hash });
        continue;
      }

      const file = { name: remoteFile.name, size: remoteFile.size || buffer.length, modifyTime: modifiedTimestamp(remoteFile), remotePath };
      const date = snapshotDate(file);
      const batch = await createBatch(file, hash, date);
      const objectPath = `${date}/${hash}-${remoteFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

      try {
        await archiveOriginal(buffer, objectPath, "application/octet-stream");
        await updateBatch(batch.id, { status: "processing", archive_status: "stored", archive_object_path: objectPath });
        const metrics = extractMetrics(buffer, remoteFile.name, mappings).map((metric) => ({ ...metric, import_batch_id: batch.id }));
        if (metrics.length) await supabase("/rest/v1/kpi_snapshot_metrics", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(metrics) });
        await updateBatch(batch.id, { status: metrics.length ? "verified" : "archived", row_count: metrics.length });
        filesImported += 1;
        log("file_imported", { filename: remoteFile.name, snapshotAt: date, metrics: metrics.length, sha256: hash });
      } catch (error) {
        await updateBatch(batch.id, { status: "failed", metadata: { remote_path: remotePath, source_priority: "ftp", error: error instanceof Error ? error.message : "unknown" } });
        throw error;
      }
    }

    await supabase(`/rest/v1/kpi_bridge_runs?id=eq.${runId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ finished_at: new Date().toISOString(), status: "success", files_seen: filesSeen, files_imported: filesImported, details: { protocol: cfg.secure ? "ftps" : "ftp", remote_dir: cfg.remoteDir } }) });
    log("sync_completed", { filesSeen, filesImported });
  } catch (error) {
    await supabase(`/rest/v1/kpi_bridge_runs?id=eq.${runId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ finished_at: new Date().toISOString(), status: "failed", files_seen: filesSeen, files_imported: filesImported, details: { protocol: cfg.secure ? "ftps" : "ftp", remote_dir: cfg.remoteDir, error: error instanceof Error ? error.message : "unknown" } }) }).catch(() => undefined);
    throw error;
  } finally {
    ftp.close();
  }
}

await run();
