import { NextResponse } from "next/server";
import { getImportIdentity } from "../../import-auth";

export const dynamic = "force-dynamic";

type FinancialMetrics = Record<string, number | string | null>;
type FinancialSnapshot = { date: string; source: string; filename: string; metrics: FinancialMetrics; importedAt?: string };

const verifiedFinance: FinancialSnapshot[] = [
  { date: "2026-08-11", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 11.08.2026.xlsx", metrics: { vop: 580, revenue_day: 46911.67, revenue_day_target: 90419.04761904762, revenue_cumulative: 507152.2, revenue_cumulative_target: 1898800, fre_per_vo: 885.1258490566036, mo_per_vop: 9.700913793103458, revenue_per_vop: 874.4003448275861, labor_hours: 5626.53, labor_revenue_cumulative: 255077.7 } },
  { date: "2026-08-10", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 10.08.2026.xlsx", metrics: { vop: 527, revenue_day: 73109.23, revenue_day_target: 90419.04761904762, revenue_cumulative: 460240.53, revenue_cumulative_target: 1898800, fre_per_vo: 880.8340963855421, mo_per_vop: 9.689222011385212, revenue_per_vop: 873.321688804554, labor_hours: 5106.22, labor_revenue_cumulative: 231219.5 } },
  { date: "2026-08-07", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 07.08.2026.xlsx", metrics: { vop: 444, revenue_day: 108771.86, revenue_day_target: 90419.04761904762, revenue_cumulative: 387131.3, revenue_cumulative_target: 1898800, fre_per_vo: 891.57262295082, mo_per_vop: 9.693851351351361, revenue_per_vop: 871.9173423423423, labor_hours: 4304.07, labor_revenue_cumulative: 194733.38 } },
  { date: "2026-08-06", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 06.08.2026.xlsx", metrics: { vop: 322, revenue_day: 76124.52, revenue_day_target: 90419.04761904762, revenue_cumulative: 278359.44, revenue_cumulative_target: 1898800, fre_per_vo: 809.8353191489363, mo_per_vop: 9.46767080745343, revenue_per_vop: 864.4703105590061, labor_hours: 3048.59, labor_revenue_cumulative: 137986.63 } },
  { date: "2026-08-05", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 05.08.2026.xlsx", metrics: { vop: 228, revenue_day: 44253.83, revenue_day_target: 90419.04761904762, revenue_cumulative: 202234.92, revenue_cumulative_target: 1898800, fre_per_vo: 750.0649152542371, mo_per_vop: 9.904342105263172, revenue_per_vop: 886.9952631578946, labor_hours: 2258.19, labor_revenue_cumulative: 101946 } },
  { date: "2026-08-04", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 04.08.2026.xlsx", metrics: { vop: 169, revenue_day: 104134.46, revenue_day_target: 90419.04761904762, revenue_cumulative: 157981.09, revenue_cumulative_target: 1898800, fre_per_vo: 973.2192523364483, mo_per_vop: 10.201715976331378, revenue_per_vop: 934.7993491124258, labor_hours: 1724.09, labor_revenue_cumulative: 78248 } },
  { date: "2026-08-03", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 03.08.2026.xlsx", metrics: { vop: 62, revenue_day: 53846.63, revenue_day_target: 90419.04761904762, revenue_cumulative: 53846.63, revenue_cumulative_target: 1898800, fre_per_vo: 868.4940322580645, mo_per_vop: 9.944193548387105, revenue_per_vop: 868.4940322580645, labor_hours: 616.54, labor_revenue_cumulative: 28276.52 } },
];

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return null;
  return { supabaseUrl, secretKey };
}

function mergeSnapshots(live: FinancialSnapshot[]) {
  const byDate = new Map(verifiedFinance.map((row) => [row.date, row]));
  live.forEach((row) => byDate.set(row.date, row));
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function GET(request: Request) {
  const config = env();
  const url = new URL(request.url);
  const history = url.searchParams.get("history") === "1";
  if (!config) {
    const snapshots = mergeSnapshots([]);
    return NextResponse.json({ connected: false, backend: "embedded-finance", snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined });
  }

  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_financial_snapshots?select=snapshot_at,source_name,original_filename,metrics,imported_at&order=snapshot_at.desc&limit=120`, {
      headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const live = rows.map((row) => ({
      date: String(row.snapshot_at ?? ""),
      source: String(row.source_name ?? "Import Finance CRVO"),
      filename: String(row.original_filename ?? ""),
      metrics: (row.metrics ?? {}) as FinancialMetrics,
      importedAt: row.imported_at ? String(row.imported_at) : undefined,
    }));
    const snapshots = mergeSnapshots(live);
    return NextResponse.json({ connected: true, backend: "supabase+embedded-finance", snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined });
  } catch (error) {
    console.error(JSON.stringify({ event: "finance_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    const snapshots = mergeSnapshots([]);
    return NextResponse.json({ connected: false, backend: "embedded-finance", snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined });
  }
}

export async function POST(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ authRequired: true, error: "Accès protégé requis." }, { status: 401 });
  const config = env();
  if (!config) return NextResponse.json({ error: "Supabase n'est pas configuré sur cet environnement." }, { status: 503 });
  const body = await request.json() as { snapshotAt?: string; filename?: string; sha256?: string; byteSize?: number; metrics?: FinancialMetrics };
  if (!body.snapshotAt || !/^\d{4}-\d{2}-\d{2}$/.test(body.snapshotAt)) return NextResponse.json({ error: "Date financière invalide." }, { status: 400 });
  if (!body.filename || !body.metrics || typeof body.metrics !== "object") return NextResponse.json({ error: "Import financier incomplet." }, { status: 400 });
  const row = { snapshot_at: body.snapshotAt, source_name: "Import Finance CRVO", original_filename: body.filename, sha256: body.sha256 || null, byte_size: Math.max(0, Number(body.byteSize) || 0), metrics: body.metrics, imported_at: new Date().toISOString() };
  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_financial_snapshots?on_conflict=snapshot_at`, {
    method: "POST",
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
  if (!response.ok) return NextResponse.json({ error: `Supabase ${response.status}: ${await response.text()}` }, { status: 502 });
  return NextResponse.json({ saved: true, snapshotAt: body.snapshotAt, identity: identity.method });
}
