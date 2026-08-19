import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type Enrichment = {
  connected?: boolean;
  photosYesterday?: number | null;
  currentAging?: { stock?: number | null; over15?: number | null; over20?: number | null } | null;
  oldestToExit?: Array<{
    registration?: string | null;
    workOrder?: string | null;
    model?: string | null;
    status?: string | null;
    ageDays?: number | null;
    urgency?: string | null;
    alert?: string | null;
  }>;
  source?: string | null;
};

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (current.session.role !== "admin") return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const reportDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  try {
    const payload = await authRpc<Enrichment>("kpi_daily_animation_enrichment_admin", {
      p_session_hash: current.tokenHash,
      p_report_date: reportDate,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("crvo_daily_animation_enrichment_failed", error);
    return NextResponse.json({ connected: false, error: "Complément opérationnel indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
