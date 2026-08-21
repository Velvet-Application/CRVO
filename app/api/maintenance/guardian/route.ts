import { NextResponse } from "next/server";
import { CRVO_SUPABASE_URL } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["heartbeat", "claim", "result"]);
const TARGET = /^screen\.(atelier|direction)$/;

export async function POST(request: Request) {
  const action = new URL(request.url).searchParams.get("action") ?? "";
  if (!ALLOWED.has(action)) return NextResponse.json({ error: "Action Guardian invalide." }, { status: 400 });
  const token = request.headers.get("x-kpi-guardian-token") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(token)) return NextResponse.json({ error: "Jeton Guardian requis." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const targetKey = String(body.targetKey ?? "");
  if (!TARGET.test(targetKey)) return NextResponse.json({ error: "Cible Guardian invalide." }, { status: 400 });
  try {
    const response = await fetch(`${CRVO_SUPABASE_URL}/functions/v1/kpi-maintenance-gateway?action=guardian-${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-kpi-guardian-token": token },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("guardian_gateway_failed", error);
    return NextResponse.json({ error: "Passerelle Guardian indisponible." }, { status: 503 });
  }
}
