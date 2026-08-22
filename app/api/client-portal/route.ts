import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function response(status = 200) {
  return { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } };
}

function statusFor(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (text.includes("42501") || /forbidden|session required/i.test(text)) return 403;
  if (text.includes("22023") || /required|invalide|requis|maximal/i.test(text)) return 400;
  if (text.includes("P0002") || /not found|introuvable/i.test(text)) return 404;
  return 503;
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session requise." }, response(401));
  const url = new URL(request.url);
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_client_portal_private", {
      p_token_hash: current.tokenHash,
      p_client: url.searchParams.get("client") || null,
      p_registration: url.searchParams.get("registration") || null,
    });
    return NextResponse.json(payload, response());
  } catch (error) {
    console.error("client_portal_get_failed", error);
    const status = statusFor(error);
    return NextResponse.json({ error: status === 403 ? "Ce compte n’est pas autorisé à consulter cette concession." : "Espace client temporairement indisponible." }, response(status));
  }
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session requise." }, response(401));
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  try {
    if (action === "createClaim") {
      const payload = await authRpc<Record<string, unknown>>("kpi_client_claim_create_private", {
        p_token_hash: current.tokenHash,
        p_client: String(body.client ?? ""),
        p_registration: String(body.registration ?? ""),
        p_category: String(body.category ?? "Autre"),
        p_description: String(body.description ?? ""),
        p_returned_at: body.returnedAt || null,
      });
      return NextResponse.json(payload, response());
    }
    if (action === "addAttachment") {
      const payload = await authRpc<Record<string, unknown>>("kpi_client_claim_attachment_add_private", {
        p_token_hash: current.tokenHash,
        p_claim_id: String(body.claimId ?? ""),
        p_attachment: body.attachment ?? {},
      });
      return NextResponse.json(payload, response());
    }
    return NextResponse.json({ error: "Action inconnue." }, response(400));
  } catch (error) {
    console.error("client_portal_post_failed", error);
    const status = statusFor(error);
    return NextResponse.json({ error: status === 403 ? "Action non autorisée pour cette concession." : status === 404 ? "Véhicule introuvable pour cette concession." : "Impossible d’enregistrer la demande." }, response(status));
  }
}
