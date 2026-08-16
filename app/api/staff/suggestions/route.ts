import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const current = await currentSession();
    if (!current) return noStore({ error: "Session CRVO requise." }, 401);
    const url = new URL(request.url);
    const month = String(url.searchParams.get("month") ?? "").trim();
    if (month && !/^\d{4}-\d{2}$/.test(month)) return noStore({ error: "Mois invalide." }, 400);
    const payload = await authRpc<Record<string, unknown>>("kpi_polycompetence_suggestions", {
      p_session_hash: current.tokenHash,
      p_month: month ? `${month}-01` : null,
    });
    return noStore(payload);
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Suggestions de polycompétence indisponibles." }, 500);
  }
}
