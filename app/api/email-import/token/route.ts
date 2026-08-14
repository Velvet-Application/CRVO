import { NextResponse } from "next/server";
import { getImportIdentity } from "../../../import-auth";
import { supabaseRestHeaders } from "../../../supabase-rest";

export const dynamic = "force-dynamic";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readGateway(cfg: { url: string; key: string }) {
  const response = await fetch(`${cfg.url}/rest/v1/kpi_email_gateway_config?select=updated_at,updated_by&id=eq.1&limit=1`, {
    headers: supabaseRestHeaders(cfg.key, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) return { ok: false as const, status: response.status };
  const rows = await response.json() as Array<{ updated_at?: string; updated_by?: string | null }>;
  return { ok: true as const, row: rows[0] ?? null };
}

export async function GET(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ error: "Accès CRVO requis.", authRequired: true }, { status: 401 });
  const cfg = config();
  if (!cfg) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });

  const gateway = await readGateway(cfg);
  if (!gateway.ok) return NextResponse.json({ error: `Impossible de lire la configuration de la passerelle (Supabase ${gateway.status}).` }, { status: 502 });
  return NextResponse.json({ configured: Boolean(gateway.row), updatedAt: gateway.row?.updated_at ?? null, updatedBy: gateway.row?.updated_by ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ error: "Accès CRVO requis.", authRequired: true }, { status: 401 });
  const cfg = config();
  if (!cfg) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });

  const token = generateToken();
  const tokenSha256 = await sha256Hex(token);
  const updatedAt = new Date().toISOString();
  const response = await fetch(`${cfg.url}/rest/v1/kpi_email_gateway_config?on_conflict=id`, {
    method: "POST",
    headers: supabaseRestHeaders(cfg.key, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      id: 1,
      token_sha256: tokenSha256,
      updated_at: updatedAt,
      updated_by: identity.email,
      metadata: { channel: "make_mailhook", token_version: 1 },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: `Impossible de créer la clé de passerelle (Supabase ${response.status}).` }, { status: 502 });
  }
  return NextResponse.json({ configured: true, token, updatedAt, oneTimeDisplay: true }, { headers: { "Cache-Control": "no-store" } });
}
