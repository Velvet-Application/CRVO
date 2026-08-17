import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../../supabase-rest";
import { loadKioskDashboard, loadKioskObjectives, loadKioskSystemStatus } from "../kiosk-data";

export const dynamic = "force-dynamic";

async function loadVerifiedMetrics() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return [];
  const response = await fetch(`${supabaseUrl}/rest/v1/kpi_daily_verified_metrics?select=metric_date,metric_key,metric_value,source_label,verified_at&order=metric_date.asc&limit=1000`, {
    headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Lecture des métriques vérifiées impossible (${response.status}).`);
  return response.json();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "dashboard";
  try {
    if (resource === "objectives") {
      return NextResponse.json(await loadKioskObjectives(url.searchParams.get("month")), { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
    }
    if (resource === "system-status") {
      return NextResponse.json(await loadKioskSystemStatus(), { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
    }
    if (resource === "verified-metrics") {
      return NextResponse.json({ rows: await loadVerifiedMetrics() }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
    }
    const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
    return NextResponse.json(await loadKioskDashboard(url.searchParams.get("history") === "1", requestedDate), { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Écran atelier indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
