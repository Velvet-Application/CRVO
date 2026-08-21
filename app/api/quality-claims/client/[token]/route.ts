import { NextRequest, NextResponse } from "next/server";
import { authRpc, sha256Hex } from "../../../../lib/crvo-auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

type Context = { params: Promise<{ token: string }> };

type Body = {
  action?: "create" | "message" | "attachment";
  claimId?: string;
  payload?: Record<string, unknown>;
  message?: string;
  attachment?: Record<string, unknown>;
};

function noStore(status = 200) {
  return { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Referrer-Policy": "no-referrer" } };
}

function base64Bytes(value: string) {
  const clean = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeFileName(value: unknown) {
  return String(value ?? "piece-jointe").replace(/[\r\n"\\]/g, "_").slice(0, 180) || "piece-jointe";
}

function statusFor(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (text.includes("42501") || /invalide ou expiré|non autorisé/i.test(text)) return 403;
  if (text.includes("22023") || /invalide|requis|vide|maximal|format/i.test(text)) return 400;
  if (text.includes("P0002") || /introuvable/i.test(text)) return 404;
  return 503;
}

async function tokenHash(context: Context) {
  const { token } = await context.params;
  if (!token || token.length < 32) throw new Error("Accès réseau invalide ou expiré.");
  return sha256Hex(token);
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const hash = await tokenHash(context);
    const url = new URL(request.url);
    const registration = url.searchParams.get("registration");
    const claimId = url.searchParams.get("claimId");
    const attachmentId = url.searchParams.get("attachmentId");

    if (registration) {
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_vehicle_lookup_network", {
        p_access_token_hash: hash,
        p_registration: registration,
      });
      return NextResponse.json(payload, noStore());
    }

    if (attachmentId) {
      const file = await authRpc<{ fileName?: string; mimeType?: string; fileData?: string }>("kpi_quality_attachment_get_network", {
        p_access_token_hash: hash,
        p_attachment_id: attachmentId,
      });
      if (!file.fileData) return NextResponse.json({ error: "Pièce jointe indisponible." }, noStore(404));
      return new Response(base64Bytes(file.fileData), {
        status: 200,
        headers: {
          "Content-Type": file.mimeType || "application/octet-stream",
          "Content-Disposition": `inline; filename="${safeFileName(file.fileName)}"`,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const payload = await authRpc<Record<string, unknown>>("kpi_quality_network_dashboard", {
      p_access_token_hash: hash,
      p_claim_id: claimId || null,
    });
    return NextResponse.json(payload, noStore());
  } catch (error) {
    console.error("quality_network_get_failed", error);
    return NextResponse.json({ error: statusFor(error) === 403 ? "Ce lien n’est plus valide. Contactez le CRVO." : "Service Qualité temporairement indisponible." }, noStore(statusFor(error)));
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const hash = await tokenHash(context);
    const body = (await request.json().catch(() => ({}))) as Body;

    if (body.action === "create") {
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_network_create", {
        p_access_token_hash: hash,
        p_payload: body.payload ?? {},
      });
      return NextResponse.json(payload, noStore());
    }

    if (body.action === "message") {
      if (!body.claimId || !String(body.message ?? "").trim()) return NextResponse.json({ error: "Message incomplet." }, noStore(400));
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_network_message", {
        p_access_token_hash: hash,
        p_claim_id: body.claimId,
        p_body: String(body.message).trim(),
      });
      return NextResponse.json(payload, noStore());
    }

    if (body.action === "attachment") {
      if (!body.claimId || !body.attachment) return NextResponse.json({ error: "Pièce jointe incomplète." }, noStore(400));
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_attachment_add_network", {
        p_access_token_hash: hash,
        p_claim_id: body.claimId,
        p_attachment: body.attachment,
      });
      return NextResponse.json(payload, noStore());
    }

    return NextResponse.json({ error: "Action invalide." }, noStore(400));
  } catch (error) {
    console.error("quality_network_post_failed", error);
    const status = statusFor(error);
    return NextResponse.json({ error: status === 403 ? "Ce lien n’est plus valide. Contactez le CRVO." : "Impossible d’enregistrer votre demande." }, noStore(status));
  }
}
