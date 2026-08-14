import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const current = await currentSession();
    if (!current) {
      return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
    }

    const url = new URL(request.url);
    const history = url.searchParams.get("history") === "1";
    const payload = await authRpc<Record<string, unknown>>("kpi_direction_finance", {
      p_session_hash: current.tokenHash,
      p_history: history,
    });

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "CA Direction indisponible." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
