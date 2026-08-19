import { NextResponse } from "next/server";
import { authRpc, currentSession, hasPageAccess } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isoDate(value: unknown, fallback: string) {
  const text = String(value ?? "");
  return /^20\d{2}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function todayParis() {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function access() {
  const current = await currentSession();
  if (!current) return null;
  if (!hasPageAccess(current.session, "worktime")) return null;
  return current;
}

export async function GET(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès Temps de travail requis." }, 403);
  const url = new URL(request.url);
  if (url.searchParams.get("organization") === "1") {
    if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);
    try {
      const payload = await authRpc<Record<string, unknown>>("kpi_worktime_organization_admin", { p_session_hash: current.tokenHash });
      return json(payload);
    } catch (error) {
      console.error("worktime_organization_failed", error);
      return json({ error: "Organigramme temporairement indisponible." }, 503);
    }
  }
  const today = todayParis();
  const from = isoDate(url.searchParams.get("from"), today);
  const to = isoDate(url.searchParams.get("to"), from);
  const forcedEntity = current.session.access_profile === "transphere_manager" ? "TRANSPHERE" : null;
  const entity = forcedEntity ?? (String(url.searchParams.get("entity") ?? "CRVO").toUpperCase() === "TRANSPHERE" ? "TRANSPHERE" : "CRVO");
  try {
    const [payload, impactReference] = await Promise.all([
      authRpc<Record<string, unknown>>("kpi_worktime_dashboard", {
        p_session_hash: current.tokenHash,
        p_entity: entity,
        p_from: from,
        p_to: to,
      }),
      authRpc<Record<string, unknown>>("kpi_worktime_capacity_reference", {
        p_session_hash: current.tokenHash,
        p_entity: entity,
      }),
    ]);
    return json({ ...payload, impactReference, currentUser: { name: current.session.display_name, profile: current.session.access_profile } });
  } catch (error) {
    console.error("worktime_dashboard_failed", error);
    return json({ error: error instanceof Error ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "") : "Suivi du temps indisponible." }, 500);
  }
}

export async function POST(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès Temps de travail requis." }, 403);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "create");
  try {
    if (action === "create") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_create_event", {
        p_session_hash: current.tokenHash,
        p_entity: String(body.entity ?? "CRVO"),
        p_employee_key: String(body.employeeKey ?? ""),
        p_kind: String(body.kind ?? "absence"),
        p_reason: String(body.reason ?? "other"),
        p_start: String(body.startDate ?? ""),
        p_end: String(body.endDate ?? body.startDate ?? ""),
        p_event_time: body.eventTime ? String(body.eventTime) : null,
        p_comment: body.comment ? String(body.comment) : null,
      });
      return json(result);
    }
    if (action === "shift") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_set_shift", {
        p_session_hash: current.tokenHash,
        p_entity: String(body.entity ?? "CRVO"),
        p_team: String(body.team ?? ""),
        p_label: String(body.label ?? body.team ?? ""),
        p_start: body.startTime ? String(body.startTime) : null,
        p_end: body.endTime ? String(body.endTime) : null,
      });
      return json(result);
    }
    if (action === "rotation-anchor") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_set_rotation_anchor", {
        p_session_hash: current.tokenHash,
        p_anchor_monday: String(body.anchorDate ?? todayParis()),
        p_a_morning: Boolean(body.aMorning),
      });
      return json(result);
    }
    if (action === "bind-position") {
      if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_bind_position", {
        p_session_hash: current.tokenHash,
        p_position_key: String(body.positionKey ?? ""),
        p_user_id: String(body.userId ?? ""),
      });
      return json(result);
    }
    if (action === "person") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_upsert_person", {
        p_session_hash: current.tokenHash,
        p_employee_key: String(body.employeeKey ?? ""),
        p_name: String(body.name ?? ""),
        p_team: String(body.team ?? "TRANSPHERE"),
        p_service: body.service ? String(body.service) : null,
        p_active: body.active !== false,
      });
      return json(result);
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("worktime_post_failed", error);
    return json({ error: error instanceof Error ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "") : "Enregistrement impossible." }, 400);
  }
}

export async function PATCH(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès Temps de travail requis." }, 403);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "update");
  try {
    if (action === "update") {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_update_event", {
        p_session_hash: current.tokenHash,
        p_event_id: String(body.id ?? ""),
        p_reason: String(body.reason ?? "other"),
        p_start: String(body.startDate ?? ""),
        p_end: String(body.endDate ?? body.startDate ?? ""),
        p_event_time: body.eventTime ? String(body.eventTime) : null,
        p_comment: body.comment ? String(body.comment) : null,
        p_justification: body.justification ? String(body.justification) : null,
      });
      return json(result);
    }
    if (["close", "reopen", "cancel"].includes(action)) {
      const result = await authRpc<Record<string, unknown>>("kpi_worktime_set_status", {
        p_session_hash: current.tokenHash,
        p_event_id: String(body.id ?? ""),
        p_action: action,
      });
      return json(result);
    }
    return json({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("worktime_patch_failed", error);
    return json({ error: error instanceof Error ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "") : "Modification impossible." }, 400);
  }
}
