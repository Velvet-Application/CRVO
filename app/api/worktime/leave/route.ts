import { NextResponse } from "next/server";
import { authRpc, currentSession, hasPageAccess } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function todayParis() {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function isoDate(value: unknown, fallback: string) {
  const text = String(value ?? "");
  return /^20\d{2}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

async function access() {
  const current = await currentSession();
  if (!current || !hasPageAccess(current.session, "worktime")) return null;
  return current;
}

export async function GET(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès Temps de travail requis." }, 403);
  const url = new URL(request.url);
  const today = todayParis();
  const from = isoDate(url.searchParams.get("from"), today.slice(0, 8) + "01");
  const to = isoDate(url.searchParams.get("to"), from);
  const team = url.searchParams.get("team") || null;
  const sector = url.searchParams.get("sector") || null;
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_worktime_leave_dashboard", {
      p_session_hash: current.tokenHash,
      p_from: from,
      p_to: to,
      p_team: team,
      p_sector: sector,
    });
    return json(payload);
  } catch (error) {
    console.error("worktime_leave_dashboard_failed", error);
    return json({ error: error instanceof Error ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "") : "Planning CP indisponible." }, 500);
  }
}

export async function POST(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès Temps de travail requis." }, 403);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "submit");
  try {
    if (action === "submit") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_leave_submit", {
        p_session_hash: current.tokenHash,
        p_employee_key: String(body.employeeKey ?? ""),
        p_start: String(body.startDate ?? ""),
        p_end: String(body.endDate ?? body.startDate ?? ""),
        p_comment: body.comment ? String(body.comment) : null,
      });
      return json(result);
    }
    if (action === "decide") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_leave_decide", {
        p_session_hash: current.tokenHash,
        p_request_id: String(body.id ?? ""),
        p_decision: String(body.decision ?? ""),
        p_comment: body.comment ? String(body.comment) : null,
      });
      return json(result);
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("worktime_leave_post_failed", error);
    return json({ error: error instanceof Error ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "") : "Enregistrement impossible." }, 400);
  }
}
