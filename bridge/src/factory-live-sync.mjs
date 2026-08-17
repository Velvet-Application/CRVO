import crypto from "node:crypto";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import { parseFactoryPrevious, parseFactoryToday } from "./ftp-factory-production.mjs";

const password = process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const sourceId = process.env.KPI_SOURCE_ID;
if (!password || !supabaseUrl || !sourceId) throw new Error("Missing Factory live sync configuration");

const token = crypto.createHash("sha256").update(`kpi-crvo-ftp-bridge:v1:${password}`).digest("hex");
const mainGateway = `${supabaseUrl}/functions/v1/kpi-ftp-bridge-gateway`;
const factoryGateway = `${supabaseUrl}/functions/v1/kpi-ftp-factory-gateway`;
const RETRYABLE = new Set([429, 502, 503, 504]);

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function call(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { "x-kpi-bridge-token": token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
      const payload = await response.json().catch(() => ({}));
      if (!RETRYABLE.has(response.status) || attempt === attempts) return { response, payload };
      lastError = new Error(`gateway ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    await wait(750 * 2 ** (attempt - 1));
  }
  throw lastError ?? new Error("Gateway call failed");
}

const connectionResult = await call(`${mainGateway}?action=connection&sourceId=${encodeURIComponent(sourceId)}`);
if (!connectionResult.response.ok) throw new Error(`FTP connection config unavailable: ${connectionResult.response.status}`);
const connection = connectionResult.payload;
const remoteDir = String(connection.remoteDir || "/").trim() || "/";
function remotePath(filename) {
  const base = remoteDir === "/" ? "" : `/${remoteDir.replace(/^\/+|\/+$/g, "")}`;
  return `${base}/${filename}`;
}

async function download(client, path) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); callback(); } });
  await client.downloadTo(sink, path);
  return Buffer.concat(chunks);
}

function findFile(files, names) {
  for (const name of names) {
    const file = files.find((item) => item.name === name);
    if (file) return { file, filename: name };
  }
  return null;
}

async function syncFactoryFile(ftp, files, names, parser, role) {
  const requested = Array.isArray(names) ? names : [names];
  const found = findFile(files, requested);
  if (!found) throw new Error(`${requested.join(" / ")} not found on FTP${role === "closed" || role === "month" ? " - closed-day certification unavailable" : ""}`);
  const { file, filename } = found;
  const path = remotePath(filename);
  const buffer = await download(ftp, path);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const modifiedAt = file.modifiedAt instanceof Date && Number.isFinite(file.modifiedAt.getTime()) ? file.modifiedAt.getTime() : Date.now();
  const rows = parser(buffer, modifiedAt);
  if (!rows.length) throw new Error(`${filename} contains no usable Factory row`);
  const dates = [...new Set(rows.map((row) => row.production_date).filter(Boolean))].sort();
  const snapshotAt = dates.at(-1) ?? new Date(modifiedAt).toISOString().slice(0, 10);
  const initResult = await call(`${mainGateway}?action=init`, { method: "POST", body: JSON.stringify({ sourceId, filename, byteSize: file.size || buffer.length, sha256, snapshotAt, remotePath: path, modifiedAt }) });
  if (![200, 409].includes(initResult.response.status) || !initResult.payload.batchId) throw new Error(`${filename} import batch unavailable: ${initResult.response.status}`);
  const syncResult = await call(factoryGateway, { method: "POST", body: JSON.stringify({ batchId: initResult.payload.batchId, rows }) });
  if (!syncResult.response.ok) throw new Error(`${filename} gateway ${syncResult.response.status}: ${syncResult.payload.error ?? "unknown"}`);
  const relevant = rows.filter((row) => ["VOP EFF", "VOP EXT"].includes(row.flow));
  const total = (field) => relevant.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  const event = role === "closed" ? "factory_closed_day_synced" : role === "month" ? "factory_closed_month_synced" : "factory_live_synced";
  process.stdout.write(`${JSON.stringify({ event, filename, duplicate: initResult.response.status === 409, productionDates: dates, sourceModifiedAt: new Date(modifiedAt).toISOString(), flows: relevant.length, received: total("received"), expertise: total("expertise"), mechanics: total("mechanics"), bodywork: total("bodywork") + total("fixline_1") + total("fixline_2") + total("fixline_3"), dsp: total("dsp"), preparation: total("preparation"), quality: total("quality"), available: total("available") })}\n`);
  return { rows, dates, filename };
}

const ftp = new FtpClient(30_000);
try {
  await ftp.access({ host: String(connection.host), port: Number(connection.port || 21), user: String(connection.username), password, secure: Boolean(connection.secure) });
  const files = await ftp.list(remoteDir);

  // Source de clôture autoritaire pour les journées passées.
  await syncFactoryFile(ftp, files, "Factory-Mois.csv", parseFactoryToday, "month");

  // Photo live de la journée : les deux conventions de nommage ont existé sur le dépôt FTP.
  await syncFactoryFile(ftp, files, ["Factory-j_1.csv", "Factory-j+1.csv"], parseFactoryToday, "live");

  // Clôture j-1 : source de secours si le mensuel n'est pas encore consolidé.
  await syncFactoryFile(ftp, files, "Factory-j-1.csv", parseFactoryPrevious, "closed");
} finally {
  ftp.close();
}
