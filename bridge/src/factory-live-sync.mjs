import crypto from "node:crypto";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import { parseFactoryToday } from "./ftp-factory-production.mjs";

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

const ftp = new FtpClient(30_000);
try {
  await ftp.access({ host: String(connection.host), port: Number(connection.port || 21), user: String(connection.username), password, secure: Boolean(connection.secure) });
  const files = await ftp.list(String(connection.remoteDir || "/"));
  const file = files.find((item) => item.name === "Factory-j+1.csv");
  if (!file) throw new Error("Factory-j+1.csv not found on FTP");
  const buffer = await download(ftp, "/Factory-j+1.csv");
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const modifiedAt = file.modifiedAt instanceof Date && Number.isFinite(file.modifiedAt.getTime()) ? file.modifiedAt.getTime() : Date.now();
  const snapshotAt = new Date(modifiedAt).toISOString().slice(0, 10);
  const initResult = await call(`${mainGateway}?action=init`, { method: "POST", body: JSON.stringify({ sourceId, filename: file.name, byteSize: file.size || buffer.length, sha256, snapshotAt, remotePath: "/Factory-j+1.csv", modifiedAt }) });
  if (![200, 409].includes(initResult.response.status) || !initResult.payload.batchId) throw new Error(`Factory import batch unavailable: ${initResult.response.status}`);
  const rows = parseFactoryToday(buffer, modifiedAt);
  const syncResult = await call(factoryGateway, { method: "POST", body: JSON.stringify({ batchId: initResult.payload.batchId, rows }) });
  if (!syncResult.response.ok) throw new Error(`Factory gateway ${syncResult.response.status}: ${syncResult.payload.error ?? "unknown"}`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const live = rows.filter((row) => row.production_date === today && ["VOP EFF", "VOP EXT"].includes(row.flow));
  const total = (field) => live.reduce((sum, row) => sum + Number(row[field] || 0), 0);
  process.stdout.write(`${JSON.stringify({ event: "factory_live_synced", productionDate: today, sourceModifiedAt: new Date(modifiedAt).toISOString(), flows: live.length, received: total("received"), expertise: total("expertise"), mechanics: total("mechanics"), bodywork: total("bodywork") + total("fixline_1") + total("fixline_2") + total("fixline_3"), dsp: total("dsp"), preparation: total("preparation"), quality: total("quality"), available: total("available") })}\n`);
} finally {
  ftp.close();
}
