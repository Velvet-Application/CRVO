import { NextResponse } from "next/server";
import { authRpc, currentSession, hasPageAccess } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type Payload = {
  connected?: boolean;
  error?: string;
  entity?: string;
  reportDate?: string;
  month?: string;
  sourceFile?: string;
  day?: Record<string, unknown>;
  monthToDate?: Record<string, unknown>;
  trend?: unknown[];
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session requise." }, 401);
  if (!hasPageAccess(current.session, "transphere")) return json({ error: "Accès Transphère requis." }, 403);

  const url = new URL(request.url);
  const rawDate = url.searchParams.get("date");
  const reportDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  try {
    const payload = await authRpc<Payload>("kpi_transphere_dashboard_admin", {
      p_session_hash: current.tokenHash,
      p_report_date: reportDate,
    });
    if (payload.connected === false) return json(payload, 503);
    return json({
      ...payload,
      generatedBy: current.session.display_name,
      username: current.session.username,
      canImport: current.session.role === "admin",
    });
  } catch (error) {
    console.error("transphere_dashboard_failed", error);
    return json({ error: "Dashboard Transphère temporairement indisponible." }, 503);
  }
}
