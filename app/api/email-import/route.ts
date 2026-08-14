import { createClient } from "@supabase/supabase-js";
import * as XLSX from "@e965/xlsx";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const FINANCE_SOURCE = "SQL Reporting factures CRVO";
type SourceKey = "rh" | "finance" | "billed_time" | "unknown";
type RawRow = Record<string, unknown>;

type ParsedFile = { rows: RawRow[]; headers: string[] };

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const ingestToken = process.env.CRVO_INGEST_TOKEN?.trim();
  return url && key && ingestToken ? { url, key, ingestToken } : null;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-140) || "export.csv";
}

function text(value: unknown, max = 220) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, max) : null;
}

function numeric(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let source = String(value).trim().replace(/[\s\u00a0€]/g, "").replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    source = comma > dot ? source.replace(/\./g, "").replace(",", ".") : source.replace(/,/g, "");
  } else if (comma >= 0) {
    source = source.replace(",", ".");
  }
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

function hours(value: unknown) {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/);
    if (match) return Number(match[1]) + Number(match[2]) / 60 + Number(match[3] ?? 0) / 3600;
  }
  return numeric(value);
}

function isoDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const source = String(value ?? "").trim();
  const iso = source.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const fr = source.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return null;
}

function pick(row: RawRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[normalizeKey(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function normalizeObject(row: RawRow) {
  const normalized: RawRow = {};
  Object.entries(row).forEach(([key, value]) => { normalized[normalizeKey(key)] = value; });
  return normalized;
}

const headerHints = new Set([
  "date", "work_date", "date_pointage", "date_facture", "invoice_date", "facture", "numero_facture", "invoice_number",
  "or", "ordre_reparation", "work_order", "dossier", "immatriculation", "registration", "client", "vin",
  "ca", "chiffre_affaires", "montant_total", "revenue_total", "total_ht", "ca_mo", "labor_revenue",
  "mecanicien", "mechanic_name", "code_temps", "time_code", "libelle", "time_description", "temps", "time_value",
  "heures", "labor_hours", "temps_pointe", "duree",
]);

function rowsToObjects(grid: unknown[][]): ParsedFile {
  const candidates = grid.slice(0, 30).map((row, index) => {
    const keys = row.map(normalizeKey).filter(Boolean);
    const known = keys.filter((key) => headerHints.has(key)).length;
    return { index, known, filled: keys.length, score: known * 20 + Math.min(keys.length, 12) };
  }).filter((candidate) => candidate.filled >= 2);
  const headerIndex = candidates.sort((a, b) => b.score - a.score)[0]?.index ?? 0;
  const headerRow = grid[headerIndex] ?? [];
  const headers = headerRow.map((value, index) => normalizeKey(value) || `col_${index + 1}`);
  const seen = new Map<string, number>();
  const uniqueHeaders = headers.map((header) => {
    const count = (seen.get(header) ?? 0) + 1;
    seen.set(header, count);
    return count === 1 ? header : `${header}_${count}`;
  });
  const rows = grid.slice(headerIndex + 1).filter((row) => row.some((value) => value !== null && value !== undefined && String(value).trim() !== "")).map((row) => {
    const object: RawRow = {};
    uniqueHeaders.forEach((header, index) => { object[header] = row[index] ?? null; });
    return object;
  });
  return { rows, headers: uniqueHeaders };
}

function delimiterOf(line: string) {
  const options = [";", "\t", ","];
  return options.map((delimiter) => ({ delimiter, count: line.split(delimiter).length - 1 })).sort((a, b) => b.count - a.count)[0]?.delimiter ?? ";";
}

function parseDelimited(source: string) {
  const delimiter = delimiterOf(source.split(/\r?\n/, 1)[0] ?? "");
  const grid: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim() !== "")) grid.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) grid.push(row);
  return rowsToObjects(grid);
}

function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  let best: ParsedFile = { rows: [], headers: [] };
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
    const parsed = rowsToObjects(grid);
    if (parsed.rows.length > best.rows.length) best = parsed;
  }
  return best;
}

function classify(filename: string, subject: string, parsed: ParsedFile, explicit: string | null): SourceKey {
  if (explicit === "rh" || explicit === "finance" || explicit === "billed_time") return explicit;
  const name = normalizeKey(`${filename} ${subject}`);
  const headers = new Set(parsed.headers.map(normalizeKey));
  const has = (...values: string[]) => values.some((value) => headers.has(normalizeKey(value)));
  let rh = 0, finance = 0, billed = 0;

  if (/presence|presenteisme|data_rh|rh_/.test(name)) rh += 6;
  if (/chiffre|finance|facture|reporting|ca_/.test(name)) finance += 4;
  if (/pointage|temps.*factur|heures.*factur|dossier.*factur/.test(name)) billed += 7;

  if (has("mechanic_name", "mecanicien", "operateur", "collaborateur")) rh += 3;
  if (has("time_code", "code_temps") && has("time_value", "temps")) rh += 5;
  if (has("invoice_number", "numero_facture", "no_facture", "facture")) finance += 3;
  if (has("revenue_total", "chiffre_affaires", "montant_total", "total_ht", "ca")) finance += 6;
  if (has("labor_hours", "heures", "temps_pointe", "duree") && has("work_order", "ordre_reparation", "or", "dossier")) billed += 6;
  if (has("invoice_number", "numero_facture", "facture") && has("labor_hours", "heures", "temps_pointe")) billed += 3;

  const scores: Array<[SourceKey, number]> = [["rh", rh], ["finance", finance], ["billed_time", billed]];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 5 ? scores[0][0] : "unknown";
}

async function hashHex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function chunked<T>(rows: T[], size: number, action: (chunk: T[]) => Promise<void>) {
  for (let index = 0; index < rows.length; index += size) await action(rows.slice(index, index + size));
}

function dateRange(values: Array<string | null>) {
  const dates = values.filter((value): value is string => Boolean(value)).sort();
  return { min: dates[0] ?? null, max: dates.at(-1) ?? null };
}

export async function POST(request: Request) {
  const cfg = env();
  if (!cfg) return NextResponse.json({ error: "Passerelle e-mail CRVO non configurée." }, { status: 503 });
  const supplied = request.headers.get("x-crvo-ingest-token")?.trim() ?? "";
  if (!supplied || !constantTimeEqual(cfg.ingestToken, supplied)) return NextResponse.json({ error: "Accès passerelle e-mail refusé." }, { status: 401 });

  const form = await request.formData();
  const fileValue = form.get("file");
  if (!fileValue || typeof fileValue === "string" || typeof (fileValue as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Pièce jointe absente." }, { status: 400 });
  }
  const file = fileValue as File;
  const filename = safeFilename(file.name || String(form.get("filename") ?? "export.csv"));
  if (!/\.(csv|xlsx|xls)$/i.test(filename)) return NextResponse.json({ error: "Format refusé. Utilise CSV, XLSX ou XLS." }, { status: 400 });
  if (!file.size || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "La pièce jointe dépasse la limite de 25 Mo." }, { status: 400 });

  const buffer = await file.arrayBuffer();
  const sha256 = await hashHex(buffer);
  const supabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existing } = await supabase.from("kpi_email_imports").select("id,status,source_key,original_filename,received_at").eq("sha256", sha256).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true, existing, sha256 });

  const parsed = /\.csv$/i.test(filename) ? parseDelimited(new TextDecoder("utf-8").decode(buffer)) : parseWorkbook(buffer);
  const sender = text(form.get("sender"), 250);
  const subject = text(form.get("subject"), 300);
  const messageId = text(form.get("messageId"), 300);
  const sourceKey = classify(filename, subject ?? "", parsed, text(form.get("source"), 40));
  const receivedDay = new Date().toISOString().slice(0, 10);
  const archivePath = `email/${receivedDay}/${sha256}-${filename}`;

  const { data: intake, error: intakeError } = await supabase.from("kpi_email_imports").insert({
    sender,
    subject,
    message_id: messageId,
    source_key: sourceKey,
    original_filename: filename,
    sha256,
    byte_size: file.size,
    mime_type: file.type || "application/octet-stream",
    status: "received",
    archive_object_path: archivePath,
    metadata: { delivery_channel: "email_gateway", parsed_headers: parsed.headers.slice(0, 80) },
  }).select("id").single();
  if (intakeError || !intake) return NextResponse.json({ error: "Impossible d’enregistrer la réception du fichier." }, { status: 502 });

  const fail = async (message: string, status = 422) => {
    await supabase.from("kpi_email_imports").update({ status: "failed", error_message: message, imported_at: new Date().toISOString() }).eq("id", intake.id);
    return NextResponse.json({ error: message, source: sourceKey, sha256 }, { status });
  };

  const { error: archiveError } = await supabase.storage.from("kpi-raw-archive").upload(archivePath, new Uint8Array(buffer), {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (archiveError) return fail(`Archivage impossible : ${archiveError.message}`, 502);
  await supabase.from("kpi_email_imports").update({ status: sourceKey === "unknown" ? "quarantined" : "processing" }).eq("id", intake.id);

  if (sourceKey === "unknown") {
    return NextResponse.json({ archived: true, quarantined: true, source: sourceKey, sha256, filename, headers: parsed.headers });
  }
  if (!parsed.rows.length) return fail("Le fichier ne contient aucune ligne exploitable.");

  try {
    let saved = 0;
    let range = { min: null as string | null, max: null as string | null };
    let updatedInvoices = 0;

    if (sourceKey === "rh") {
      const mapped = parsed.rows.map(normalizeObject).map((row) => ({
        work_date: isoDate(pick(row, ["work_date", "date_pointage", "date", "fecha"])),
        mechanic_name: text(pick(row, ["mechanic_name", "mecanicien", "mécanicien", "operateur", "opérateur", "collaborateur", "nom"]), 300),
        time_code: text(pick(row, ["time_code", "code_temps", "code temps", "codigo_tiempo", "codigotiiempo", "code"]), 80),
        time_description: text(pick(row, ["time_description", "libelle", "libellé", "description", "descrip"]), 300),
        time_value: hours(pick(row, ["time_value", "temps", "tiempo", "heures", "duree", "durée"])),
      })).filter((row) => row.work_date && row.time_value !== null);
      if (!mapped.length) return fail("Aucune ligne RH reconnue. Vérifie les colonnes date, collaborateur et temps.");

      const aggregate = new Map<string, { work_date: string; mechanic_name: string | null; time_code: string | null; time_description: string | null; time_value: number; source_rows: number; source_synced_at: string }>();
      const syncedAt = new Date().toISOString();
      mapped.forEach((row) => {
        const key = [row.work_date, row.mechanic_name ?? "", row.time_code ?? "", row.time_description ?? ""].join("|");
        const item = aggregate.get(key) ?? { work_date: row.work_date!, mechanic_name: row.mechanic_name, time_code: row.time_code, time_description: row.time_description, time_value: 0, source_rows: 0, source_synced_at: syncedAt };
        item.time_value += row.time_value ?? 0;
        item.source_rows += 1;
        aggregate.set(key, item);
      });
      const rows = [...aggregate.values()];
      const dates = [...new Set(rows.map((row) => row.work_date))];
      const remove = await supabase.from("kpi_sql_presence_daily").delete().in("work_date", dates);
      if (remove.error) throw new Error(`Nettoyage RH impossible : ${remove.error.message}`);
      await chunked(rows, 500, async (chunk) => {
        const result = await supabase.from("kpi_sql_presence_daily").insert(chunk);
        if (result.error) throw new Error(`Enregistrement RH impossible : ${result.error.message}`);
      });
      range = dateRange(rows.map((row) => row.work_date));
      saved = rows.length;
      const sync = await supabase.from("kpi_sql_presence_sync_runs").insert({
        completed_at: syncedAt,
        status: "success",
        sync_mode: "email",
        from_date: range.min,
        rows_fetched: mapped.length,
        rows_saved: saved,
        min_work_date: range.min,
        max_work_date: range.max,
        metadata: { delivery_channel: "email", source_file_sha256: sha256, source_filename: filename },
      });
      if (sync.error) throw new Error(`Journal RH impossible : ${sync.error.message}`);
    }

    if (sourceKey === "finance") {
      const rows = parsed.rows.map(normalizeObject).map((row, index) => ({
        invoice_date: isoDate(pick(row, ["invoice_date", "date_facture", "date facture", "date"])),
        invoice_number: text(pick(row, ["invoice_number", "numero_facture", "numéro_facture", "no_facture", "n_facture", "facture"]), 64),
        registration: text(pick(row, ["registration", "immatriculation", "immat"]), 32),
        work_order: text(pick(row, ["work_order", "ordre_reparation", "ordre réparation", "or", "dossier", "numero_or", "numéro_or"]), 64),
        client: text(pick(row, ["client", "customer"]), 80),
        revenue_total: numeric(pick(row, ["revenue_total", "chiffre_affaires", "chiffre d'affaires", "ca", "montant_total", "total_ht", "total"])),
        labor_revenue: numeric(pick(row, ["labor_revenue", "ca_mo", "ca_main_oeuvre", "main_oeuvre", "main d'oeuvre", "mo"])),
        parts_revenue: numeric(pick(row, ["parts_revenue", "ca_pieces", "ca_pièces", "pieces", "pièces"])),
        other_revenue: numeric(pick(row, ["other_revenue", "ca_autres", "autres"])),
        vin: text(pick(row, ["vin", "vin_number"]), 40),
        labor_hours: hours(pick(row, ["labor_hours", "heures_mo", "heures_facturees", "heures facturées"])),
        source_name: FINANCE_SOURCE,
        metadata: { delivery_channel: "email", source_file_sha256: sha256, source_filename: filename, source_row_number: index + 1 },
        imported_at: new Date().toISOString(),
      })).filter((row) => row.invoice_date && row.invoice_number);
      if (!rows.length) return fail("Aucune facture reconnue. Vérifie les colonnes date facture et numéro de facture.");
      await chunked(rows, 500, async (chunk) => {
        const result = await supabase.from("kpi_invoice_facts").upsert(chunk, { onConflict: "source_name,invoice_number" });
        if (result.error) throw new Error(`Enregistrement CA impossible : ${result.error.message}`);
      });
      range = dateRange(rows.map((row) => row.invoice_date));
      saved = rows.length;
      const { data: latestTime } = await supabase.from("kpi_email_imports").select("sha256").eq("source_key", "billed_time").eq("status", "imported").order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (latestTime?.sha256) {
        const refresh = await supabase.rpc("kpi_apply_billed_hours_email", { p_file_sha: latestTime.sha256 });
        updatedInvoices = Number(refresh.data) || 0;
      }
    }

    if (sourceKey === "billed_time") {
      const rows = parsed.rows.map(normalizeObject).map((row, index) => ({
        work_date: isoDate(pick(row, ["work_date", "date_pointage", "date pointage", "date"])),
        invoice_date: isoDate(pick(row, ["invoice_date", "date_facture", "date facture"])),
        invoice_number: text(pick(row, ["invoice_number", "numero_facture", "numéro_facture", "no_facture", "facture"]), 64),
        work_order: text(pick(row, ["work_order", "ordre_reparation", "ordre réparation", "or", "dossier", "numero_or", "numéro_or"]), 64),
        mechanic_name: text(pick(row, ["mechanic_name", "mecanicien", "mécanicien", "operateur", "opérateur", "collaborateur", "nom"]), 300),
        time_code: text(pick(row, ["time_code", "code_temps", "code temps", "code"]), 80),
        time_description: text(pick(row, ["time_description", "libelle", "libellé", "description"]), 300),
        labor_hours: hours(pick(row, ["labor_hours", "heures", "temps_pointe", "temps pointé", "temps", "duree", "durée"])),
        source_file_sha256: sha256,
        source_row_number: index + 1,
        metadata: { delivery_channel: "email", source_filename: filename },
      })).filter((row) => row.labor_hours !== null && (row.invoice_number || row.work_order));
      if (!rows.length) return fail("Aucun pointage facturé reconnu. Vérifie les colonnes dossier/facture et heures.");
      await chunked(rows, 500, async (chunk) => {
        const result = await supabase.from("kpi_billed_time_facts").upsert(chunk, { onConflict: "source_file_sha256,source_row_number" });
        if (result.error) throw new Error(`Enregistrement pointage impossible : ${result.error.message}`);
      });
      range = dateRange(rows.map((row) => row.invoice_date ?? row.work_date));
      saved = rows.length;
      const refresh = await supabase.rpc("kpi_apply_billed_hours_email", { p_file_sha: sha256 });
      if (refresh.error) throw new Error(`Rattachement pointage/factures impossible : ${refresh.error.message}`);
      updatedInvoices = Number(refresh.data) || 0;
    }

    const completed = new Date().toISOString();
    const update = await supabase.from("kpi_email_imports").update({
      status: "imported",
      row_count: saved,
      min_data_date: range.min,
      max_data_date: range.max,
      error_message: null,
      imported_at: completed,
      metadata: { delivery_channel: "email_gateway", parsed_headers: parsed.headers.slice(0, 80), updated_invoices: updatedInvoices },
    }).eq("id", intake.id);
    if (update.error) throw new Error(`Finalisation import impossible : ${update.error.message}`);

    return NextResponse.json({ imported: true, source: sourceKey, rows: saved, updatedInvoices, dateRange: range, sha256, filename });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Import e-mail impossible.", 502);
  }
}
