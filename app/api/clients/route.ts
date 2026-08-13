import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
const PUBLIC_SUPABASE_KEY = "sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

const summarySelect = [
  "client","vehicle_count","expertise_count","chiffrage_count","controle_technique_count","dsp_count","jantes_count","mecanique_count","carrosserie_count","preparation_count","qualite_count","sortie_usine_count","age_0_15","age_16_20","age_21_30","age_31_plus","source_modified_at","snapshot_at",
].join(",");

const vehicleSelect = [
  "client","registration","work_order","vin","model","mileage","status","status_age_days","factory_age_days","alert","urgency","source_modified_at","snapshot_at","pending_expertise","pending_chiffrage","pending_controle_technique","pending_dsp","pending_jantes","pending_mecanique","pending_carrosserie","pending_preparation","pending_qualite","pending_sortie_usine",
].join(",");

type SummaryRow = Record<string, string | number | null> & { client: string };
type VehicleRow = Record<string, string | number | boolean | null>;

async function rest<T>(path: string): Promise<T> {
  const response = await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: PUBLIC_SUPABASE_KEY, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase public ${response.status}`);
  return response.json() as Promise<T>;
}

function n(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = String(url.searchParams.get("client") ?? "").trim();
  try {
    const summaries = await rest<SummaryRow[]>(`kpi_client_summary_public?select=${summarySelect}&order=vehicle_count.desc,client.asc`);
    if (!client) {
      return NextResponse.json({
        connected: true,
        clients: summaries.map((row) => ({ ...row, vehicle_count: n(row.vehicle_count) })),
        totalClients: summaries.length,
        totalVehicles: summaries.reduce((sum, row) => sum + n(row.vehicle_count), 0),
        sourceModifiedAt: summaries.map((row) => row.source_modified_at).filter(Boolean).sort().at(-1) ?? null,
      }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" } });
    }

    const encoded = encodeURIComponent(client);
    const [summaryRows, vehicles] = await Promise.all([
      rest<SummaryRow[]>(`kpi_client_summary_public?select=${summarySelect}&client=eq.${encoded}&limit=1`),
      rest<VehicleRow[]>(`kpi_client_vehicle_public?select=${vehicleSelect}&client=eq.${encoded}&order=factory_age_days.desc.nullslast,status_age_days.desc.nullslast&limit=5000`),
    ]);
    const summary = summaryRows[0] ?? null;
    if (!summary) return NextResponse.json({ error: "Client introuvable." }, { status: 404 });

    return NextResponse.json({
      connected: true,
      client,
      summary,
      vehicles,
      timeReady: false,
      timeMessage: "Les heures et la main-d'œuvre restantes sont prévues dans ce dashboard et seront alimentées dès que la source SQL temps/MO sera disponible.",
      sourceModifiedAt: summary.source_modified_at ?? null,
      snapshotAt: summary.snapshot_at ?? null,
    }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "client_dashboard_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "Dashboard client indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
