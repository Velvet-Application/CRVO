import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const current = await currentSession();
    if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? "";
    const monthDate = /^20\d{2}-\d{2}$/.test(month) ? `${month}-01` : null;
    const result = await authRpc<Record<string, unknown>>("kpi_productivity_month", {
      p_session_hash: current.tokenHash,
      p_month: monthDate,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Productivité indisponible." }, { status: 500 });
  }
}
