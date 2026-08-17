import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type Body = {
  employeeKey?: string;
  entryDate?: string | null;
  primaryJobKey?: string | null;
  teamCode?: string | null;
  neutralized?: boolean;
  neutralizedReason?: string | null;
};

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const current = await currentSession();
    const allowed = Boolean(current && (
      current.session.role === "admin" ||
      current.session.page_permissions?.includes("*") ||
      current.session.page_permissions?.includes("data_rh")
    ));
    if (!current || !allowed) return noStore({ error: "Droit Data RH requis." }, 403);

    const body = await request.json().catch(() => null) as Body | null;
    const employeeKey = String(body?.employeeKey ?? "").trim();
    const entryDate = body?.entryDate ? String(body.entryDate).trim() : null;
    const primaryJobKey = body?.primaryJobKey ? String(body.primaryJobKey).trim() : null;
    const teamCode = body?.teamCode ? String(body.teamCode).trim().toUpperCase() : null;
    if (!employeeKey) return noStore({ error: "Collaborateur requis." }, 400);
    if (entryDate && !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) return noStore({ error: "Date d'embauche invalide." }, 400);
    if (teamCode && !["A", "B", "C"].includes(teamCode)) return noStore({ error: "Équipe invalide." }, 400);

    const payload = await authRpc<Record<string, unknown>>("kpi_rh_update_staff_operational", {
      p_session_hash: current.tokenHash,
      p_employee_key: employeeKey,
      p_entry_date: entryDate,
      p_primary_job_key: primaryJobKey,
      p_team_code: teamCode,
      p_neutralized: Boolean(body?.neutralized),
      p_neutralized_reason: body?.neutralizedReason ? String(body.neutralizedReason).trim() : null,
    });
    return noStore(payload);
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Mise à jour RH impossible." }, 500);
  }
}
