import { NextResponse } from "next/server";
import { loadKioskDashboard, loadKioskObjectives, loadKioskSystemStatus } from "../kiosk-data";

export const dynamic = "force-dynamic";

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
    const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
    return NextResponse.json(await loadKioskDashboard(url.searchParams.get("history") === "1", requestedDate), { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Écran atelier indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
