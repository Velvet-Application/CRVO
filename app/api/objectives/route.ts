import { NextResponse } from "next/server";
import { getImportIdentity } from "../../import-auth";

export const dynamic = "force-dynamic";

type ObjectiveInput = {
  sectorKey: string;
  sectorLabel: string;
  dailyTarget: number;
  minThreshold?: number | null;
  maxThreshold?: number | null;
};

function monthStart(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 7) + "-01";
  return `${value}-01`;
}

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return null;
  return { supabaseUrl, secretKey };
}

export async function GET(request: Request) {
  const config = env();
  if (!config) return NextResponse.json({ objectives: [], connected: false });
  const url = new URL(request.url);
  const month = monthStart(url.searchParams.get("month"));
  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_monthly_objectives?select=month,sector_key,sector_label,daily_target,min_threshold,max_threshold&month=eq.${month}&order=sector_label.asc`, {
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ objectives: [], connected: false, error: `Supabase ${response.status}` }, { status: 502 });
  const rows = await response.json() as Array<Record<string, unknown>>;
  return NextResponse.json({ connected: true, month, objectives: rows.map((row) => ({
    month: row.month,
    sectorKey: row.sector_key,
    sectorLabel: row.sector_label,
    dailyTarget: Number(row.daily_target ?? 0),
    minThreshold: row.min_threshold == null ? null : Number(row.min_threshold),
    maxThreshold: row.max_threshold == null ? null : Number(row.max_threshold),
  })) });
}

export async function PUT(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ authRequired: true, error: "Accès protégé requis." }, { status: 401 });
  const config = env();
  if (!config) return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 503 });
  const body = await request.json() as { month?: string; objectives?: ObjectiveInput[] };
  const month = monthStart(body.month ?? null);
  const objectives = Array.isArray(body.objectives) ? body.objectives : [];
  if (!objectives.length) return NextResponse.json({ error: "Aucun objectif à enregistrer." }, { status: 400 });
  const rows = objectives.map((item) => ({
    month,
    sector_key: String(item.sectorKey || "").trim(),
    sector_label: String(item.sectorLabel || "").trim(),
    daily_target: Math.max(0, Number(item.dailyTarget) || 0),
    min_threshold: item.minThreshold == null || item.minThreshold === ("" as unknown as number) ? null : Math.max(0, Number(item.minThreshold) || 0),
    max_threshold: item.maxThreshold == null || item.maxThreshold === ("" as unknown as number) ? null : Math.max(0, Number(item.maxThreshold) || 0),
    updated_at: new Date().toISOString(),
  })).filter((item) => item.sector_key && item.sector_label);
  const invalid = rows.some((item) => item.min_threshold != null && item.max_threshold != null && item.min_threshold > item.max_threshold);
  if (invalid) return NextResponse.json({ error: "Un seuil minimum est supérieur au seuil maximum." }, { status: 400 });
  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_monthly_objectives?on_conflict=month,sector_key`, {
    method: "POST",
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) return NextResponse.json({ error: `Supabase ${response.status}: ${await response.text()}` }, { status: 502 });
  return NextResponse.json({ saved: rows.length, month, identity: identity.method });
}
