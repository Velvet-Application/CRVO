import crypto from "node:crypto";
import path from "node:path";
import SftpClient from "ssh2-sftp-client";
import * as XLSX from "@e965/xlsx";

const required = ["SFTP_HOST", "SFTP_USERNAME", "SFTP_REMOTE_DIR", "SFTP_HOST_FINGERPRINT_SHA256", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "KPI_SOURCE_ID"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

const cfg = {
  host: process.env.SFTP_HOST,
  port: Number(process.env.SFTP_PORT ?? "22"),
  username: process.env.SFTP_USERNAME,
  password: process.env.SFTP_PASSWORD,
  privateKey: process.env.SFTP_PRIVATE_KEY?.replaceAll("\\n", "\n"),
  passphrase: process.env.SFTP_PRIVATE_KEY_PASSPHRASE,
  remoteDir: process.env.SFTP_REMOTE_DIR,
  fingerprint: process.env.SFTP_HOST_FINGERPRINT_SHA256,
  pattern: new RegExp(process.env.SFTP_FILE_PATTERN ?? "\\.(csv|xls|xlsx)$", "i"),
  supabaseUrl: process.env.SUPABASE_URL.replace(/\/$/, ""),
  secretKey: process.env.SUPABASE_SECRET_KEY,
  sourceId: process.env.KPI_SOURCE_ID,
  archiveBucket: process.env.SUPABASE_ARCHIVE_BUCKET ?? "kpi-raw-archive",
};

if (!cfg.password && !cfg.privateKey) throw new Error("Set SFTP_PASSWORD or SFTP_PRIVATE_KEY");

const apiHeaders = {
  apikey: cfg.secretKey,
  Authorization: `Bearer ${cfg.secretKey}`,
  "Content-Type": "application/json",
};

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`);
}

async function supabase(pathname, init = {}) {
  const response = await fetch(`${cfg.supabaseUrl}${pathname}`, { ...init, headers: { ...apiHeaders, ...(init.headers ?? {}) } });
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
      metadata: { remote_path: file.remotePath, modified_at: file.modifyTime },
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
  const response = await fetch(`${cfg.supabaseUrl}/storage/v1/bucket/${cfg.archiveBucket}`, { headers: apiHeaders });
  if (response.ok) return;
  if (response.status !== 404) throw new Error(`Bucket lookup failed: ${response.status} ${await response.text()}`);
  await supabase("/storage/v1/bucket", { method: "POST", body: JSON.stringify({ id: cfg.archiveBucket, name: cfg.archiveBucket, public: false }) });
}

async function readMappings() {
  return supabase(`/rest/v1/kpi_field_mappings?source_id=eq.${cfg.sourceId}&is_active=eq.true&select=source_field,target_metric_key,target_metric_label,aggregation`, { method: "GET" });
}

function cellValue(workbook, sourceField) {
  const separator = sourceField.lastIndexOf("!");
  if (separator <= 0) return undefined;
  const sheetName = sourceField.slice(0, separator);
  const cell = sourceField.slice(separator + 1).toUpperCase();
  return workbook.Sheets[sheetName]?.[cell]?.v;
}

function extractMetrics(buffer, filename, mappings) {
  if (!mappings.length) return [];
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });
  return mappings.flatMap((mapping) => {
    const raw = cellValue(workbook, mapping.source_field);
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    if (!Number.isFinite(value)) {
      log("mapping_skipped", { filename, sourceField: mapping.source_field, reason: "not_numeric" });
      return [];
    }
    return [{ metric_key: mapping.target_metric_key, metric_label: mapping.target_metric_label, metric_value: value, unit: "count", dimensions: {} }];
  });
}

function snapshotDate(file) {
  const match = file.name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return new Date(file.modifyTime || Date.now()).toISOString().slice(0, 10);
}

async function run() {
  const sftp = new SftpClient("kpi-crvo-readonly");
  const run = await supabase("/rest/v1/kpi_bridge_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "running" }) });
  const runId = run[0].id;
  let filesSeen = 0;
  let filesImported = 0;
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password,
      privateKey: cfg.privateKey,
      passphrase: cfg.passphrase,
      hostVerifier: cfg.fingerprint ? (key) => crypto.createHash("sha256").update(key).digest("base64") === cfg.fingerprint.replace(/^SHA256:/, "") : undefined,
      readyTimeout: 20_000,
    });
    await ensureArchiveBucket();
    const mappings = await readMappings();
    const remoteFiles = (await sftp.list(cfg.remoteDir)).filter((file) => file.type === "-" && cfg.pattern.test(file.name));
    filesSeen = remoteFiles.length;
    for (const remoteFile of remoteFiles) {
      const remotePath = path.posix.join(cfg.remoteDir, remoteFile.name);
      const buffer = await sftp.get(remotePath);
      if (!Buffer.isBuffer(buffer)) throw new Error(`Unexpected stream response for ${remoteFile.name}`);
      const hash = await sha256(buffer);
      if (await existingBatch(hash)) { log("duplicate_skipped", { filename: remoteFile.name, sha256: hash }); continue; }
      const file = { name: remoteFile.name, size: remoteFile.size, modifyTime: remoteFile.modifyTime, remotePath };
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
        await updateBatch(batch.id, { status: "failed", metadata: { remote_path: remotePath, error: error instanceof Error ? error.message : "unknown" } });
        throw error;
      }
    }
    await supabase(`/rest/v1/kpi_bridge_runs?id=eq.${runId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ finished_at: new Date().toISOString(), status: "success", files_seen: filesSeen, files_imported: filesImported }) });
    log("sync_completed", { filesSeen, filesImported });
  } catch (error) {
    await supabase(`/rest/v1/kpi_bridge_runs?id=eq.${runId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ finished_at: new Date().toISOString(), status: "failed", files_seen: filesSeen, files_imported: filesImported, details: { error: error instanceof Error ? error.message : "unknown" } }) }).catch(() => undefined);
    throw error;
  } finally {
    await sftp.end().catch(() => undefined);
  }
}

await run();
