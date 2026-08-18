import { NextRequest, NextResponse } from "next/server";
import { authRpc } from "../../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function noStore(status = 200) {
  return { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } };
}

type Context = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { token } = await context.params;
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_dev_expertise_client_get", { p_share_token: token });
    const connected = (payload as { connected?: boolean }).connected !== false;
    return NextResponse.json(payload, noStore(connected ? 200 : 404));
  } catch (error) {
    console.error("expertise_client_get_failed", error);
    return NextResponse.json({ error: "Dossier client temporairement indisponible." }, noStore(503));
  }
}

export async function POST(request: NextRequest, context: Context) {
  const { token } = await context.params;
  const body = await request.json().catch(() => ({})) as {
    action?: "accept" | "refuse" | "message";
    choices?: Array<{ key: string; accepted: boolean }>;
    comment?: string;
    message?: string;
  };

  try {
    if (body.action === "message") {
      const message = String(body.message ?? "").trim();
      if (!message) return NextResponse.json({ error: "Message vide." }, noStore(400));
      const payload = await authRpc<Record<string, unknown>>("kpi_dev_expertise_client_message", {
        p_share_token: token,
        p_body: message,
      });
      return NextResponse.json(payload, noStore());
    }

    if (body.action !== "accept" && body.action !== "refuse") {
      return NextResponse.json({ error: "Décision client invalide." }, noStore(400));
    }
    const payload = await authRpc<Record<string, unknown>>("kpi_dev_expertise_client_decide", {
      p_share_token: token,
      p_action: body.action,
      p_choices: Array.isArray(body.choices) ? body.choices : [],
      p_comment: String(body.comment ?? "").trim() || null,
    });
    return NextResponse.json(payload, noStore());
  } catch (error) {
    console.error("expertise_client_post_failed", error);
    return NextResponse.json({ error: "Impossible d'enregistrer votre réponse." }, noStore(503));
  }
}
