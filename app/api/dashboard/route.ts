import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type SnapshotRow = {
  snapshot_at: string;
  source_name: string;
  metrics: Record<string, number | string | null>;
};

type LiveRow = SnapshotRow & {
  source_modified_at: string | null;
  factory_modified_at: string | null;
  park_modified_at: string | null;
};

type DirectionLiveFlowRow = {
  snapshot_at: string;
  park_modified_at: string | null;
  preparation_remaining: number | string | null;
  quality_remaining: number | string | null;
  photo_remaining: number | string | null;
};

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

function config() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}

function sourcePriority(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return 30;
  if (value.includes("manuel") || value.includes("book") || value.includes("excel")) return 20;
  return 10;
}

function sourceMode(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return "ftp";
  if (value.includes("manuel") || value.includes("book") || value.includes("excel")) return "historical_import";
  return "database";
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
    byDate.set(fridayDate, { ...friday, source_name: `${friday.source_name} · samedi consolidé`, metrics });
    byDate.delete(saturday.snapshot_at);
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

function mergeRealRows(rows: SnapshotRow[]) {
  const byDate = new Map<string, SnapshotRow>();
  for (const row of [...rows].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at))) {
    const current = byDate.get(row.snapshot_at);
    if (!current || sourcePriority(row.source_name) >= sourcePriority(current.source_name)) byDate.set(row.snapshot_at, row);
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

function formatSnapshot(row: SnapshotRow) {
  const metrics = row.metrics ?? {};
  return {
    date: row.snapshot_at,
    label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.snapshot_at}T12:00:00Z`)),
    source: row.source_name,
    sourceMode: sourceMode(row.source_name),
    entries: metricValue(metrics, "entries_vop"),
    exits: metricValue(metrics, "exits_vop"),
    stock: metricValue(metrics, "factory_stock"),
    over15: metricValue(metrics, "stock_over_15d"),
    over20: metricValue(metrics, "stock_over_20d"),
    production: [
      { name: "Expertise", value: metricValue(metrics, "production_expertise"), tone: "coral" },
      { name: "Mécanique", value: metricValue(metrics, "production_mechanics"), tone: "green" },
      { name: "DSP", value: metricValue(metrics, "production_dsp"), tone: "cyan" },
      { name: "Carrosserie", value: metricValue(metrics, "production_bodywork"), tone: "red" },
      { name: "Préparation", value: metricValue(metrics, "production_preparation"), tone: "purple" },
      { name: "Qualité", value: metricValue(metrics, "production_quality"), tone: "orange" },
      { name: "Sortie usine", value: metricValue(metrics, "production_factory_exit") || metricValue(metrics, "exits_vop"), tone: "blue" },
    ],
  };
}

async function rest<T>(supabaseUrl: string, secretKey: string, path: string): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ connected: false, error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const db = config();
  if (!db) return NextResponse.json({ connected: false, error: "Base CRVO non configurée." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const url = new URL(request.url);
  const wantsHistory = url.searchParams.get("history") === "1";
  const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;

  try {
    const [historyRows, liveRows, directionRows] = await Promise.all([
      rest<SnapshotRow[]>(db.supabaseUrl, db.secretKey, "kpi_public_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.asc&limit=180"),
      rest<LiveRow[]>(db.supabaseUrl, db.secretKey, "kpi_ftp_live_dashboard?select=snapshot_at,source_name,metrics,source_modified_at,factory_modified_at,park_modified_at&limit=1"),
      rest<DirectionLiveFlowRow[]>(db.supabaseUrl, db.secretKey, "kpi_ftp_direction_live_flow?select=snapshot_at,park_modified_at,preparation_remaining,quality_remaining,photo_remaining&limit=1").catch(() => []),
    ]);
    const all = foldSaturdayIntoFriday(mergeRealRows([...historyRows, ...liveRows]));
    if (!all.length) return NextResponse.json({ connected: false, error: "Aucune donnée opérationnelle réelle n'est disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const source = requestedDate ? all.find((row) => row.snapshot_at === requestedDate) : all.at(-1);
    if (!source) return NextResponse.json({ connected: true, error: "Aucune donnée réelle pour la date demandée." }, { status: 404, headers: { "Cache-Control": "no-store" } });

    const live = liveRows[0] ?? null;
    const direction = directionRows[0] ?? null;
    const liveMetrics = live?.metrics ?? {};
    return NextResponse.json({
      connected: true,
      backend: "supabase-real-sources",
      sourceMode: sourceMode(source.source_name),
      latestSource: source.source_name,
      snapshot: formatSnapshot(source),
      snapshots: wantsHistory ? all.map(formatSnapshot) : undefined,
      liveFlow: live ? {
        date: live.snapshot_at,
        received: metricValue(liveMetrics, "entries_vop"),
        preparationRemaining: Number(direction?.preparation_remaining ?? 0) || 0,
        qualityRemaining: Number(direction?.quality_remaining ?? 0) || 0,
        photoRemaining: Number(direction?.photo_remaining ?? 0) || 0,
        exits: metricValue(liveMetrics, "production_factory_exit") || metricValue(liveMetrics, "exits_vop"),
        stock: metricValue(liveMetrics, "factory_stock"),
        parkModifiedAt: direction?.park_modified_at ?? live.park_modified_at,
      } : null,
      liveFreshness: live ? {
        sourceModifiedAt: live.source_modified_at,
        factoryModifiedAt: live.factory_modified_at,
        parkModifiedAt: live.park_modified_at,
      } : null,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "dashboard_real_source_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ connected: false, error: "Source opérationnelle réelle indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
