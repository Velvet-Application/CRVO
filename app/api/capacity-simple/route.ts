import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type CapacityPayload = {
  connected?: boolean;
  error?: string;
  period?: Record<string, unknown>;
  inputVehiclesPerDay?: number;
  sectors?: unknown[];
  miniStandard?: Record<string, unknown>;
};

function isTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("57014") || message.toLowerCase().includes("statement timeout");
}

async function readCapacity(tokenHash: string) {
  return authRpc<CapacityPayload>("kpi_capacity_simple", { p_session_hash: tokenHash });
}

export async function GET() {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  try {
    let payload: CapacityPayload;
    try {
      payload = await readCapacity(current.tokenHash);
    } catch (error) {
      if (!isTimeout(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      payload = await readCapacity(current.tokenHash);
    }

    if (payload.connected === false) {
      return NextResponse.json(payload, { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("crvo_capacity_simple_failed", error);
    return NextResponse.json(
      { error: "Calcul capacitaire temporairement indisponible. Relancez l'actualisation." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
