import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getImportIdentity } from "../../../import-auth";

export const dynamic = "force-dynamic";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ error: "Accès CRVO requis.", authRequired: true }, { status: 401 });
  const cfg = config();
  if (!cfg) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });
  const supabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("kpi_email_gateway_config").select("updated_at,updated_by").eq("id", 1).maybeSingle();
  if (error) return NextResponse.json({ error: "Impossible de lire la configuration de la passerelle." }, { status: 502 });
  return NextResponse.json({ configured: Boolean(data), updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ error: "Accès CRVO requis.", authRequired: true }, { status: 401 });
  const cfg = config();
  if (!cfg) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });
  const token = generateToken();
  const tokenSha256 = await sha256Hex(token);
  const updatedAt = new Date().toISOString();
  const supabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.from("kpi_email_gateway_config").upsert({
    id: 1,
    token_sha256: tokenSha256,
    updated_at: updatedAt,
    updated_by: identity.email,
    metadata: { channel: "make_mailhook", token_version: 1 },
  }, { onConflict: "id" });
  if (error) return NextResponse.json({ error: "Impossible de créer la clé de passerelle." }, { status: 502 });
  return NextResponse.json({ configured: true, token, updatedAt, oneTimeDisplay: true }, { headers: { "Cache-Control": "no-store" } });
}
