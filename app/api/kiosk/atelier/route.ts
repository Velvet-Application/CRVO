import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../../supabase-rest";
import { loadKioskDashboard, loadKioskSystemStatus } from "../kiosk-data";
import { CRVO_SUPABASE_PUBLISHABLE_KEY, CRVO_SUPABASE_URL } from "../../../lib/crvo-auth";

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

async function loadKioskObjectivesRpc(month: string | null) {
  const value = month && /^20\d{2}-\d{2}$/.test(month) ? `${month}-01` : null;
  const response = await fetch(`${CRVO_SUPABASE_URL}/rest/v1/rpc/kpi_kiosk_objectives`, {
    method: "POST",
    headers: {
      apikey: CRVO_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_month: value }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Objectifs kiosk ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return response.json();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "dashboard";
  try {
    if (resource === "objectives") {
      return NextResponse.json(await loadKioskObjectivesRpc(url.searchParams.get("month")), { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
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
