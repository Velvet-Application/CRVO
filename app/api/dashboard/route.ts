import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const verifiedSeed = {
  date: "2026-08-07",
  label: "07 août 2026",
  source: "Classeur Excel CRVO quotidien",
  entries: 78,
  exits: 86,
  stock: 1097,
  over15: 494,
  over20: 399,
  production: [
    { name: "Expertise", value: 80, tone: "coral" },
    { name: "Mécanique", value: 96, tone: "green" },
    { name: "DSP", value: 24, tone: "cyan" },
    { name: "Carrosserie", value: 11, tone: "red" },
    { name: "Préparation", value: 89, tone: "purple" },
    { name: "Qualité", value: 88, tone: "orange" },
    { name: "Sortie usine", value: 86, tone: "blue" },
  ],
};

type SnapshotRow = {
  snapshot_at: string;
  source_name: string;
  metrics: Record<string, number | string>;
};

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

export async function GET(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const url = new URL(request.url);
  const wantsHistory = url.searchParams.get("history") === "1";
  const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;

  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({
      snapshot: verifiedSeed,
      snapshots: wantsHistory ? [verifiedSeed] : undefined,
      backend: "verified-seed",
      connected: false,
    });
  }

  try {
    const select = "select=snapshot_at,source_name,metrics";
    const query = wantsHistory
      ? `${select}&order=snapshot_at.asc&limit=120`
      : requestedDate
        ? `${select}&snapshot_at=eq.${encodeURIComponent(requestedDate)}&limit=1`
        : `${select}&order=snapshot_at.desc&limit=1`;

    const response = await fetch(`${supabaseUrl}/rest/v1/kpi_dashboard_snapshots?${query}`, {
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);

    const rows = await response.json() as SnapshotRow[];
    if (!rows.length) {
      return NextResponse.json({
        snapshot: verifiedSeed,
        snapshots: wantsHistory ? [verifiedSeed] : undefined,
        backend: "verified-seed",
        connected: true,
      });
    }

    if (wantsHistory) {
      const snapshots = rows.map(formatSnapshot);
      return NextResponse.json({
        connected: true,
        backend: "supabase",
        snapshot: snapshots.at(-1) ?? verifiedSeed,
        snapshots,
      });
    }

    return NextResponse.json({ connected: true, backend: "supabase", snapshot: formatSnapshot(rows[0]) });
  } catch (error) {
    console.error(JSON.stringify({ event: "dashboard_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({
      snapshot: verifiedSeed,
      snapshots: wantsHistory ? [verifiedSeed] : undefined,
      backend: "verified-seed",
      connected: false,
    });
  }
}
