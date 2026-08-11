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
    { name: "Expertise", value: 80, tone: "blue" },
    { name: "Mécanique", value: 96, tone: "cyan" },
    { name: "DSP", value: 24, tone: "teal" },
    { name: "Carrosserie", value: 11, tone: "yellow" },
    { name: "Préparation", value: 89, tone: "blue" },
    { name: "Qualité", value: 88, tone: "cyan" },
    { name: "Sortie usine", value: 86, tone: "teal" },
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

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ snapshot: verifiedSeed, backend: "verified-seed", connected: false });
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/kpi_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.desc&limit=1`, {
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    const rows = await response.json() as SnapshotRow[];
    if (!rows.length) return NextResponse.json({ snapshot: verifiedSeed, backend: "verified-seed", connected: true });
    const row = rows[0];
    const date = new Date(`${row.snapshot_at}T12:00:00Z`);
    const metrics = row.metrics;
    return NextResponse.json({
      connected: true,
      backend: "supabase",
      snapshot: {
        date: row.snapshot_at,
        label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date),
        source: row.source_name,
        entries: numberValue(metrics, "entries_vop", 0),
        exits: numberValue(metrics, "exits_vop", 0),
        stock: numberValue(metrics, "factory_stock", 0),
        over15: numberValue(metrics, "stock_over_15d", 0),
        over20: numberValue(metrics, "stock_over_20d", 0),
        production: [
          { name: "Expertise", value: numberValue(metrics, "production_expertise", 0), tone: "blue" },
          { name: "Mécanique", value: numberValue(metrics, "production_mechanics", 0), tone: "cyan" },
          { name: "DSP", value: numberValue(metrics, "production_dsp", 0), tone: "teal" },
          { name: "Carrosserie", value: numberValue(metrics, "production_bodywork", 0), tone: "yellow" },
          { name: "Préparation", value: numberValue(metrics, "production_preparation", 0), tone: "blue" },
          { name: "Qualité", value: numberValue(metrics, "production_quality", 0), tone: "cyan" },
          { name: "Sortie usine", value: numberValue(metrics, "production_factory_exit", 0), tone: "teal" },
        ],
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "dashboard_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ snapshot: verifiedSeed, backend: "verified-seed", connected: false });
  }
}
