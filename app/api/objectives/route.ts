import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type ObjectiveInput = {
  sectorKey: string;
  sectorLabel: string;
  dailyTarget: number;
  minThreshold?: number | null;
  maxThreshold?: number | null;
};

type RpcRow = { payload: Record<string, unknown> };

function monthStart(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 7) + "-01";
  return `${value}-01`;
}
function monthKey(value: string) { return value.slice(0, 7); }
function canManage(session: Awaited<ReturnType<typeof currentSession>>) {
  if (!session) return false;
  return session.session.role === "admin" || session.session.page_permissions.includes("*") || session.session.page_permissions.includes("settings");
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ connected: false, error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const month = monthStart(url.searchParams.get("month"));
  try {
    const rows = await authRpc<RpcRow[]>("kpi_objectives_get", { p_token_hash: session.tokenHash, p_month: month });
    const payload = rows[0]?.payload;
    if (!payload) throw new Error("Référentiel objectifs indisponible.");
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("crvo_objectives_get_failed", error);
    return NextResponse.json({ connected: false, month, objectives: [], sortieDailyTargets: {}, error: "Objectifs temporairement indisponibles." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Droit Paramètres métier requis." }, { status: 403 });

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
  if (!cleanObjectives.length) return NextResponse.json({ error: "Aucun objectif valide à enregistrer." }, { status: 400 });
  if (cleanObjectives.some((item) => item.minThreshold != null && item.maxThreshold != null && item.minThreshold > item.maxThreshold)) {
    return NextResponse.json({ error: "Un seuil minimum est supérieur au seuil maximum." }, { status: 400 });
  }

  const sortieDailyTargets = Object.fromEntries(Object.entries(body.sortieDailyTargets ?? {})
    .filter(([date]) => new RegExp(`^${key}-\\d{2}$`).test(date))
    .map(([date, value]) => [date, Math.max(0, Number(value) || 0)]));

  try {
    const rows = await authRpc<RpcRow[]>("kpi_objectives_save", {
      p_token_hash: session.tokenHash,
      p_month: month,
      p_objectives: cleanObjectives,
      p_daily_targets: sortieDailyTargets,
    });
    const payload = rows[0]?.payload;
    if (!payload) throw new Error("Réponse d'enregistrement absente.");
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("crvo_objectives_save_failed", error);
    return NextResponse.json({ error: "Enregistrement objectifs temporairement indisponible." }, { status: 503 });
  }
}
