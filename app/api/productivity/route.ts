import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function isTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("57014") || message.toLowerCase().includes("statement timeout");
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const monthDate = /^20\d{2}-\d{2}$/.test(month) ? `${month}-01` : null;
  const read = () => authRpc<Record<string, unknown>>("kpi_productivity_month", { p_session_hash: current.tokenHash, p_month: monthDate });
  try {
    let result: Record<string, unknown>;
    try {
      result = await read();
    } catch (error) {
      if (!isTimeout(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      result = await read();
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("crvo_productivity_read_failed", error);
    return NextResponse.json({ error: "Calcul de productivité temporairement indisponible. Relancez l'actualisation." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
