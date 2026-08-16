import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const current = await currentSession();
    const allowed = Boolean(current && (
      current.session.role === "admin" ||
      current.session.page_permissions?.includes("*") ||
      current.session.page_permissions?.includes("data_rh")
    ));
    if (!current || !allowed) return noStore({ error: "Droit Data RH requis." }, 403);

    const url = new URL(request.url);
    const month = String(url.searchParams.get("month") ?? "").trim();
    if (month && !/^\d{4}-\d{2}$/.test(month)) return noStore({ error: "Mois invalide." }, 400);

    const payload = await authRpc<Record<string, unknown>>("kpi_rh_staff_directory", {
      p_session_hash: current.tokenHash,
      p_month: month ? `${month}-01` : null,
    });
    return noStore(payload);
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Lecture de l'effectif impossible." }, 500);
  }
}
