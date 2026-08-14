import { createClient } from "@supabase/supabase-js";
import * as XLSX from "@e965/xlsx";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const FINANCE_SOURCE = "SQL Reporting factures CRVO";
type SourceKey = "rh" | "finance" | "billed_time" | "unknown";
type Row = Record<string, unknown>;
type Parsed = { rows: Row[]; headers: string[] };

function getEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-140) || "export.csv";
}

function key(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeRow(row: Row) {
  const result: Row = {};
  for (const [name, value] of Object.entries(row)) result[key(name)] = value;
  return result;
}

function pick(row: Row, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[key(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function txt(value: unknown, max = 300) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function num(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let source = String(value).trim().replace(/[\s\u00a0€]/g, "").replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) source = comma > dot ? source.replace(/\./g, "").replace(",", ".") : source.replace(/,/g, "");
  else if (comma >= 0) source = source.replace(",", ".");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

function hours(value: unknown) {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
    if (match) return Number(match[1]) + Number(match[2]) / 60 + Number(match[3] ?? 0) / 3600;
  }
  return num(value);
}

function date(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000 && value < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  const source = String(value ?? "").trim();
  let match = source.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string) {
  return sha256(new TextEncoder().encode(value).buffer as ArrayBuffer);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

const headerHints = new Set(["date","work_date","date_pointage","date_facture","invoice_date","facture","numero_facture","invoice_number","or","ordre_reparation","work_order","dossier","immatriculation","registration","client","vin","ca","chiffre_affaires","montant_total","revenue_total","total_ht","ca_mo","labor_revenue","mecanicien","mechanic_name","code_temps","time_code","libelle","time_description","temps","time_value","heures","labor_hours","temps_pointe","duree"]);

function gridToRows(grid: unknown[][]): Parsed {
  const candidates = grid.slice(0, 30).map((row, index) => {
    const keys = row.map(key).filter(Boolean);
    return { index, filled: keys.length, score: keys.filter((item) => headerHints.has(item)).length * 20 + Math.min(keys.length, 12) };
  }).filter((candidate) => candidate.filled >= 2).sort((a, b) => b.score - a.score);
  const headerIndex = candidates[0]?.index ?? 0;
  const seen = new Map<string, number>();
  const headers = (grid[headerIndex] ?? []).map((value, index) => key(value) || `col_${index + 1}`).map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}_${count}`;
  });
  const rows = grid.slice(headerIndex + 1).filter((row) => row.some((value) => String(value ?? "").trim())).map((row) => {
    const object: Row = {};
    headers.forEach((name, index) => { object[name] = row[index] ?? null; });
    return object;
  });
  return { rows, headers };
}

function parseCsv(source: string) {
  const first = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].map((item) => ({ item, count: first.split(item).length })).sort((a, b) => b.count - a.count)[0]?.item ?? ";";
  const grid: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); cell = ""; if (row.some((value) => value.trim())) grid.push(row); row = [];
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) grid.push(row);
  return gridToRows(grid);
}

function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  let best: Parsed = { rows: [], headers: [] };
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const parsed = gridToRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null }) as unknown[][]);
    if (parsed.rows.length > best.rows.length) best = parsed;
  }
  return best;
}

function classify(filename: string, subject: string, parsed: Parsed, explicit: string | null): SourceKey {
  if (explicit === "rh" || explicit === "finance" || explicit === "billed_time") return explicit;
  const label = key(`${filename} ${subject}`);
  const headers = new Set(parsed.headers);
  const has = (...values: string[]) => values.some((value) => headers.has(key(value)));
  let rh = 0, finance = 0, billed = 0;
  if (/presence|presenteisme|data_rh|rh_/.test(label)) rh += 6;
  if (/chiffre|finance|facture|reporting|ca_/.test(label)) finance += 4;
  if (/pointage|temps.*factur|heures.*factur|dossier.*factur/.test(label)) billed += 7;
  if (has("mechanic_name","mecanicien","operateur","collaborateur")) rh += 3;
  if (has("time_code","code_temps") && has("time_value","temps")) rh += 5;
  if (has("invoice_number","numero_facture","facture")) finance += 3;
  if (has("revenue_total","chiffre_affaires","montant_total","total_ht","ca")) finance += 6;
  if (has("labor_hours","heures","temps_pointe","duree") && has("work_order","ordre_reparation","or","dossier")) billed += 6;
  const ranked: Array<[SourceKey, number]> = [["rh", rh], ["finance", finance], ["billed_time", billed]];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][1] >= 5 ? ranked[0][0] : "unknown";
}

async function insertChunks(client: ReturnType<typeof createClient>, table: string, rows: Record<string, unknown>[], upsertConflict?: string) {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const result = upsertConflict ? await client.from(table).upsert(chunk, { onConflict: upsertConflict }) : await client.from(table).insert(chunk);
    if (result.error) throw new Error(result.error.message);
  }
}

function range(values: Array<string | null>) {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return { min: dates[0] ?? null, max: dates.at(-1) ?? null };
}

export async function POST(request: Request) {
  const cfg = getEnv();
  if (!cfg) return NextResponse.json({ error: "Passerelle e-mail CRVO non configurée." }, { status: 503 });
  const supabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });

  const supplied = request.headers.get("x-crvo-ingest-token")?.trim() ?? "";
  if (supplied.length < 32 || supplied.length > 256) return NextResponse.json({ error: "Accès passerelle e-mail refusé." }, { status: 401 });
  const gatewayResult = await supabase.from("kpi_email_gateway_config").select("token_sha256").eq("id", 1).maybeSingle();
  const gateway = gatewayResult.data as unknown as { token_sha256?: string } | null;
  if (gatewayResult.error || !gateway?.token_sha256 || !constantTimeEqual(await sha256Text(supplied), gateway.token_sha256)) return NextResponse.json({ error: "Accès passerelle e-mail refusé." }, { status: 401 });

  const form = await request.formData();
  const value = form.get("file");
  if (!value || typeof value === "string" || typeof (value as { arrayBuffer?: unknown }).arrayBuffer !== "function") return NextResponse.json({ error: "Pièce jointe absente." }, { status: 400 });
  const file = value as File;
  const filename = safeFilename(file.name || String(form.get("filename") ?? "export.csv"));
  if (!/\.(csv|xlsx|xls)$/i.test(filename)) return NextResponse.json({ error: "Format refusé. Utilise CSV, XLSX ou XLS." }, { status: 400 });
  if (!file.size || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "La pièce jointe dépasse la limite de 25 Mo." }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const hash = await sha256(buffer);
  const existing = await supabase.from("kpi_email_imports").select("id,status,source_key,original_filename,received_at").eq("sha256", hash).maybeSingle();
  if (existing.data) return NextResponse.json({ duplicate: true, existing: existing.data, sha256: hash });

  const parsed = /\.csv$/i.test(filename) ? parseCsv(new TextDecoder("utf-8").decode(buffer)) : parseWorkbook(buffer);
  const sender = txt(form.get("sender"), 250);
  const subject = txt(form.get("subject"), 300);
  const messageId = txt(form.get("messageId"), 300);
  const source = classify(filename, subject ?? "", parsed, txt(form.get("source"), 40));
  const archivePath = `email/${new Date().toISOString().slice(0, 10)}/${hash}-${filename}`;
  const intakeResult = await supabase.from("kpi_email_imports").insert({ sender, subject, message_id: messageId, source_key: source, original_filename: filename, sha256: hash, byte_size: file.size, mime_type: file.type || "application/octet-stream", status: "received", archive_object_path: archivePath, metadata: { delivery_channel: "email_gateway", parsed_headers: parsed.headers.slice(0, 80) } }).select("id").single();
  const intake = intakeResult.data as unknown as { id: string } | null;
  if (intakeResult.error || !intake) return NextResponse.json({ error: "Impossible d’enregistrer la réception du fichier." }, { status: 502 });

  const fail = async (message: string, status = 422) => {
    await supabase.from("kpi_email_imports").update({ status: "failed", error_message: message, imported_at: new Date().toISOString() }).eq("id", intake.id);
    return NextResponse.json({ error: message, source, sha256: hash }, { status });
  };

  const archived = await supabase.storage.from("kpi-raw-archive").upload(archivePath, new Uint8Array(buffer), { contentType: file.type || "application/octet-stream", upsert: false });
  if (archived.error) return fail(`Archivage impossible : ${archived.error.message}`, 502);
  await supabase.from("kpi_email_imports").update({ status: source === "unknown" ? "quarantined" : "processing" }).eq("id", intake.id);
  if (source === "unknown") return NextResponse.json({ archived: true, quarantined: true, source, filename, sha256: hash, headers: parsed.headers });
  if (!parsed.rows.length) return fail("Le fichier ne contient aucune ligne exploitable.");

  try {
    let saved = 0;
    let dates = { min: null as string | null, max: null as string | null };
    let updatedInvoices = 0;

    if (source === "rh") {
      const mapped = parsed.rows.map(normalizeRow).map((row) => ({
        work_date: date(pick(row,["work_date","date_pointage","date","fecha"])), mechanic_name: txt(pick(row,["mechanic_name","mecanicien","operateur","collaborateur","nom"])), time_code: txt(pick(row,["time_code","code_temps","code"]),80), time_description: txt(pick(row,["time_description","libelle","description","descrip"])), time_value: hours(pick(row,["time_value","temps","tiempo","heures","duree"]))
      })).filter((row) => row.work_date && row.time_value !== null);
      if (!mapped.length) return fail("Aucune ligne RH reconnue. Vérifie les colonnes date, collaborateur et temps.");
      const aggregated = new Map<string, {work_date:string; mechanic_name:string|null; time_code:string|null; time_description:string|null; time_value:number; source_rows:number; source_synced_at:string}>();
      const now = new Date().toISOString();
      for (const row of mapped) {
        const id = [row.work_date,row.mechanic_name ?? "",row.time_code ?? "",row.time_description ?? ""].join("|");
        const item = aggregated.get(id) ?? { work_date: row.work_date!, mechanic_name: row.mechanic_name, time_code: row.time_code, time_description: row.time_description, time_value: 0, source_rows: 0, source_synced_at: now };
        item.time_value += row.time_value ?? 0; item.source_rows += 1; aggregated.set(id,item);
      }
      const rows = [...aggregated.values()];
      const workDates = [...new Set(rows.map((row) => row.work_date))];
      const deleted = await supabase.from("kpi_sql_presence_daily").delete().in("work_date", workDates);
      if (deleted.error) throw new Error(deleted.error.message);
      await insertChunks(supabase,"kpi_sql_presence_daily",rows);
      dates = range(rows.map((row) => row.work_date)); saved = rows.length;
      const sync = await supabase.from("kpi_sql_presence_sync_runs").insert({ completed_at: now, status: "success", sync_mode: "email", from_date: dates.min, rows_fetched: mapped.length, rows_saved: saved, min_work_date: dates.min, max_work_date: dates.max, metadata: { delivery_channel: "email", source_file_sha256: hash, source_filename: filename } });
      if (sync.error) throw new Error(sync.error.message);
    }

    if (source === "finance") {
      const rows = parsed.rows.map(normalizeRow).map((row,index) => ({
        invoice_date: date(pick(row,["invoice_date","date_facture","date"])), invoice_number: txt(pick(row,["invoice_number","numero_facture","no_facture","n_facture","facture"]),64), registration: txt(pick(row,["registration","immatriculation","immat"]),32), work_order: txt(pick(row,["work_order","ordre_reparation","or","dossier","numero_or"]),64), client: txt(pick(row,["client","customer"]),80), revenue_total: num(pick(row,["revenue_total","chiffre_affaires","ca","montant_total","total_ht","total"])), labor_revenue: num(pick(row,["labor_revenue","ca_mo","ca_main_oeuvre","main_oeuvre","mo"])), parts_revenue: num(pick(row,["parts_revenue","ca_pieces","pieces"])), other_revenue: num(pick(row,["other_revenue","ca_autres","autres"])), vin: txt(pick(row,["vin","vin_number"]),40), labor_hours: hours(pick(row,["labor_hours","heures_mo","heures_facturees"])), source_name: FINANCE_SOURCE, metadata: { delivery_channel:"email",source_file_sha256:hash,source_filename:filename,source_row_number:index+1 }, imported_at:new Date().toISOString()
      })).filter((row) => row.invoice_date && row.invoice_number);
      if (!rows.length) return fail("Aucune facture reconnue. Vérifie les colonnes date facture et numéro de facture.");
      await insertChunks(supabase,"kpi_invoice_facts",rows,"source_name,invoice_number");
      dates = range(rows.map((row) => row.invoice_date)); saved = rows.length;
      const latest = await supabase.from("kpi_email_imports").select("sha256").eq("source_key","billed_time").eq("status","imported").order("received_at",{ascending:false}).limit(1).maybeSingle();
      const latestData = latest.data as unknown as {sha256?:string}|null;
      if (latestData?.sha256) { const refreshed = await supabase.rpc("kpi_apply_billed_hours_email",{p_file_sha:latestData.sha256}); updatedInvoices = Number(refreshed.data) || 0; }
    }

    if (source === "billed_time") {
      const rows = parsed.rows.map(normalizeRow).map((row,index) => ({
        work_date: date(pick(row,["work_date","date_pointage","date"])), invoice_date: date(pick(row,["invoice_date","date_facture"])), invoice_number: txt(pick(row,["invoice_number","numero_facture","no_facture","facture"]),64), work_order: txt(pick(row,["work_order","ordre_reparation","or","dossier","numero_or"]),64), mechanic_name: txt(pick(row,["mechanic_name","mecanicien","operateur","collaborateur","nom"])), time_code: txt(pick(row,["time_code","code_temps","code"]),80), time_description: txt(pick(row,["time_description","libelle","description"])), labor_hours: hours(pick(row,["labor_hours","heures","temps_pointe","temps","duree"])), source_file_sha256: hash, source_row_number:index+1, metadata:{delivery_channel:"email",source_filename:filename}
      })).filter((row) => row.labor_hours !== null && (row.invoice_number || row.work_order));
      if (!rows.length) return fail("Aucun pointage facturé reconnu. Vérifie les colonnes dossier/facture et heures.");
      await insertChunks(supabase,"kpi_billed_time_facts",rows,"source_file_sha256,source_row_number");
      dates = range(rows.map((row) => row.invoice_date ?? row.work_date)); saved = rows.length;
      const refreshed = await supabase.rpc("kpi_apply_billed_hours_email",{p_file_sha:hash});
      if (refreshed.error) throw new Error(refreshed.error.message); updatedInvoices = Number(refreshed.data) || 0;
    }

    const completed = await supabase.from("kpi_email_imports").update({ status:"imported", row_count:saved, min_data_date:dates.min, max_data_date:dates.max, error_message:null, imported_at:new Date().toISOString(), metadata:{delivery_channel:"email_gateway",parsed_headers:parsed.headers.slice(0,80),updated_invoices:updatedInvoices} }).eq("id",intake.id);
    if (completed.error) throw new Error(completed.error.message);
    return NextResponse.json({ imported:true, source, rows:saved, updatedInvoices, dateRange:dates, sha256:hash, filename });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Import e-mail impossible.",502);
  }
}
