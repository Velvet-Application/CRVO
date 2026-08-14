import { NextResponse } from "next/server";
import { authRpc, currentSession, sha256Hex } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const IMPORT_GATEWAY = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-email-import-gateway";
const ACCEPTED = /\.(csv|xlsx|xls)$/i;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") {
    return NextResponse.json({ error: "Accès administrateur CRVO requis." }, { status: 401 });
  }

  const incoming = await request.formData();
  const value = incoming.get("file");
  const source = String(incoming.get("source") ?? "");
  if (!value || typeof value === "string" || typeof (value as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Sélectionne un fichier à importer." }, { status: 400 });
  }
  if (!["rh", "finance", "billed_time"].includes(source)) {
    return NextResponse.json({ error: "Type de données invalide." }, { status: 400 });
  }

  const file = value as File;
  if (!ACCEPTED.test(file.name)) return NextResponse.json({ error: "Format refusé. Utilise CSV, XLSX ou XLS." }, { status: 400 });
  if (!file.size || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Le fichier dépasse la limite de 25 Mo." }, { status: 400 });

  const token = await sha256Hex(`crvo-direct-import:v1:${current.token}`);
  await authRpc<string>("kpi_set_email_gateway_token_admin", {
    p_session_hash: current.tokenHash,
    p_token_sha256: await sha256Hex(token),
  });

  const outbound = new FormData();
  outbound.set("file", file, file.name);
  outbound.set("source", source);
  outbound.set("sender", current.session.display_name || current.session.username);
  outbound.set("subject", "Import direct KPI CRVO");
  outbound.set("messageId", `direct-${Date.now()}-${crypto.randomUUID()}`);

  const response = await fetch(IMPORT_GATEWAY, {
    method: "POST",
    headers: { "x-crvo-ingest-token": token },
    body: outbound,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ error: "Réponse d'import illisible." }));
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
