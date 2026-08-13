import crypto from "node:crypto";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import * as XLSX from "@e965/xlsx";

const password = process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const sourceId = process.env.KPI_SOURCE_ID;
if (!password || !supabaseUrl || !sourceId) throw new Error("Missing FTP operational sync configuration");

const token = crypto.createHash("sha256").update(`kpi-crvo-ftp-bridge:v1:${password}`).digest("hex");
const connectionUrl = `${supabaseUrl}/functions/v1/kpi-ftp-bridge-gateway?action=connection&sourceId=${encodeURIComponent(sourceId)}`;
const operationalUrl = `${supabaseUrl}/functions/v1/kpi-ftp-operational-gateway`;

function normalizeDir(value) {
  const normalized = String(value ?? "/").trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  if (!normalized || normalized === ".") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}
function log(event, details = {}) { process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}\n`); }
function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function hashEvent(parts) { return crypto.createHash("sha256").update(parts.map((value) => String(value ?? "").trim().toLowerCase()).join("\u001f")).digest("hex"); }
function numeric(value) { const text = String(value ?? "").trim().replace(/\s/g, "").replace(",", "."); if (!text) return null; const number = Number(text); return Number.isFinite(number) ? number : null; }
function integer(value) { const number = numeric(value); return number == null ? null : Math.trunc(number); }
function rows(buffer) { const workbook = XLSX.read(buffer, { type: "buffer", raw: true, dense: false }); const sheet = workbook.Sheets[workbook.SheetNames[0]]; return sheet ? XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "", blankrows: false }) : []; }
function isoDate(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  match = text.match(/^(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return null;
}
function isoTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}
async function post(action, body) {
  const response = await fetch(`${operationalUrl}?action=${encodeURIComponent(action)}`, { method: "POST", headers: { "x-kpi-bridge-token": token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Operational gateway ${response.status}: ${payload.error ?? "unknown error"}`);
  return payload;
}
async function download(client, remoteDir, filename) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); callback(); } });
  const path = `${normalizeDir(remoteDir).replace(/\/$/, "")}/${filename}` || `/${filename}`;
  await client.downloadTo(sink, path.startsWith("/") ? path : `/${path}`);
  return Buffer.concat(chunks);
}

function parseLeadTime(input, sourceModifiedAt) {
  return rows(input).map((row) => ({
    source_modified_at: sourceModifiedAt,
    site: row["Nom SITE"],
    flow: row["Flux"],
    client: row["Client"],
    make: row["Marque"],
    model: row["Modèle"],
    vin: row["Vin"],
    registration: row["Immat."],
    work_order: row["OR"],
    current_state: row["Etat actuel"],
    created_date: row["Date création"],
    waiting_factory_date: row["En attente d'arrivée usine"],
    transport_outbound_date: row["Transport aller en cours"],
    received_factory_date: row["Réceptionné en usine"],
    dynamic_expertise_date: row["Expertise dynamique en cours"],
    factory_exit_date: row["Sortie Usine"],
    transport_return_done_date: row["Transport retour effectué"],
    outbound_in_progress_days: numeric(row["Duree Transport aller en cours"]),
    lead_time_outbound_days: numeric(row["LeadTime Transport Aller (Jours"]),
    lead_time_storage_days: numeric(row["LeadTime Stockage (Jours)"]),
    lead_time_factory_days: numeric(row["LeadTime Usine (Jours)"]),
    lead_time_return_days: numeric(row["LeadTime Transport Retour (Jour"]),
    lead_time_parts_days: numeric(row["LeadTime Pièces (Jours)"]),
    exit_week: integer(row["Semaine Sortie"]),
    exit_month: integer(row["Mois Sortie"]),
    exit_year: integer(row["Année Sortie"]),
  })).filter((row) => row.vin || row.registration || row.work_order);
}

function parseStatusHistory(input, sourceModifiedAt) {
  const parsed = rows(input).map((row) => {
    const eventDate = isoDate(row["Date"]);
    const eventTime = isoTime(row["Heure"]);
    const eventHash = hashEvent([row["Client"], row["OR"], row["VIN"], row["Flux"], row["Statut"], eventDate ?? row["Date"], eventTime ?? row["Heure"], row["Immatriculation"], row["ID RDV"]]);
    return {
      event_hash: eventHash,
      source_modified_at: sourceModifiedAt,
      client: row["Client"],
      work_order: row["OR"],
      vin: row["VIN"],
      flow: row["Flux"],
      status: row["Statut"],
      event_date: eventDate,
      event_time: eventTime,
      registration: row["Immatriculation"],
      appointment_id: row["ID RDV"],
    };
  }).filter((row) => row.status && (row.vin || row.registration || row.work_order));
  const seen = new Set();
  return parsed.filter((row) => {
    if (seen.has(row.event_hash)) return false;
    seen.add(row.event_hash);
    return true;
  });
}

const connectionResponse = await fetch(connectionUrl, { headers: { "x-kpi-bridge-token": token } });
if (!connectionResponse.ok) throw new Error(`Connection config unavailable: ${connectionResponse.status}`);
const connection = await connectionResponse.json();
const ftp = new FtpClient(30_000);
try {
  await ftp.access({ host: String(connection.host), port: Number(connection.port || 21), user: String(connection.username), password, secure: Boolean(connection.secure) });
  const listed = await ftp.list(normalizeDir(connection.remoteDir));
  const byName = new Map(listed.map((item) => [item.name, item]));

  for (const spec of [
    { filename: "LeadTimeFactoryBI.csv", action: "lead-time", parser: parseLeadTime, chunkSize: 300 },
    { filename: "Analyse-Temps-Bruts.csv", action: "status-history", parser: parseStatusHistory, chunkSize: 750 },
  ]) {
    const remote = byName.get(spec.filename);
    if (!remote) { log("operational_source_missing", { filename: spec.filename }); continue; }
    const buffer = await download(ftp, connection.remoteDir, spec.filename);
    const fileSha = sha256(buffer);
    const sourceModifiedAt = (remote.modifiedAt instanceof Date ? remote.modifiedAt : new Date()).toISOString();
    const parsed = spec.parser(buffer, sourceModifiedAt);
    for (let offset = 0; offset < parsed.length; offset += spec.chunkSize) {
      const chunk = parsed.slice(offset, offset + spec.chunkSize);
      await post(spec.action, { sha256: fileSha, rows: chunk, reset: spec.action === "lead-time" && offset === 0, complete: offset + spec.chunkSize >= parsed.length, totalRows: parsed.length });
    }
    log("operational_source_loaded", { filename: spec.filename, rows: parsed.length, sourceModifiedAt });
  }
} finally {
  ftp.close();
}
