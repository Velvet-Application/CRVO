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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const cfg = {
  // FTP_* est la configuration cible. Les anciens secrets SFTP_* restent acceptés
  // pendant la transition pour ne pas casser la planification déjà en place.
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

const required = {
  FTP_HOST: cfg.host,
  FTP_USERNAME: cfg.username,
  FTP_PASSWORD: cfg.password,
  FTP_REMOTE_DIR: cfg.remoteDir,
  SUPABASE_URL: cfg.supabaseUrl,
  KPI_SOURCE_ID: cfg.sourceId,
};
const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
if (!Number.isFinite(cfg.port) || cfg.port <= 0) throw new Error("FTP_PORT must be a valid positive port number");

const gatewayUrl = `${cfg.supabaseUrl}/functions/v1/kpi-ftp-bridge-gateway`;
// Jeton dédié au bridge : il est dérivé du mot de passe FTP et ne réutilise jamais
// ce mot de passe lui-même comme authentifiant HTTP.
const gatewayToken = hash(`kpi-crvo-ftp-bridge:v1:${cfg.password}`);

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`);
}

async function gateway(action, { method = "POST", body, params = {}, allowedStatuses = [] } = {}) {
  const url = new URL(gatewayUrl);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers: {
      "x-kpi-bridge-token": gatewayToken,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(`KPI gateway ${response.status}: ${payload.error ?? "unknown error"}`);
  }
  return { status: response.status, payload };
}

async function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readMappings() {
  const { payload } = await gateway("mappings", { method: "GET", params: { sourceId: cfg.sourceId } });
  return Array.isArray(payload.mappings) ? payload.mappings : [];
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
    return [{
      metric_key: mapping.target_metric_key,
      metric_label: mapping.target_metric_label,
      metric_value: value,
      unit: "count",
      dimensions: {},
    }];
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

async function prepareImport(file, buffer, fileHash, snapshotAt) {
  const { status, payload } = await gateway("init", {
    body: {
      sourceId: cfg.sourceId,
      filename: file.name,
      byteSize: file.size || buffer.length,
      sha256: fileHash,
      snapshotAt,
      remotePath: file.remotePath,
      modifiedAt: file.modifyTime,
    },
    allowedStatuses: [409],
  });
  if (status === 409 && payload.duplicate) return { duplicate: true, batchId: payload.batchId };
  if (!payload.batchId || !payload.signedUrl) throw new Error("KPI gateway returned an incomplete FTP import preparation");
  return { duplicate: false, batchId: payload.batchId, signedUrl: payload.signedUrl };
}

async function uploadArchive(signedUrl, buffer) {
  const response = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" },
    body: buffer,
  });
  if (!response.ok) throw new Error(`Archive upload failed: ${response.status} ${await response.text()}`);
}

async function run() {
  const ftp = new FtpClient(30_000);
  ftp.ftp.verbose = false;
  let runId = null;
  let filesSeen = 0;
  let filesImported = 0;

  try {
    const started = await gateway("start-run", { body: { details: { protocol: cfg.secure ? "ftps" : "ftp", remote_dir: cfg.remoteDir } } });
    runId = started.payload.runId ?? null;

    await ftp.access({
      host: cfg.host,
      port: cfg.port,
      user: cfg.username,
      password: cfg.password,
      secure: cfg.secure,
    });
    log("ftp_connected", { host: cfg.host, port: cfg.port, secure: cfg.secure, remoteDir: cfg.remoteDir });

    const mappings = await readMappings();
    log("mappings_loaded", { count: mappings.length });

    const remoteFiles = (await ftp.list(cfg.remoteDir)).filter((file) => cfg.pattern.test(file.name));
    filesSeen = remoteFiles.length;
    log("ftp_files_listed", { count: filesSeen });

    for (const remoteFile of remoteFiles) {
      const remotePath = path.posix.join(cfg.remoteDir, remoteFile.name);
      const buffer = await downloadToBuffer(ftp, remotePath);
      const fileHash = await sha256(buffer);
      const file = {
        name: remoteFile.name,
        size: remoteFile.size || buffer.length,
        modifyTime: modifiedTimestamp(remoteFile),
        remotePath,
      };
      const date = snapshotDate(file);
      const prepared = await prepareImport(file, buffer, fileHash, date);
      if (prepared.duplicate) {
        log("duplicate_skipped", { filename: remoteFile.name, sha256: fileHash });
        continue;
      }

      await uploadArchive(prepared.signedUrl, buffer);
      const metrics = extractMetrics(buffer, remoteFile.name, mappings);
      const finalized = await gateway("finalize", { body: { batchId: prepared.batchId, metrics } });
      filesImported += 1;
      log("file_imported", { filename: remoteFile.name, snapshotAt: date, metrics: finalized.payload.metrics ?? metrics.length, sha256: fileHash });
    }

    if (runId) await gateway("finish-run", { body: { runId, status: "success", filesSeen, filesImported, details: { protocol: cfg.secure ? "ftps" : "ftp", remote_dir: cfg.remoteDir } } });
    log("sync_completed", { filesSeen, filesImported });
  } catch (error) {
    if (runId) {
      await gateway("finish-run", {
        body: {
          runId,
          status: "failed",
          filesSeen,
          filesImported,
          details: { protocol: cfg.secure ? "ftps" : "ftp", remote_dir: cfg.remoteDir, error: error instanceof Error ? error.message : "unknown" },
        },
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    ftp.close();
  }
}

await run();
