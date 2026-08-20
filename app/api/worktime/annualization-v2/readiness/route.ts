import { NextResponse } from "next/server";
import { authRpc, currentSession, hasPageAccess } from "../../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const current = await currentSession();
  if (!current || !hasPageAccess(current.session, "worktime")) {
    return json({ error: "Accès Temps de travail requis." }, 403);
  }
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_annualization_v2_readiness", {
      p_session_hash: current.tokenHash,
      p_entity: "CRVO",
    });
    return json(payload);
  } catch (error) {
    const message = error instanceof Error
      ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "")
      : "Préparation Annualisation 2027 indisponible.";
    const forbidden = /accès|requis|interdit|42501/i.test(message);
    return json({ error: message }, forbidden ? 403 : 500);
  }
}
