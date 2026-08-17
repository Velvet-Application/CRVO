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

async function call(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "x-kpi-bridge-token": token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

const connectionResult = await call(`${mainGateway}?action=connection&sourceId=${encodeURIComponent(sourceId)}`);
if (!connectionResult.response.ok) throw new Error(`FTP connection config unavailable: ${connectionResult.response.status}`);
const connection = connectionResult.payload;

async function download(client, remotePath) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); callback(); } });
  await client.downloadTo(sink, remotePath);
  return Buffer.concat(chunks);
}

async function syncFactoryFile(ftp, files, filename, parser, role) {
  const file = files.find((item) => item.name === filename);
  if (!file) {
    if (role === "closed" || role === "month") throw new Error(`${filename} not found on FTP - closed-day certification unavailable`);
    throw new Error(`${filename} not found on FTP`);
  }
  const remotePath = `/${filename}`;
  const buffer = await download(ftp, remotePath);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const modifiedAt = file.modifiedAt instanceof Date && Number.isFinite(file.modifiedAt.getTime()) ? file.modifiedAt.getTime() : Date.now();
  const rows = parser(buffer, modifiedAt);
  if (!rows.length) throw new Error(`${filename} contains no usable Factory row`);
  const dates = [...new Set(rows.map((row) => row.production_date).filter(Boolean))].sort();
  const snapshotAt = dates.at(-1) ?? new Date(modifiedAt).toISOString().slice(0, 10);
  const initResult = await call(`${mainGateway}?action=init`, { method: "POST", body: JSON.stringify({ sourceId, filename, byteSize: file.size || buffer.length, sha256, snapshotAt, remotePath, modifiedAt }) });
  if (![200, 409].includes(initResult.response.status) || !initResult.payload.batchId) throw new Error(`${filename} import batch unavailable: ${initResult.response.status}`);
  const syncResult = await call(factoryGateway, { method: "POST", body: JSON.stringify({ batchId: initResult.payload.batchId, rows }) });
  if (!syncResult.response.ok) throw new Error(`${filename} gateway ${syncResult.response.status}: ${syncResult.payload.error ?? "unknown"}`);
  const relevant = rows.filter((row) => ["VOP EFF", "VOP EXT"].includes(row.flow));
  const total = (field) => relevant.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  const event = role === "closed" ? "factory_closed_day_synced" : role === "month" ? "factory_closed_month_synced" : "factory_live_synced";
  process.stdout.write(`${JSON.stringify({ event, filename, productionDates: dates, sourceModifiedAt: new Date(modifiedAt).toISOString(), flows: relevant.length, received: total("received"), expertise: total("expertise"), mechanics: total("mechanics"), bodywork: total("bodywork") + total("fixline_1") + total("fixline_2") + total("fixline_3"), dsp: total("dsp"), preparation: total("preparation"), quality: total("quality"), available: total("available") })}\n`);
  return { rows, dates };
}

const ftp = new FtpClient(30_000);
try {
  await ftp.access({ host: String(connection.host), port: Number(connection.port || 21), user: String(connection.username), password, secure: Boolean(connection.secure) });
  const files = await ftp.list(String(connection.remoteDir || "/"));

  // Historique de clôture du mois : source autoritaire pour les journées passées.
  // Il est chargé avant le live ; les dates historiques qu'il contient sont
  // préférées grâce à leur source_modified_at plus récente que les photos intrajournalières.
  await syncFactoryFile(ftp, files, "Factory-Mois.csv", parseFactoryToday, "month");

  // Live : photographie de la journée en cours.
  await syncFactoryFile(ftp, files, "Factory-j+1.csv", parseFactoryToday, "live");

  // Clôture j-1 : confirme la veille dès que le fichier du lendemain est disponible.
  await syncFactoryFile(ftp, files, "Factory-j-1.csv", parseFactoryPrevious, "closed");
} finally {
  ftp.close();
}
