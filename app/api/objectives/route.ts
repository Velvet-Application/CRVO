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
type LegacyObjectives = { objectives?: ObjectiveInput[]; sortieDailyTargets?: Record<string, number> };

function monthStart(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return new Date().toISOString().slice(0, 7) + "-01";
  return `${value}-01`;
}
function monthKey(value: string) { return value.slice(0, 7); }
function canManage(session: Awaited<ReturnType<typeof currentSession>>) {
  if (!session) return false;
  return session.session.role === "admin" || session.session.page_permissions.includes("*") || session.session.page_permissions.includes("settings");
}
function cleanDailyTargets(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, number>;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([date, amount]) => new RegExp(`^${key}-\\d{2}$`).test(date) && Number.isFinite(Number(amount)))
    .map(([date, amount]) => [date, Math.max(0, Number(amount) || 0)]));
}
function legacyCookie(request: Request, key: string): LegacyObjectives | null {
  const raw = request.headers.get("cookie") ?? "";
  const name = `crvo_objectives_${key.replace("-", "_")}`;
  const entry = raw.split(/;\s*/).find((item) => item.startsWith(`${name}=`));
  if (!entry) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(entry.slice(name.length + 1))) as LegacyObjectives;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ connected: false, error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const month = monthStart(url.searchParams.get("month"));
  const key = monthKey(month);
  try {
    const rows = await authRpc<RpcRow[]>("kpi_objectives_get", { p_token_hash: session.tokenHash, p_month: month });
    const payload = rows[0]?.payload;
    if (!payload) throw new Error("Référentiel objectifs indisponible.");

    const remoteTargets = cleanDailyTargets(payload.sortieDailyTargets, key);
    if (Object.keys(remoteTargets).length === 0) {
      const legacy = legacyCookie(request, key);
      const recoveredTargets = cleanDailyTargets(legacy?.sortieDailyTargets, key);
      const objectives = Array.isArray(payload.objectives) ? payload.objectives as unknown[] : [];
      if (Object.keys(recoveredTargets).length > 0) {
        if (canManage(session) && objectives.length > 0) {
          try {
            await authRpc<RpcRow[]>("kpi_objectives_save", {
              p_token_hash: session.tokenHash,
              p_month: month,
              p_objectives: objectives,
              p_daily_targets: recoveredTargets,
            });
          } catch (recoveryError) {
            console.error("crvo_objectives_legacy_recovery_persist_failed", recoveryError);
          }
        }
        return NextResponse.json({ ...payload, sortieDailyTargets: recoveredTargets, legacyDailyTargetsRecovered: true }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    return NextResponse.json({ ...payload, sortieDailyTargets: remoteTargets }, { headers: { "Cache-Control": "no-store" } });
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

  const sortieDailyTargets = cleanDailyTargets(body.sortieDailyTargets ?? {}, key);

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
