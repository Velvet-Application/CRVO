import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type RpcRow = { payload: Record<string, unknown> };

export async function GET() {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json(
      { supabase: false, ftpBridge: false, error: "Session CRVO requise." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const rows = await authRpc<RpcRow[]>("kpi_system_status_get", { p_token_hash: session.tokenHash });
    const payload = rows[0]?.payload;
    if (!payload) throw new Error("Réponse état système absente.");
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("crvo_system_status_failed", error);
    return NextResponse.json(
      {
        supabase: false,
        supabaseConfigured: true,
        supabaseStatus: "unreachable",
        ftpBridge: false,
        sftpBridge: false,
        ftpRefresh: null,
        error: "Contrôle des sources temporairement indisponible.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
