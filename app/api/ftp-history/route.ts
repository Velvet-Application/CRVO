import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type RpcRow = { payload: Record<string, unknown> };

function canReadSettings(session: Awaited<ReturnType<typeof currentSession>>) {
  if (!session) return false;
  const user = session.session;
  return user.role === "admin" || user.page_permissions.includes("*") || user.page_permissions.includes("settings");
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!canReadSettings(session)) return NextResponse.json({ error: "Droit Paramètres requis." }, { status: 403, headers: { "Cache-Control": "no-store" } });

  const url = new URL(request.url);
  const rawHours = Number(url.searchParams.get("hours") ?? 168);
  const rawLimit = Number(url.searchParams.get("limit") ?? 250);
  const hours = Number.isFinite(rawHours) ? Math.max(1, Math.min(Math.trunc(rawHours), 720)) : 168;
  const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(Math.trunc(rawLimit), 500)) : 250;

  try {
    const rows = await authRpc<RpcRow[]>("kpi_ftp_import_history_get", {
      p_token_hash: session.tokenHash,
      p_hours: hours,
      p_limit: limit,
    });
    const payload = rows[0]?.payload;
    if (!payload) throw new Error("Historique FTP absent.");
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("crvo_ftp_history_failed", error);
    return NextResponse.json({ ok: false, error: "Historique FTP temporairement indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
