import crypto from "node:crypto";
import { Writable } from "node:stream";
import { Client as FtpClient } from "basic-ftp";
import * as XLSX from "@e965/xlsx";

const password = process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const sourceId = process.env.KPI_SOURCE_ID;
if (!password || !supabaseUrl || !sourceId) throw new Error("Missing FTP diagnostic configuration");

const token = crypto.createHash("sha256").update(`kpi-crvo-ftp-bridge:v1:${password}`).digest("hex");
const gatewayUrl = `${supabaseUrl}/functions/v1/kpi-ftp-bridge-gateway?action=connection&sourceId=${encodeURIComponent(sourceId)}`;
const response = await fetch(gatewayUrl, { headers: { "x-kpi-bridge-token": token } });
if (!response.ok) throw new Error(`Connection config unavailable: ${response.status}`);
const connection = await response.json();

function rows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, dense: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "", blankrows: false }) : [];
}

async function download(client, filename) {
  const chunks = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); callback(); } });
  await client.downloadTo(sink, `/${filename}`);
  return Buffer.concat(chunks);
}

function safeFactoryRows(input, filename) {
  const allowed = filename === "Factory-j-1.csv"
    ? ["Libelle Site", "Date", "Type", "Réceptionnés", "Expertises Dynamiques", "Lavages", "Expertises", "Mecaniques", "Carrosseries", "Fixline 1", "Fixline 2", "Fixline 3", "DSP", "Préparations", "Photos", "Qualités", "CT OK", "CT KO", "Disponibles"]
    : ["CAL_DATE", "RDT_LIBELLE", "Réceptionnés", "Expertises Dynamiques", "Lavages", "Expertises", "Mecaniques", "Carrosseries", "Fixline 1", "Fixline 2", "Fixline 3", "DSP", "Préparations", "Photos", "Qualités", "Jantes", "Restor-FX", "CT", "Disponibles"];
  return input.map((row) => Object.fromEntries(allowed.map((field) => [field, row[field] ?? ""])));
}

const ftp = new FtpClient(30_000);
try {
  await ftp.access({ host: String(connection.host), port: Number(connection.port || 21), user: String(connection.username), password, secure: Boolean(connection.secure) });
  for (const filename of ["Factory-j-1.csv", "Factory-Mois.csv"]) {
    const buffer = await download(ftp, filename);
    const data = rows(buffer);
    process.stdout.write(`${JSON.stringify({ event: "factory_mapping_diagnostic", filename, rowCount: data.length, rows: safeFactoryRows(data, filename) })}\n`);
  }
} finally {
  ftp.close();
}
