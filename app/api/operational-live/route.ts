import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const FUNCTION_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-operational-live";

export async function GET() {
  try {
    const current = await currentSession();
    const allowed = Boolean(current && (
      current.session.role === "admin" ||
      current.session.page_permissions?.includes("*") ||
      current.session.page_permissions?.includes("cockpit")
    ));
    if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (!allowed) return NextResponse.json({ error: "Droit Cockpit requis." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const internalKey = process.env.SUPABASE_SECRET_KEY;
    if (!internalKey) throw new Error("SUPABASE_SECRET_KEY missing");
    const response = await fetch(FUNCTION_URL, {
      headers: { "x-internal-key": internalKey, Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "operational_live_proxy_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "Données opérationnelles live indisponibles." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
