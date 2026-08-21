import { NextRequest, NextResponse } from "next/server";
import { authRpc, currentSession, newSessionToken, sha256Hex } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

function noStore(status = 200) {
  return { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } };
}

function statusFor(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (text.includes("42501") || /non autorisé|réservé|requise/i.test(text)) return 403;
  if (text.includes("22023") || /invalide|requis|manquant|vide|maximal|format/i.test(text)) return 400;
  if (text.includes("P0002") || /introuvable/i.test(text)) return 404;
  return 503;
}

function errorMessage(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message : "";
  const match = text.match(/message\\?"?:\\?"([^"}]{3,240})/i);
  return match?.[1] || fallback;
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

async function sessionOr401() {
  const current = await currentSession();
  return current;
}

type PostBody = {
  action?: string;
  claimId?: string | null;
  payload?: Record<string, unknown>;
  attachment?: Record<string, unknown>;
  accessId?: string;
  enabled?: boolean;
  fileName?: string;
  fileSha256?: string;
  rows?: Array<Record<string, unknown>>;
  mapping?: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const current = await sessionOr401();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, noStore(401));
  const url = new URL(request.url);
  const claimId = url.searchParams.get("claimId");
  const search = url.searchParams.get("search");
  const attachmentId = url.searchParams.get("attachmentId");

  try {
    if (attachmentId) {
      const file = await authRpc<{ fileName?: string; mimeType?: string; fileData?: string }>("kpi_quality_attachment_get_private", {
        p_token_hash: current.tokenHash,
        p_attachment_id: attachmentId,
      });
      if (!file.fileData) return NextResponse.json({ error: "Pièce jointe indisponible." }, noStore(404));
      return new Response(base64Bytes(file.fileData), {
        status: 200,
        headers: {
          "Content-Type": file.mimeType || "application/octet-stream",
          "Content-Disposition": `inline; filename="${safeFileName(file.fileName)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const payload = await authRpc<Record<string, unknown>>("kpi_quality_dashboard_private", {
      p_token_hash: current.tokenHash,
      p_claim_id: claimId || null,
      p_search: search || null,
    });
    return NextResponse.json(payload, noStore());
  } catch (error) {
    console.error("quality_claims_get_failed", error);
    const status = statusFor(error);
    return NextResponse.json({ error: errorMessage(error, "Réclamations Qualité indisponibles.") }, noStore(status));
  }
}

export async function POST(request: NextRequest) {
  const current = await sessionOr401();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, noStore(401));
  const body = (await request.json().catch(() => ({}))) as PostBody;
  const action = String(body.action ?? "").trim();

  try {
    if (action === "attachment") {
      const claimId = String(body.claimId ?? "");
      if (!claimId || !body.attachment) return NextResponse.json({ error: "Pièce jointe incomplète." }, noStore(400));
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_attachment_add_private", {
        p_token_hash: current.tokenHash,
        p_claim_id: claimId,
        p_attachment: body.attachment,
      });
      return NextResponse.json(payload, noStore());
    }

    if (action === "createNetworkAccess") {
      const token = newSessionToken();
      const tokenHash = await sha256Hex(token);
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_network_access_create_private", {
        p_token_hash: current.tokenHash,
        p_access_token_hash: tokenHash,
        p_payload: body.payload ?? {},
      });
      const origin = new URL(request.url).origin;
      return NextResponse.json({ ...payload, portalPath: `/qualite/client/${token}`, portalUrl: `${origin}/qualite/client/${token}` }, noStore());
    }

    if (action === "toggleNetworkAccess") {
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_network_access_toggle_private", {
        p_token_hash: current.tokenHash,
        p_access_id: body.accessId,
        p_enabled: Boolean(body.enabled),
      });
      return NextResponse.json(payload, noStore());
    }

    if (action === "settings") {
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_settings_update_private", {
        p_token_hash: current.tokenHash,
        p_payload: body.payload ?? {},
      });
      return NextResponse.json(payload, noStore());
    }

    if (action === "import") {
      if (!body.fileName || !body.fileSha256 || !Array.isArray(body.rows)) {
        return NextResponse.json({ error: "Fichier d’import incomplet." }, noStore(400));
      }
      const payload = await authRpc<Record<string, unknown>>("kpi_quality_import_private", {
        p_token_hash: current.tokenHash,
        p_file_name: body.fileName,
        p_file_sha256: body.fileSha256,
        p_rows: body.rows,
        p_mapping: body.mapping ?? {},
      });
      return NextResponse.json(payload, noStore());
    }

    const allowed = new Set(["CREATE", "UPDATE", "DECIDE", "CLOSE", "MESSAGE", "NOTE"]);
    const dbAction = action.toUpperCase();
    if (!allowed.has(dbAction)) return NextResponse.json({ error: "Action invalide." }, noStore(400));
    const payload = await authRpc<Record<string, unknown>>("kpi_quality_claim_action_private", {
      p_token_hash: current.tokenHash,
      p_action: dbAction,
      p_claim_id: body.claimId || null,
      p_payload: body.payload ?? {},
    });
    return NextResponse.json(payload, noStore());
  } catch (error) {
    console.error("quality_claims_post_failed", error);
    const status = statusFor(error);
    return NextResponse.json({ error: errorMessage(error, "Impossible d’enregistrer l’action qualité.") }, noStore(status));
  }
}
