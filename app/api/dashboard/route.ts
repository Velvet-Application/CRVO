import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type SnapshotRow = {
  snapshot_at: string;
  source_name: string;
  metrics: Record<string, number | string>;
};

const PUBLIC_SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
const PUBLIC_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2bWtodmZtZHN0a3Vud3d1enV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU4NjQsImV4cCI6MjEwMjAzMTg2NH0.w18MDX_dL1YarUElTeo9ID0Egivav18tVqjjbkCaOxc";

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

function priority(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return 30;
  if (value.includes("manuel") || value.includes("book")) return 20;
  if (value.includes("seed") || value.includes("classeur")) return 10;
  return 0;
}

function sourceMode(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return "ftp";
  if (value.includes("manuel") || value.includes("book")) return "book";
  return "embedded";
}

function numberValue(metrics: SnapshotRow["metrics"], key: string, fallback: number) {
  const value = Number(metrics[key]);
  return Number.isFinite(value) ? value : fallback;
}

function formatSnapshot(row: SnapshotRow) {
  const date = new Date(`${row.snapshot_at}T12:00:00Z`);
  const metrics = row.metrics ?? {};
  return {
    date: row.snapshot_at,
    label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date),
    source: row.source_name,
    sourceMode: sourceMode(row.source_name),
    entries: numberValue(metrics, "entries_vop", 0),
    exits: numberValue(metrics, "exits_vop", 0),
    stock: numberValue(metrics, "factory_stock", 0),
    over15: numberValue(metrics, "stock_over_15d", 0),
    over20: numberValue(metrics, "stock_over_20d", 0),
    production: [
      { name: "Expertise", value: numberValue(metrics, "production_expertise", 0), tone: "coral" },
      { name: "Mécanique", value: numberValue(metrics, "production_mechanics", 0), tone: "green" },
      { name: "DSP", value: numberValue(metrics, "production_dsp", 0), tone: "cyan" },
      { name: "Carrosserie", value: numberValue(metrics, "production_bodywork", 0), tone: "red" },
      { name: "Préparation", value: numberValue(metrics, "production_preparation", 0), tone: "purple" },
      { name: "Qualité", value: numberValue(metrics, "production_quality", 0), tone: "orange" },
      { name: "Sortie usine", value: numberValue(metrics, "production_factory_exit", 0), tone: "blue" },
    ],
  };
}

function mergedRows(liveRows: SnapshotRow[]) {
  const byDate = new Map<string, SnapshotRow>();
  verifiedRows.forEach((row) => byDate.set(row.snapshot_at, { ...row, metrics: { ...row.metrics } }));

  const ordered = [...liveRows].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at) || priority(a.source_name) - priority(b.source_name));
  for (const row of ordered) {
    const current = byDate.get(row.snapshot_at);
    if (!current) {
      byDate.set(row.snapshot_at, { ...row, metrics: { ...(row.metrics ?? {}) } });
      continue;
    }
    const rowWins = priority(row.source_name) >= priority(current.source_name);
    byDate.set(row.snapshot_at, {
      snapshot_at: row.snapshot_at,
      source_name: rowWins ? row.source_name : current.source_name,
      metrics: rowWins ? { ...current.metrics, ...(row.metrics ?? {}) } : { ...(row.metrics ?? {}), ...current.metrics },
    });
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

function responseFor(rows: SnapshotRow[], wantsHistory: boolean, requestedDate: string | null, connected: boolean, backend: string) {
  const all = mergedRows(rows);
  const selected = requestedDate ? all.find((row) => row.snapshot_at === requestedDate) : all.at(-1);
  const source = selected ?? all.at(-1) ?? verifiedRows.at(-1)!;
  const snapshot = formatSnapshot(source);
  return NextResponse.json({ connected, backend, sourceMode: sourceMode(source.source_name), latestSource: source.source_name, snapshot, snapshots: wantsHistory ? all.map(formatSnapshot) : undefined }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}

async function readRows(baseUrl: string, secretKey: string, path: string) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }), cache: "no-store" });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json() as Promise<SnapshotRow[]>;
}

async function readPublicEdgeRows(wantsHistory: boolean, requestedDate: string | null) {
  const params = new URLSearchParams();
  if (wantsHistory) params.set("history", "1");
  if (requestedDate) params.set("date", requestedDate);
  const response = await fetch(`${PUBLIC_SUPABASE_URL}/functions/v1/kpi-public-dashboard?${params.toString()}`, {
    headers: {
      apikey: PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${PUBLIC_SUPABASE_ANON_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase edge ${response.status}`);
  return response.json() as Promise<SnapshotRow[]>;
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const url = new URL(request.url);
  const wantsHistory = url.searchParams.get("history") === "1";
  const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;

  if (!supabaseUrl || !secretKey) {
    try {
      const rows = await readPublicEdgeRows(wantsHistory, requestedDate);
      return responseFor(rows, wantsHistory, requestedDate, true, "supabase-edge-live+embedded-history");
    } catch (error) {
      console.error(JSON.stringify({ event: "dashboard_edge_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
      return responseFor([], wantsHistory, requestedDate, false, "embedded-history");
    }
  }

  try {
    const select = "select=snapshot_at,source_name,metrics";
    const snapshotQuery = wantsHistory ? `${select}&order=snapshot_at.asc&limit=180` : requestedDate ? `${select}&snapshot_at=eq.${encodeURIComponent(requestedDate)}&limit=20` : `${select}&order=snapshot_at.desc&limit=180`;
    const ftpQuery = requestedDate ? `${select}&snapshot_at=eq.${encodeURIComponent(requestedDate)}&limit=1` : `${select}&limit=1`;
    const [rows, ftpRows] = await Promise.all([
      readRows(supabaseUrl, secretKey, `kpi_dashboard_snapshots?${snapshotQuery}`),
      readRows(supabaseUrl, secretKey, `kpi_ftp_live_dashboard?${ftpQuery}`).catch(() => []),
    ]);
    return responseFor([...rows, ...ftpRows], wantsHistory, requestedDate, true, "supabase+ftp-live+embedded-history");
  } catch (error) {
    console.error(JSON.stringify({ event: "dashboard_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    try {
      const rows = await readPublicEdgeRows(wantsHistory, requestedDate);
      return responseFor(rows, wantsHistory, requestedDate, true, "supabase-edge-live+embedded-history");
    } catch {
      return responseFor([], wantsHistory, requestedDate, false, "embedded-history");
    }
  }
}
