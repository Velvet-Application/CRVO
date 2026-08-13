import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FUNCTION_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-operational-live";
const ANON_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2bWtodmZtZHN0a3Vud3d1enV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU4NjQsImV4cCI6MjEwMjAzMTg2NH0.w18MDX_dL1YarUElTeo9ID0Egivav18tVqjjbkCaOxc";

export async function GET() {
  try {
    const response = await fetch(FUNCTION_URL, {
      headers: { Authorization: `Bearer ${ANON_JWT}`, apikey: ANON_JWT, Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json();
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "public, max-age=45, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "operational_live_proxy_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error: "Données opérationnelles live indisponibles." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
