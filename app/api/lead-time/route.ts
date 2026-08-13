import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type LeadRow = {
  source_modified_at: string | null;
  vehicle_count: number | string | null;
  avg_factory_days: number | string | null;
  median_factory_days: number | string | null;
  avg_storage_days: number | string | null;
  avg_parts_days: number | string | null;
  vop_eff_count: number | string | null;
  vop_ext_count: number | string | null;
};
type EventRow = { event_date: string | null; event_time: string | null };

function numeric(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return NextResponse.json({ available: false, historyReady: false }, { headers: { "Cache-Control": "no-store" } });

  try {
    const headers = supabaseRestHeaders(key, { Accept: "application/json" });
    const [leadResponse, historyResponse] = await Promise.all([
      fetch(`${url}/rest/v1/kpi_ftp_lead_time_summary?select=source_modified_at,vehicle_count,avg_factory_days,median_factory_days,avg_storage_days,avg_parts_days,vop_eff_count,vop_ext_count&limit=1`, { headers, cache: "no-store" }),
      fetch(`${url}/rest/v1/kpi_ftp_status_events?select=event_date,event_time&order=event_date.desc,event_time.desc&limit=1`, { headers, cache: "no-store" }),
    ]);
    if (!leadResponse.ok) throw new Error(`Supabase Lead Time ${leadResponse.status}`);
    const leadRows = await leadResponse.json() as LeadRow[];
    const historyRows = historyResponse.ok ? await historyResponse.json() as EventRow[] : [];
    const row = leadRows[0];
    return NextResponse.json({
      available: Boolean(row && numeric(row.vehicle_count)),
      sourceModifiedAt: row?.source_modified_at ?? null,
      vehicleCount: Math.round(numeric(row?.vehicle_count) ?? 0),
      avgFactoryDays: numeric(row?.avg_factory_days),
      medianFactoryDays: numeric(row?.median_factory_days),
      avgStorageDays: numeric(row?.avg_storage_days),
      avgPartsDays: numeric(row?.avg_parts_days),
      vopEffCount: Math.round(numeric(row?.vop_eff_count) ?? 0),
      vopExtCount: Math.round(numeric(row?.vop_ext_count) ?? 0),
      historyReady: historyRows.length > 0,
      latestHistoryEventDate: historyRows[0]?.event_date ?? null,
      latestHistoryEventTime: historyRows[0]?.event_time ?? null,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "lead_time_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ available: false, historyReady: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
