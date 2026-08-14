import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

async function requireAdmin() {
  const current = await currentSession();
  if (!current?.session || current.session.role !== "admin") return null;
  return current;
}

export async function GET() {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  const users = await authRpc<Array<Record<string, unknown>>>("crvo_auth_list_users", { p_token_hash: current.tokenHash });
  return NextResponse.json({ ok: true, users }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim();
  const displayName = String(body.displayName ?? "").trim();
  const temporaryPassword = String(body.temporaryPassword ?? "");
  const role = body.role === "admin" ? "admin" : "user";
  const rows = await authRpc<Array<{ ok: boolean; user_id: string | null; error_code: string | null }>>("crvo_auth_create_user", {
    p_token_hash: current.tokenHash,
    p_username: username,
    p_display_name: displayName,
    p_temporary_password: temporaryPassword,
    p_role: role,
  });
  const row = rows[0];
  if (!row?.ok) {
    const message = row?.error_code === "username_exists" ? "Cet identifiant existe déjà." : row?.error_code === "password_too_short" ? "Le mot de passe temporaire doit contenir au moins 12 caractères." : row?.error_code === "invalid_username" ? "Identifiant invalide : 3 à 40 caractères, lettres, chiffres, point, tiret ou underscore." : "Création impossible.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, userId: row.user_id });
}

export async function PATCH(request: Request) {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const action = String(body.action ?? "");
  if (!userId) return NextResponse.json({ error: "Utilisateur manquant." }, { status: 400 });

  if (action === "set-active") {
    const rows = await authRpc<Array<{ ok: boolean; error_code: string | null }>>("crvo_auth_set_user_active", {
      p_token_hash: current.tokenHash,
      p_user_id: userId,
      p_active: Boolean(body.active),
    });
    const row = rows[0];
    if (!row?.ok) return NextResponse.json({ error: row?.error_code === "cannot_disable_self" ? "Tu ne peux pas désactiver ton propre compte." : "Modification impossible." }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset-password") {
    const temporaryPassword = String(body.temporaryPassword ?? "");
    const rows = await authRpc<Array<{ ok: boolean; error_code: string | null }>>("crvo_auth_reset_password", {
      p_token_hash: current.tokenHash,
      p_user_id: userId,
      p_temporary_password: temporaryPassword,
    });
    const row = rows[0];
    if (!row?.ok) return NextResponse.json({ error: row?.error_code === "password_too_short" ? "Le mot de passe temporaire doit contenir au moins 12 caractères." : "Réinitialisation impossible." }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
}
