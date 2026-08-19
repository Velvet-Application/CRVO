import { NextResponse } from "next/server";
import { authRpc, currentSession, hasPageAccess } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session CRVO requise." }, 401);
  if (!hasPageAccess(current.session, "reporting")) return json({ error: "Accès pilotage requis." }, 403);
  const url = new URL(request.url);
  const positionKey = String(url.searchParams.get("position") ?? "").trim() || null;
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_animation_export", {
      p_session_hash: current.tokenHash,
      p_position_key: positionKey,
    });
    return json({ ...payload, currentUser: { username: current.session.username, name: current.session.display_name, role: current.session.role } });
  } catch (error) {
    console.error("animation_export_failed", error);
    return json({ error: error instanceof Error ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "") : "Matrice d'export indisponible." }, 500);
  }
}
