import { NextResponse } from "next/server";
import { authRpc, currentSession, newSessionToken, sha256Hex } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const IMPORT_GATEWAY = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-direct-import-gateway";
const RH_IMPORT_GATEWAY = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-rh-direct-import-v2";
const ACCEPTED = /\.(csv|xlsx|xls)$/i;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const SOURCES = new Set(["rh", "finance", "billed_time"]);

type InitBody = {
  source?: string;
  filename?: string;
  byteSize?: number;
};

export async function POST(request: Request) {
  try {
    const current = await currentSession();
    const canImport = Boolean(current && (current.session.role === "admin" || current.session.page_permissions?.includes("*") || current.session.page_permissions?.includes("data_rh")));
    if (!current || !canImport) {
      return NextResponse.json({ error: "Droit Data RH requis." }, { status: 403 });
    }

    const incoming = await request.json().catch(() => null) as InitBody | null;
    const source = String(incoming?.source ?? "");
    const filename = String(incoming?.filename ?? "").trim();
    const byteSize = Number(incoming?.byteSize ?? 0);

    if (!SOURCES.has(source)) {
      return NextResponse.json({ error: "Type de données invalide." }, { status: 400 });
    }
    if (!filename || !ACCEPTED.test(filename)) {
      return NextResponse.json({ error: "Format refusé. Utilise CSV, XLSX ou XLS." }, { status: 400 });
    }
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Le fichier est vide ou dépasse la limite de 25 Mo." }, { status: 400 });
    }

    const token = newSessionToken();
    const expiresAt = await authRpc<string>("kpi_create_direct_import_token_admin", {
      p_session_hash: current.tokenHash,
      p_token_sha256: await sha256Hex(token),
      p_source_key: source,
      p_ttl_seconds: 300,
    });

    return NextResponse.json({
      ready: true,
      uploadUrl: source === "rh" ? RH_IMPORT_GATEWAY : IMPORT_GATEWAY,
      token,
      sender: current.session.display_name || current.session.username,
      expiresAt,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? `Initialisation de l'import impossible : ${error.message}` : "Initialisation de l'import impossible.",
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
