import { NextResponse } from "next/server";
import * as XLSX from "@e965/xlsx";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type ImportRow = {
  date: string;
  entries: number;
  exits: number;
  total: number;
  objective: number;
  cumulativeObjective: number;
  cumulative: number;
  serviceHours: number;
  fuelLPer100: number | null;
};

function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function text(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function num(value: unknown) { const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".")); return Number.isFinite(parsed) ? parsed : 0; }
function excelDate(serial: number) { const utc = Date.UTC(1899, 11, 30) + Math.round(serial * 86400000); return new Date(utc).toISOString().slice(0, 10); }

function parseSheet(rows: unknown[][]) {
  const headerIndex = rows.findIndex((row) => row.some((value) => text(value) === "IN CRVO") && row.some((value) => text(value) === "Consommation au litre 100"));
  if (headerIndex < 0) throw new Error("Le tableau Statistiques Transphère n'a pas été trouvé dans cet onglet.");
  const header = rows[headerIndex].map(text);
  const entriesCol = header.findIndex((value) => value === "IN CRVO");
  const exitsCol = header.findIndex((value) => value === "OUT CRVO");
  const totalCol = header.findIndex((value) => value === "Total/j");
  const cumulativeCol = header.findIndex((value) => value === "Cumule VHL transportés");
  const fuelCol = header.findIndex((value) => value === "Consommation au litre 100");
  const serviceTotalCol = header.lastIndexOf("Total");
  const objectiveCols = header.map((value, index) => value === "Objectif" ? index : -1).filter((index) => index >= 0);
  const cumulativeObjectiveCol = objectiveCols.find((index) => index > cumulativeCol) ?? objectiveCols[objectiveCols.length - 1] ?? -1;
  const dateCol = entriesCol - 1;
  if ([entriesCol, exitsCol, totalCol, cumulativeCol, cumulativeObjectiveCol, fuelCol, serviceTotalCol, dateCol].some((index) => index < 0)) throw new Error("Le format du tableau Statistiques Transphère n'est pas reconnu.");

  const parsed: Array<Omit<ImportRow, "objective">> = [];
  let monthlyTarget = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const serial = num(row[dateCol]);
    if (serial < 40000 || serial > 60000) continue;
    const cumulativeObjective = Math.round(num(row[cumulativeObjectiveCol]));
    monthlyTarget = Math.max(monthlyTarget, cumulativeObjective);
    const entries = Math.round(num(row[entriesCol]));
    const exits = Math.round(num(row[exitsCol]));
    const total = Math.round(num(row[totalCol]));
    const cumulative = Math.round(num(row[cumulativeCol]));
    const serviceHours = num(row[serviceTotalCol]);
    const rawFuel = row[fuelCol];
    const fuel = typeof rawFuel === "number" && Number.isFinite(rawFuel) ? rawFuel : null;
    if (total <= 0 && entries <= 0 && exits <= 0 && serviceHours <= 0) continue;
    parsed.push({ date: excelDate(serial), entries, exits, total, cumulativeObjective, cumulative, serviceHours, fuelLPer100: fuel });
  }
  parsed.sort((a, b) => a.date.localeCompare(b.date));
  let previousObjective = 0;
  const actualRows: ImportRow[] = parsed.map((row) => { const objective = Math.max(0, row.cumulativeObjective - previousObjective); previousObjective = row.cumulativeObjective; return { ...row, objective }; });
  if (!actualRows.length) throw new Error("Aucune journée réalisée n'a été détectée.");
  if (monthlyTarget <= 0) monthlyTarget = actualRows[actualRows.length - 1].cumulativeObjective;
  return { month: `${actualRows[0].date.slice(0, 7)}-01`, monthlyTarget, rows: actualRows, latestDate: actualRows[actualRows.length - 1].date };
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session CRVO requise." }, 401);
  if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Classeur Transphère manquant." }, 400);
    if (file.size > 25 * 1024 * 1024) return json({ error: "Le classeur dépasse 25 Mo." }, 413);
    if (!/\.xlsx?$/i.test(file.name)) return json({ error: "Format XLS/XLSX requis." }, 400);

    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const candidates: Array<{ sheet: string; parsed: ReturnType<typeof parseSheet> }> = [];
    for (const sheetName of workbook.SheetNames) {
      try {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
        candidates.push({ sheet: sheetName, parsed: parseSheet(rows) });
      } catch {}
    }
    if (!candidates.length) throw new Error("Aucun onglet Transphère exploitable.");
    candidates.sort((a, b) => b.parsed.latestDate.localeCompare(a.parsed.latestDate));
    const selected = candidates[0];

    const result = await authRpc<Record<string, unknown>>("kpi_transphere_import_month_admin", {
      p_session_hash: current.tokenHash,
      p_month: selected.parsed.month,
      p_target: selected.parsed.monthlyTarget,
      p_rows: selected.parsed.rows,
      p_source_file: file.name,
    });
    return json({ ...result, sheet: selected.sheet, latestDate: selected.parsed.latestDate });
  } catch (error) {
    console.error("transphere_import_failed", error);
    return json({ error: error instanceof Error ? error.message : "Import Transphère impossible." }, 500);
  }
}
