import { NextResponse } from "next/server";
import { getImportIdentity } from "../../import-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type ObjectiveInput = {
  sectorKey: string;
  sectorLabel: string;
  dailyTarget: number;
  minThreshold?: number | null;
  maxThreshold?: number | null;
};

type StoredObjectives = {
  objectives: ObjectiveInput[];
  sortieDailyTargets: Record<string, number>;
};

const FALLBACK_OBJECTIVES: ObjectiveInput[] = [
  { sectorKey: "expertise", sectorLabel: "Expertise", dailyTarget: 90, minThreshold: 0, maxThreshold: 160 },
  { sectorKey: "chiffrage", sectorLabel: "Chiffrage", dailyTarget: 50, minThreshold: 0, maxThreshold: 25 },
  { sectorKey: "controle_technique", sectorLabel: "Contrôle technique", dailyTarget: 50, minThreshold: 0, maxThreshold: 70 },
  { sectorKey: "dsp", sectorLabel: "DSP", dailyTarget: 48, minThreshold: 40, maxThreshold: 80 },
  { sectorKey: "jantes", sectorLabel: "Jantes", dailyTarget: 35, minThreshold: 40, maxThreshold: 80 },
  { sectorKey: "mecanique", sectorLabel: "Mécanique", dailyTarget: 85, minThreshold: 85, maxThreshold: 160 },
  { sectorKey: "carrosserie", sectorLabel: "Carrosserie", dailyTarget: 63, minThreshold: 100, maxThreshold: 200 },
  { sectorKey: "parc_travaux", sectorLabel: "Parc travaux", dailyTarget: 80, minThreshold: 150, maxThreshold: 300 },
  { sectorKey: "preparation", sectorLabel: "Préparation", dailyTarget: 90, minThreshold: 50, maxThreshold: 150 },
  { sectorKey: "qualite", sectorLabel: "Qualité", dailyTarget: 90, minThreshold: 0, maxThreshold: 10 },
  { sectorKey: "sortie_usine", sectorLabel: "Sortie usine", dailyTarget: 92, minThreshold: null, maxThreshold: null },
];

function monthStart(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 7) + "-01";
  return `${value}-01`;
}

function monthKey(value: string) { return value.slice(0, 7); }
function cookieName(month: string) { return `crvo_objectives_${month.replace("-", "_")}`; }

function nextMonthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return date.toISOString().slice(0, 10);
}

function readCookie(request: Request, month: string): StoredObjectives | null {
  const raw = request.headers.get("cookie") ?? "";
  const name = cookieName(month);
  const item = raw.split(/;\s*/).find((entry) => entry.startsWith(`${name}=`));
  if (!item) return null;
  try {
    const value = decodeURIComponent(item.slice(name.length + 1));
    const parsed = JSON.parse(value) as StoredObjectives;
    if (!parsed || !Array.isArray(parsed.objectives) || typeof parsed.sortieDailyTargets !== "object") return null;
    return parsed;
  } catch { return null; }
}

function withCookie(response: NextResponse, month: string, payload: StoredObjectives) {
  response.cookies.set(cookieName(month), JSON.stringify(payload), {
    path: "/",
    maxAge: 60 * 60 * 24 * 370,
    sameSite: "lax",
    secure: true,
    httpOnly: false,
  });
  return response;
}

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return null;
  return { supabaseUrl, secretKey };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = monthStart(url.searchParams.get("month"));
  const key = monthKey(month);
  const local = readCookie(request, key);
  const config = env();

  if (!config) {
    return NextResponse.json({
      objectives: local?.objectives?.length ? local.objectives : FALLBACK_OBJECTIVES,
      sortieDailyTargets: local?.sortieDailyTargets ?? {},
      month,
      connected: false,
      storage: local ? "browser" : "fallback",
    });
  }

  const headers = supabaseRestHeaders(config.secretKey, { Accept: "application/json" });
  const dailyEnd = nextMonthStart(key);
  const [response, dailyResponse] = await Promise.all([
    fetch(`${config.supabaseUrl}/rest/v1/kpi_monthly_objectives?select=month,sector_key,sector_label,daily_target,min_threshold,max_threshold&month=eq.${month}&order=sector_label.asc`, {
      headers,
      cache: "no-store",
    }),
    fetch(`${config.supabaseUrl}/rest/v1/kpi_daily_exit_objectives?select=target_date,target_value&target_date=gte.${key}-01&target_date=lt.${dailyEnd}&order=target_date.asc`, {
      headers,
      cache: "no-store",
    }),
  ]);

  if (!response.ok) {
    return NextResponse.json({
      objectives: local?.objectives?.length ? local.objectives : FALLBACK_OBJECTIVES,
      sortieDailyTargets: local?.sortieDailyTargets ?? {},
      month,
      connected: false,
      storage: local ? "browser" : "fallback",
      error: `Supabase ${response.status}`,
    });
  }

  const rows = await response.json() as Array<Record<string, unknown>>;
  const objectives = rows.length ? rows.map((row) => ({
    month: row.month,
    sectorKey: String(row.sector_key),
    sectorLabel: String(row.sector_label),
    dailyTarget: Number(row.daily_target ?? 0),
    minThreshold: row.min_threshold == null ? null : Number(row.min_threshold),
    maxThreshold: row.max_threshold == null ? null : Number(row.max_threshold),
  })) : (local?.objectives?.length ? local.objectives : FALLBACK_OBJECTIVES);

  let remoteDailyTargets: Record<string, number> = {};
  if (dailyResponse.ok) {
    const dailyRows = await dailyResponse.json() as Array<Record<string, unknown>>;
    remoteDailyTargets = Object.fromEntries(dailyRows.map((row) => [String(row.target_date), Math.max(0, Number(row.target_value) || 0)]));
  }

  const sortieDailyTargets = Object.keys(remoteDailyTargets).length
    ? remoteDailyTargets
    : (local?.sortieDailyTargets ?? {});

  return NextResponse.json({
    connected: true,
    month,
    objectives,
    sortieDailyTargets,
    storage: rows.length || Object.keys(remoteDailyTargets).length ? "supabase" : local ? "browser" : "fallback",
  });
}

export async function PUT(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ authRequired: true, error: "Accès protégé requis." }, { status: 401 });

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

  const invalid = cleanObjectives.some((item) => item.minThreshold != null && item.maxThreshold != null && item.minThreshold > item.maxThreshold);
  if (invalid) return NextResponse.json({ error: "Un seuil minimum est supérieur au seuil maximum." }, { status: 400 });

  const sortieDailyTargets = Object.fromEntries(Object.entries(body.sortieDailyTargets ?? {})
    .filter(([date]) => new RegExp(`^${key}-\\d{2}$`).test(date))
    .map(([date, value]) => [date, Math.max(0, Number(value) || 0)]));

  const payload: StoredObjectives = { objectives: cleanObjectives, sortieDailyTargets };
  const config = env();
  if (!config) {
    return withCookie(NextResponse.json({ saved: cleanObjectives.length, month, identity: identity.method, storage: "browser" }), key, payload);
  }

  const rows = cleanObjectives.map((item) => ({
    month,
    sector_key: item.sectorKey,
    sector_label: item.sectorLabel,
    daily_target: item.dailyTarget,
    min_threshold: item.minThreshold,
    max_threshold: item.maxThreshold,
    updated_at: new Date().toISOString(),
  }));

  const commonHeaders = supabaseRestHeaders(config.secretKey, {
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  });

  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_monthly_objectives?on_conflict=month,sector_key`, {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    return withCookie(NextResponse.json({ saved: cleanObjectives.length, month, identity: identity.method, storage: "browser", warning: "Supabase indisponible, sauvegarde navigateur utilisée." }), key, payload);
  }

  let dailySaved = 0;
  let dailyWarning: string | undefined;
  const dailyRows = Object.entries(sortieDailyTargets).map(([targetDate, targetValue]) => ({
    target_date: targetDate,
    target_value: targetValue,
    updated_at: new Date().toISOString(),
  }));

  if (dailyRows.length) {
    const dailyResponse = await fetch(`${config.supabaseUrl}/rest/v1/kpi_daily_exit_objectives?on_conflict=target_date`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(dailyRows),
    });
    if (dailyResponse.ok) dailySaved = dailyRows.length;
    else dailyWarning = `Planning quotidien conservé dans le navigateur (Supabase ${dailyResponse.status}).`;
  }

  return withCookie(NextResponse.json({
    saved: rows.length,
    dailySaved,
    month,
    identity: identity.method,
    storage: dailyWarning ? "supabase+browser" : "supabase+browser",
    warning: dailyWarning,
  }), key, payload);
}
