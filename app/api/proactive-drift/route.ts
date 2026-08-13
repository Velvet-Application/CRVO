import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type DriftRow = {
  registration: string | null;
  work_order: string | null;
  vin: string | null;
  client: string | null;
  model: string | null;
  flow: string | null;
  status: string | null;
  status_age_days: number | string | null;
  factory_age_days: number | string | null;
  alert: string | null;
  urgency: string | null;
  sample_count: number | string | null;
  median_days: number | string | null;
  p75_days: number | string | null;
  p90_days: number | string | null;
  proactive_level: "CRITIQUE" | "SURVEILLANCE" | "NORMAL" | "FIFO" | "INSUFFICISANT";
  abnormality_ratio: number | string | null;
  snapshot_at: string;
  source_modified_at: string | null;
};

function numeric(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return NextResponse.json({ connected: false, critical: 0, watch: 0, rows: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const query = "select=registration,work_order,vin,client,model,flow,status,status_age_days,factory_age_days,alert,urgency,sample_count,median_days,p75_days,p90_days,proactive_level,abnormality_ratio,snapshot_at,source_modified_at&proactive_level=in.(CRITIQUE,SURVEILLANCE)&order=proactive_level.asc,abnormality_ratio.desc.nullslast,status_age_days.desc.nullslast&limit=80";
    const response = await fetch(`${supabaseUrl}/rest/v1/kpi_ftp_proactive_drift?${query}`, {
      headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}`);
    const raw = await response.json() as DriftRow[];
    const rows = raw.map((item) => ({
      ...item,
      statusAgeDays: numeric(item.status_age_days),
      factoryAgeDays: numeric(item.factory_age_days),
      medianDays: numeric(item.median_days),
      p75Days: numeric(item.p75_days),
      p90Days: numeric(item.p90_days),
      abnormalityRatio: numeric(item.abnormality_ratio),
    }));
    return NextResponse.json({
      connected: true,
      critical: rows.filter((item) => item.proactive_level === "CRITIQUE").length,
      watch: rows.filter((item) => item.proactive_level === "SURVEILLANCE").length,
      rows,
      methodology: {
        scope: "VOP EFF + VOP EXT encore en usine et âgés de moins de 15 jours usine",
        critical: "Durée sur statut > max(4 × P90 historique, 3 jours)",
        watch: "Durée sur statut > max(3 × P75 historique, 1,5 jour)",
        history: "Analyse-Temps-Bruts",
      },
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "proactive_drift_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ connected: false, critical: 0, watch: 0, rows: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
