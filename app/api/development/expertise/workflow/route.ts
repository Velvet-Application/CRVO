import { NextRequest, NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function noStore(status = 200) {
  return { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } };
}

export async function GET(request: NextRequest) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, noStore(401));
  if (current.session.role !== "admin") return NextResponse.json({ error: "Accès administrateur requis." }, noStore(403));

  const vehicleKey = request.nextUrl.searchParams.get("vehicleKey")?.trim();
  if (!vehicleKey) return NextResponse.json({ error: "Identifiant véhicule requis." }, noStore(400));

  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_dev_expertise_get", {
      p_token_hash: current.tokenHash,
      p_vehicle_key: vehicleKey,
    });
    return NextResponse.json(payload, noStore());
  } catch (error) {
    console.error("dev_expertise_workflow_get_failed", error);
    return NextResponse.json({ error: "Workflow expertise temporairement indisponible." }, noStore(503));
  }
}

export async function POST(request: NextRequest) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, noStore(401));
  if (current.session.role !== "admin") return NextResponse.json({ error: "Accès administrateur requis." }, noStore(403));

  const body = await request.json().catch(() => ({})) as {
    action?: "draft" | "validate" | "submit" | "message";
    vehicleKey?: string;
    vehicle?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
    items?: unknown[];
    message?: string;
  };

  try {
    if (body.action === "message") {
      const vehicleKey = String(body.vehicleKey ?? "").trim();
      const message = String(body.message ?? "").trim();
      if (!vehicleKey || !message) return NextResponse.json({ error: "Dossier et message requis." }, noStore(400));
      const payload = await authRpc<Record<string, unknown>>("kpi_dev_expertise_expert_message", {
        p_token_hash: current.tokenHash,
        p_vehicle_key: vehicleKey,
        p_body: message,
      });
      return NextResponse.json(payload, noStore());
    }

    if (!body.action || !["draft", "validate", "submit"].includes(body.action)) {
      return NextResponse.json({ error: "Action workflow invalide." }, noStore(400));
    }
    if (!body.vehicle || !body.snapshot) return NextResponse.json({ error: "Dossier expertise incomplet." }, noStore(400));

    const payload = await authRpc<Record<string, unknown>>("kpi_dev_expertise_save", {
      p_token_hash: current.tokenHash,
      p_vehicle: body.vehicle,
      p_snapshot: body.snapshot,
      p_items: Array.isArray(body.items) ? body.items : [],
      p_action: body.action,
    });
    return NextResponse.json(payload, noStore());
  } catch (error) {
    console.error("dev_expertise_workflow_post_failed", error);
    return NextResponse.json({ error: "Impossible d'enregistrer le workflow expertise." }, noStore(503));
  }
}
