import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type RpcRow = { payload: Record<string, unknown> };
type Probe = { key: string; label: string; ok: boolean; status: number; durationMs: number; error?: string };

async function requireAdmin() {
  const current = await currentSession();
  if (!current) return { error: NextResponse.json({ error: "Session CRVO requise." }, { status: 401 }) } as const;
  if (current.session.role !== "admin") return { error: NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 }) } as const;
  return { current } as const;
}

async function probe(origin: string, key: string, label: string, path: string, cookie: string, requiresCookie = false): Promise<Probe> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${origin}${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", ...(requiresCookie && cookie ? { cookie } : {}) },
      signal: controller.signal,
      redirect: "manual",
    });
    return { key, label, ok: response.ok, status: response.status, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { key, label, ok: false, status: 0, durationMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : "Probe failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function loadOverview(request: Request, tokenHash: string) {
  const rows = await authRpc<RpcRow[]>("kpi_maintenance_overview", { p_token_hash: tokenHash });
  const base = rows[0]?.payload ?? {};
  const origin = new URL(request.url).origin;
  const cookie = request.headers.get("cookie") ?? "";
  const probes = await Promise.all([
    probe(origin, "api.health", "API Santé", "/api/health", cookie),
    probe(origin, "api.system", "État système", "/api/system-status", cookie, true),
    probe(origin, "api.atelier", "API Atelier", "/api/kiosk/atelier?resource=dashboard", cookie),
    probe(origin, "api.direction", "API Direction", "/api/kiosk/direction?resource=dashboard", cookie, true),
    probe(origin, "pwa.manifest", "Manifest PWA", "/manifest.webmanifest", cookie),
    probe(origin, "pwa.worker", "Service Worker", "/sw.js", cookie),
  ]);
  return { ...base, probes, checkedAt: new Date().toISOString() };
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  try {
    const payload = await loadOverview(request, auth.current.tokenHash);
    if (new URL(request.url).searchParams.get("log") === "1") {
      const probes = (payload.probes as Probe[]) ?? [];
      const failed = probes.filter(item => !item.ok);
      await authRpc<RpcRow[]>("kpi_maintenance_event_admin", {
        p_token_hash: auth.current.tokenHash,
        p_target_key: "platform.supabase",
        p_event_type: "diagnostic_full",
        p_severity: failed.length ? "warning" : "info",
        p_message: failed.length ? `Diagnostic complet : ${failed.length} contrôle(s) en anomalie.` : "Diagnostic complet : tous les contrôles répondent.",
        p_details: { probes },
      }).catch(() => null);
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("maintenance_overview_failed", error);
    return NextResponse.json({ error: "Centre de maintenance indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const kind = String(body.kind ?? "command");
    const targetKey = String(body.targetKey ?? "");
    if (kind === "guardian-token") {
      const rows = await authRpc<RpcRow[]>("kpi_maintenance_agent_token_rotate", { p_token_hash: auth.current.tokenHash, p_target_key: targetKey });
      return NextResponse.json(rows[0]?.payload ?? { ok: false }, { headers: { "Cache-Control": "no-store" } });
    }
    const action = String(body.action ?? "");
    const rows = await authRpc<RpcRow[]>("kpi_maintenance_command_request", {
      p_token_hash: auth.current.tokenHash,
      p_target_key: targetKey,
      p_action: action,
      p_request: body.request && typeof body.request === "object" ? body.request : {},
    });
    return NextResponse.json(rows[0]?.payload ?? { ok: false }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("maintenance_action_failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action de maintenance impossible." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
