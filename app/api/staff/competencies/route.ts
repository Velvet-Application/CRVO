import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type Body = {
  employeeKey?: string;
  skillKey?: string;
  status?: "active" | "training" | "inactive";
  validatedAt?: string | null;
  note?: string | null;
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
    const skillKey = String(body?.skillKey ?? "").trim();
    const status = String(body?.status ?? "active").trim().toLowerCase();
    if (!employeeKey || !skillKey) return noStore({ error: "Collaborateur et compétence requis." }, 400);
    if (!["active", "training", "inactive"].includes(status)) return noStore({ error: "Statut de compétence invalide." }, 400);
    if (body?.validatedAt && !/^\d{4}-\d{2}-\d{2}$/.test(body.validatedAt)) return noStore({ error: "Date de validation invalide." }, 400);

    const payload = await authRpc<Record<string, unknown>>("kpi_rh_set_competency", {
      p_session_hash: current.tokenHash,
      p_employee_key: employeeKey,
      p_skill_key: skillKey,
      p_status: status,
      p_validated_at: body?.validatedAt || null,
      p_note: body?.note || null,
    });
    return noStore(payload);
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "Mise à jour de la polycompétence impossible." }, 500);
  }
}
