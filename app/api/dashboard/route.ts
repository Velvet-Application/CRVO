import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
const PUBLIC_SUPABASE_KEY = "sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

type SnapshotRow = {
  snapshot_at: string;
  source_name: string;
  metrics: Record<string, number | string>;
};

type LiveRow = SnapshotRow & {
  source_modified_at: string | null;
  factory_modified_at: string | null;
  park_modified_at: string | null;
};

const verifiedRows: SnapshotRow[] = [
  { snapshot_at: "2026-08-03", source_name: "Book CRVO Lens - Journée du 03.08.2026.xlsx", metrics: { entries_vop: 50, exits_vop: 87, factory_stock: 1146, stock_over_15d: 508, stock_over_20d: 418, production_expertise: 83, production_mechanics: 83, production_dsp: 25, production_bodywork: 13, production_preparation: 85, production_quality: 91, production_factory_exit: 87 } },
  { snapshot_at: "2026-08-04", source_name: "Book CRVO Lens - Journée du 04.08.2026.xlsx", metrics: { entries_vop: 54, exits_vop: 91, factory_stock: 1139, stock_over_15d: 476, stock_over_20d: 392, production_expertise: 86, production_mechanics: 91, production_dsp: 26, production_bodywork: 17, production_preparation: 91, production_quality: 91, production_factory_exit: 91 } },
  { snapshot_at: "2026-08-05", source_name: "Book CRVO Lens - Journée du 05.08.2026.xlsx", metrics: { entries_vop: 79, exits_vop: 84, factory_stock: 1129, stock_over_15d: 475, stock_over_20d: 395, production_expertise: 72, production_mechanics: 84, production_dsp: 32, production_bodywork: 18, production_preparation: 84, production_quality: 85, production_factory_exit: 84 } },
  { snapshot_at: "2026-08-06", source_name: "Book CRVO Lens - Journée du 06.08.2026.xlsx", metrics: { entries_vop: 47, exits_vop: 96, factory_stock: 1094, stock_over_15d: 474, stock_over_20d: 402, production_expertise: 77, production_mechanics: 95, production_dsp: 22, production_bodywork: 12, production_preparation: 92, production_quality: 91, production_factory_exit: 96 } },
  { snapshot_at: "2026-08-07", source_name: "Book CRVO Lens - Journée du 07.08.2026.xlsx", metrics: { entries_vop: 78, exits_vop: 86, factory_stock: 1097, stock_over_15d: 494, stock_over_20d: 399, production_expertise: 80, production_mechanics: 96, production_dsp: 24, production_bodywork: 11, production_preparation: 89, production_quality: 88, production_factory_exit: 86 } },
  { snapshot_at: "2026-08-10", source_name: "Book CRVO Lens - Journée du 10.08.2026.xlsx", metrics: { entries_vop: 62, exits_vop: 92, factory_stock: 1092, stock_over_15d: 467, stock_over_20d: 391, production_expertise: 76, production_mechanics: 77, production_dsp: 28, production_bodywork: 5, production_preparation: 87, production_quality: 93, production_factory_exit: 92 } },
  { snapshot_at: "2026-08-11", source_name: "Book CRVO Lens - Journée du 11.08.2026.xlsx", metrics: { entries_vop: 42, exits_vop: 108, factory_stock: 1069, stock_over_15d: 470, stock_over_20d: 379, production_expertise: 68, production_mechanics: 82, production_dsp: 31, production_bodywork: 14, production_preparation: 87, production_quality: 91, production_factory_exit: 108 } },
  { snapshot_at: "2026-08-12", source_name: "Book CRVO Lens - Journée du 12.08.2026.xlsx", metrics: { entries_vop: 8, exits_vop: 94, factory_stock: 1064, stock_over_15d: 477, stock_over_20d: 382, production_expertise: 65, production_mechanics: 75, production_dsp: 27, production_bodywork: 10, production_preparation: 83, production_quality: 87, production_factory_exit: 94 } },
];

const SATURDAY_ADDITIVE_METRICS = [
  "entries_vop",
  "exits_vop",
  "production_expertise",
  "production_mechanics",
  "production_dsp",
  "production_bodywork",
  "production_preparation",
  "production_quality",
  "production_factory_exit",
];
const STOCK_METRICS = ["factory_stock", "stock_over_15d", "stock_over_20d"];

function priority(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return 30;
  if (value.includes("manuel") || value.includes("book")) return 20;
  return 10;
}

function sourceMode(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return "ftp";
  if (value.includes("manuel") || value.includes("book")) return "book";
  return "embedded";
}

function metricValue(metrics: SnapshotRow["metrics"], key: string) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : 0;
}

function previousIsoDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function foldSaturdayIntoFriday(rows: SnapshotRow[]) {
  const byDate = new Map(rows.map((row) => [row.snapshot_at, { ...row, metrics: { ...row.metrics } }]));
  for (const saturday of [...byDate.values()]) {
    const date = new Date(`${saturday.snapshot_at}T12:00:00Z`);
    if (date.getUTCDay() !== 6) continue;
    const hasSaturdayProduction = SATURDAY_ADDITIVE_METRICS.some((key) => metricValue(saturday.metrics, key) > 0);
    if (!hasSaturdayProduction) continue;
    const fridayDate = previousIsoDate(saturday.snapshot_at);
    const friday = byDate.get(fridayDate);
    if (!friday) continue;

    const metrics = { ...friday.metrics };
    for (const key of SATURDAY_ADDITIVE_METRICS) metrics[key] = metricValue(friday.metrics, key) + metricValue(saturday.metrics, key);
    for (const key of STOCK_METRICS) {
      const saturdayValue = metricValue(saturday.metrics, key);
      if (saturdayValue > 0) metrics[key] = saturdayValue;
    }
    byDate.set(fridayDate, {
      ...friday,
      source_name: `${friday.source_name} · samedi consolidé`,
      metrics,
    });
    byDate.delete(saturday.snapshot_at);
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

function numberValue(metrics: SnapshotRow["metrics"], key: string, fallback = 0) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : fallback;
}

function formatSnapshot(row: SnapshotRow) {
  const metrics = row.metrics ?? {};
  return {
    date: row.snapshot_at,
    label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.snapshot_at}T12:00:00Z`)),
    source: row.source_name,
    sourceMode: sourceMode(row.source_name),
    entries: numberValue(metrics, "entries_vop"),
    exits: numberValue(metrics, "exits_vop"),
    stock: numberValue(metrics, "factory_stock"),
    over15: numberValue(metrics, "stock_over_15d"),
    over20: numberValue(metrics, "stock_over_20d"),
    production: [
      { name: "Expertise", value: numberValue(metrics, "production_expertise"), tone: "coral" },
      { name: "Mécanique", value: numberValue(metrics, "production_mechanics"), tone: "green" },
      { name: "DSP", value: numberValue(metrics, "production_dsp"), tone: "cyan" },
      { name: "Carrosserie", value: numberValue(metrics, "production_bodywork"), tone: "red" },
      { name: "Préparation", value: numberValue(metrics, "production_preparation"), tone: "purple" },
      { name: "Qualité", value: numberValue(metrics, "production_quality"), tone: "orange" },
      { name: "Sortie usine", value: numberValue(metrics, "production_factory_exit", numberValue(metrics, "exits_vop")), tone: "blue" },
    ],
  };
}

function mergeRows(liveRows: SnapshotRow[]) {
  const byDate = new Map<string, SnapshotRow>();
  verifiedRows.forEach((row) => byDate.set(row.snapshot_at, row));
  for (const row of [...liveRows].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at))) {
    const current = byDate.get(row.snapshot_at);
    if (!current || priority(row.source_name) >= priority(current.source_name)) byDate.set(row.snapshot_at, row);
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

async function publicRest<T>(path: string): Promise<T> {
  const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: PUBLIC_SUPABASE_KEY, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase public ${response.status}`);
  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const wantsHistory = url.searchParams.get("history") === "1";
  const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;

  try {
    const [historyRows, liveRows] = await Promise.all([
      publicRest<SnapshotRow[]>("kpi_public_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.asc&limit=180"),
      publicRest<LiveRow[]>("kpi_ftp_live_dashboard?select=snapshot_at,source_name,metrics,source_modified_at,factory_modified_at,park_modified_at&limit=1"),
    ]);
    const all = foldSaturdayIntoFriday(mergeRows([...historyRows, ...liveRows]));
    const source = (requestedDate ? all.find((row) => row.snapshot_at === requestedDate) : all.at(-1)) ?? all.at(-1) ?? verifiedRows.at(-1)!;
    const live = liveRows[0] ?? null;
    return NextResponse.json({
      connected: true,
      backend: "supabase-public-live",
      sourceMode: sourceMode(source.source_name),
      latestSource: source.source_name,
      snapshot: formatSnapshot(source),
      snapshots: wantsHistory ? all.map(formatSnapshot) : undefined,
      liveFreshness: live ? {
        sourceModifiedAt: live.source_modified_at,
        factoryModifiedAt: live.factory_modified_at,
        parkModifiedAt: live.park_modified_at,
      } : null,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "dashboard_public_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    const all = foldSaturdayIntoFriday(mergeRows([]));
    const source = (requestedDate ? all.find((row) => row.snapshot_at === requestedDate) : all.at(-1)) ?? verifiedRows.at(-1)!;
    return NextResponse.json({ connected: false, backend: "embedded-history", sourceMode: sourceMode(source.source_name), latestSource: source.source_name, snapshot: formatSnapshot(source), snapshots: wantsHistory ? all.map(formatSnapshot) : undefined, liveFreshness: null }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  }
}
