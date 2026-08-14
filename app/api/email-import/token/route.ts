import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type GatewayStatusRow = {
  configured: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin() {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") return null;
  return current;
}

export async function GET() {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur CRVO requis.", authRequired: true }, { status: 401 });

  try {
    const rows = await authRpc<GatewayStatusRow[]>("kpi_email_gateway_admin_status", {
      p_session_hash: current.tokenHash,
    });
    const status = rows[0];
    if (!status) return NextResponse.json({ error: "Session administrateur CRVO invalide." }, { status: 403 });
    return NextResponse.json({
      configured: Boolean(status.configured),
      updatedAt: status.updated_at,
      updatedBy: status.updated_by,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Configuration indisponible." }, { status: 502 });
  }
}

export async function POST() {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur CRVO requis.", authRequired: true }, { status: 401 });

  const token = generateToken();
  const tokenSha256 = await sha256Hex(token);

  try {
    const updatedAt = await authRpc<string>("kpi_set_email_gateway_token_admin", {
      p_session_hash: current.tokenHash,
      p_token_sha256: tokenSha256,
    });
    return NextResponse.json({
      configured: true,
      token,
      updatedAt: typeof updatedAt === "string" ? updatedAt : new Date().toISOString(),
      oneTimeDisplay: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Impossible de créer la clé de passerelle." }, { status: 502 });
  }
}
