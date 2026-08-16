import { NextResponse } from "next/server";
import { currentSession, authRpc } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type FinancialMetrics = Record<string, number | string | null>;

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ connected: false, error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const history = new URL(request.url).searchParams.get("history") === "1";
    const payload = await authRpc<Record<string, unknown>>("kpi_direction_finance", {
      p_session_hash: current.tokenHash,
      p_history: history,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "finance_real_source_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ connected: false, error: "Données financières réelles indisponibles." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") return NextResponse.json({ error: "Accès administrateur CRVO requis." }, { status: 403 });
  const config = env();
  if (!config) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });
  const body = await request.json() as { snapshotAt?: string; filename?: string; sha256?: string; byteSize?: number; metrics?: FinancialMetrics };
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
    headers: supabaseRestHeaders(config.secretKey, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([row]),
  });
  if (!response.ok) return NextResponse.json({ error: `Supabase ${response.status}: ${await response.text()}` }, { status: 502 });
  return NextResponse.json({ saved: true, snapshotAt: body.snapshotAt, by: current.session.display_name || current.session.username }, { headers: { "Cache-Control": "no-store" } });
}
