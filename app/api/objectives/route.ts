import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

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
function monthKey(value: string) { return value.slice(0, 7); }
function nextMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
}
function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}
function canManage(session: Awaited<ReturnType<typeof currentSession>>) {
  if (!session) return false;
  return session.session.role === "admin" || session.session.page_permissions.includes("*") || session.session.page_permissions.includes("settings");
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ connected: false, error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const config = env();
  if (!config) return NextResponse.json({ connected: false, error: "Base CRVO non configurée." }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const url = new URL(request.url);
  const month = monthStart(url.searchParams.get("month"));
  const key = monthKey(month);
  const dailyEnd = nextMonthStart(key);
  const headers = supabaseRestHeaders(config.secretKey, { Accept: "application/json" });

  try {
    const [response, dailyResponse] = await Promise.all([
      fetch(`${config.supabaseUrl}/rest/v1/kpi_monthly_objectives?select=month,sector_key,sector_label,daily_target,min_threshold,max_threshold,updated_at&month=eq.${month}&order=sector_label.asc`, { headers, cache: "no-store" }),
      fetch(`${config.supabaseUrl}/rest/v1/kpi_daily_exit_objectives?select=target_date,target_value,updated_at&target_date=gte.${key}-01&target_date=lt.${dailyEnd}&order=target_date.asc`, { headers, cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error(`Supabase objectifs ${response.status}`);
    if (!dailyResponse.ok) throw new Error(`Supabase planning quotidien ${dailyResponse.status}`);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const dailyRows = await dailyResponse.json() as Array<Record<string, unknown>>;
    const objectives = rows.map((row) => ({
      month: row.month,
      sectorKey: String(row.sector_key),
      sectorLabel: String(row.sector_label),
      dailyTarget: Number(row.daily_target ?? 0),
      minThreshold: row.min_threshold == null ? null : Number(row.min_threshold),
      maxThreshold: row.max_threshold == null ? null : Number(row.max_threshold),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    }));
    const sortieDailyTargets = Object.fromEntries(dailyRows.map((row) => [String(row.target_date), Math.max(0, Number(row.target_value) || 0)]));
    return NextResponse.json({ connected: true, configured: objectives.length > 0, month, objectives, sortieDailyTargets, storage: "supabase" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ connected: false, month, objectives: [], sortieDailyTargets: {}, error: error instanceof Error ? error.message : "Objectifs indisponibles." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Droit Paramètres métier requis." }, { status: 403 });
  const config = env();
  if (!config) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });

  const body = await request.json() as { month?: string; objectives?: ObjectiveInput[]; sortieDailyTargets?: Record<string, number> };
  const month = monthStart(body.month ?? null);
  const key = monthKey(month);
  const objectives = Array.isArray(body.objectives) ? body.objectives : [];
  if (!objectives.length) return NextResponse.json({ error: "Aucun objectif à enregistrer." }, { status: 400 });

  const cleanObjectives = objectives.map((item) => ({
    sectorKey: String(item.sectorKey || "").trim(),
    sectorLabel: String(item.sectorLabel || "").trim(),
    dailyTarget: Math.max(0, Number(item.dailyTarget) || 0),
    minThreshold: item.minThreshold == null ? null : Math.max(0, Number(item.minThreshold) || 0),
    maxThreshold: item.maxThreshold == null ? null : Math.max(0, Number(item.maxThreshold) || 0),
  })).filter((item) => item.sectorKey && item.sectorLabel);
  if (cleanObjectives.some((item) => item.minThreshold != null && item.maxThreshold != null && item.minThreshold > item.maxThreshold)) {
    return NextResponse.json({ error: "Un seuil minimum est supérieur au seuil maximum." }, { status: 400 });
  }

  const sortieDailyTargets = Object.fromEntries(Object.entries(body.sortieDailyTargets ?? {})
    .filter(([date]) => new RegExp(`^${key}-\\d{2}$`).test(date))
    .map(([date, value]) => [date, Math.max(0, Number(value) || 0)]));
  const now = new Date().toISOString();
  const rows = cleanObjectives.map((item) => ({ month, sector_key: item.sectorKey, sector_label: item.sectorLabel, daily_target: item.dailyTarget, min_threshold: item.minThreshold, max_threshold: item.maxThreshold, updated_at: now }));
  const commonHeaders = supabaseRestHeaders(config.secretKey, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" });

  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_monthly_objectives?on_conflict=month,sector_key`, { method: "POST", headers: commonHeaders, body: JSON.stringify(rows) });
  if (!response.ok) return NextResponse.json({ error: `Enregistrement objectifs impossible (Supabase ${response.status}).` }, { status: 502 });

  const dailyRows = Object.entries(sortieDailyTargets).map(([targetDate, targetValue]) => ({ target_date: targetDate, target_value: targetValue, updated_at: now }));
  if (dailyRows.length) {
    const dailyResponse = await fetch(`${config.supabaseUrl}/rest/v1/kpi_daily_exit_objectives?on_conflict=target_date`, { method: "POST", headers: commonHeaders, body: JSON.stringify(dailyRows) });
    if (!dailyResponse.ok) return NextResponse.json({ error: `Objectifs mensuels enregistrés mais planning quotidien refusé (Supabase ${dailyResponse.status}).` }, { status: 502 });
  }

  return NextResponse.json({ saved: rows.length, dailySaved: dailyRows.length, month, storage: "supabase", by: session.session.display_name || session.session.username }, { headers: { "Cache-Control": "no-store" } });
}
