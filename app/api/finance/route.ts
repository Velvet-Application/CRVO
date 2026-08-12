import { NextResponse } from "next/server";
import { getImportIdentity } from "../../import-auth";

export const dynamic = "force-dynamic";

type FinancialMetrics = Record<string, number | string | null>;

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return null;
  return { supabaseUrl, secretKey };
}

export async function GET(request: Request) {
  const config = env();
  if (!config) return NextResponse.json({ snapshots: [], connected: false });
  const url = new URL(request.url);
  const history = url.searchParams.get("history") === "1";
  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_financial_snapshots?select=snapshot_at,source_name,original_filename,metrics,imported_at&order=snapshot_at.desc${history ? "&limit=120" : "&limit=1"}`, {
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ snapshots: [], connected: false, error: `Supabase ${response.status}` }, { status: 502 });
  const rows = await response.json() as Array<Record<string, unknown>>;
  const snapshots = rows.map((row) => ({
    date: row.snapshot_at,
    source: row.source_name,
    filename: row.original_filename,
    metrics: row.metrics ?? {},
    importedAt: row.imported_at,
  }));
  return NextResponse.json({ connected: true, snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined });
}

export async function POST(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ authRequired: true, error: "Accès protégé requis." }, { status: 401 });
  const config = env();
  if (!config) return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 503 });
  const body = await request.json() as {
    snapshotAt?: string;
    filename?: string;
    sha256?: string;
    byteSize?: number;
    metrics?: FinancialMetrics;
  };
  if (!body.snapshotAt || !/^\d{4}-\d{2}-\d{2}$/.test(body.snapshotAt)) return NextResponse.json({ error: "Date financière invalide." }, { status: 400 });
  if (!body.filename || !body.metrics || typeof body.metrics !== "object") return NextResponse.json({ error: "Import financier incomplet." }, { status: 400 });
  const row = {
    snapshot_at: body.snapshotAt,
    source_name: "Import Finance CRVO",
    original_filename: body.filename,
    sha256: body.sha256 || null,
    byte_size: Math.max(0, Number(body.byteSize) || 0),
    metrics: body.metrics,
    imported_at: new Date().toISOString(),
  };
  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_financial_snapshots?on_conflict=snapshot_at`, {
    method: "POST",
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([row]),
  });
  if (!response.ok) return NextResponse.json({ error: `Supabase ${response.status}: ${await response.text()}` }, { status: 502 });
  return NextResponse.json({ saved: true, snapshotAt: body.snapshotAt, identity: identity.method });
}
