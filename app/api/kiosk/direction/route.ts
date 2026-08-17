import { NextResponse } from "next/server";
import { loadKioskDashboard } from "../kiosk-data";
import { CRVO_SUPABASE_PUBLISHABLE_KEY, CRVO_SUPABASE_URL } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

async function rpc(name: string, body: Record<string, unknown>) {
  const response = await fetch(`${CRVO_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: CRVO_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${name} ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function loadDirectionFinance(history: boolean) {
  return rpc("kpi_kiosk_direction_finance", { p_history: history });
}

async function loadDirectionObjectives(month: string | null) {
  const value = month && /^20\d{2}-\d{2}$/.test(month) ? `${month}-01` : null;
  return rpc("kpi_kiosk_objectives", { p_month: value });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "dashboard";
  try {
    if (resource === "finance") {
      return NextResponse.json(await loadDirectionFinance(url.searchParams.get("history") === "1"), {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      });
    }
    if (resource === "objectives") {
      return NextResponse.json(await loadDirectionObjectives(url.searchParams.get("month")), {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      });
    }
    const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
    return NextResponse.json(await loadKioskDashboard(url.searchParams.get("history") === "1", requestedDate), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { connected: false, error: error instanceof Error ? error.message : "Écran direction indisponible." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
