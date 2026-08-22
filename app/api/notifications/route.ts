import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session requise." }, 401);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 100));
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_notifications_list", {
      p_session_hash: current.tokenHash,
      p_limit: limit,
    });
    return json(payload);
  } catch (error) {
    console.error("notifications_list_failed", error);
    return json({ error: "Notifications temporairement indisponibles.", notifications: [], unread: 0 }, 503);
  }
}

export async function PATCH(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session requise." }, 401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_notifications_mark_read", {
      p_session_hash: current.tokenHash,
      p_notification_id: body.id ? String(body.id) : null,
    });
    return json(payload);
  } catch (error) {
    console.error("notifications_mark_read_failed", error);
    return json({ error: "Lecture impossible." }, 400);
  }
}

export async function DELETE(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session requise." }, 401);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (body.id) {
      const payload = await authRpc<Record<string, unknown>>("kpi_notifications_dismiss", {
        p_session_hash: current.tokenHash,
        p_notification_id: String(body.id),
      });
      return json(payload);
    }
    if (body.readOnly === true) {
      const payload = await authRpc<Record<string, unknown>>("kpi_notifications_purge_read", {
        p_session_hash: current.tokenHash,
      });
      return json(payload);
    }
    return json({ error: "Notification ou mode de purge requis." }, 400);
  } catch (error) {
    console.error("notifications_delete_failed", error);
    return json({ error: "Suppression impossible." }, 400);
  }
}
