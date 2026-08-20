import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

async function requireAdmin() {
  const current = await currentSession();
  if (!current?.session || current.session.role !== "admin") return null;
  return current;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function accessError(code: string | null | undefined) {
  if (code === "username_exists") return "Cet identifiant existe déjà.";
  if (code === "password_too_short") return "Le mot de passe temporaire doit contenir au moins 12 caractères.";
  if (code === "invalid_username") return "Identifiant invalide : 3 à 40 caractères, lettres, chiffres, point, tiret ou underscore.";
  if (code === "invalid_profile") return "Profil d'accès invalide.";
  if (code === "invalid_permission") return "Une page sélectionnée n'est pas autorisée.";
  if (code === "invalid_scope") return "Un périmètre de productivité sélectionné n'est pas autorisé.";
  if (code === "invalid_team_scope" || code === "team_scope_required") return "Le profil Chef d'équipe nécessite au moins une équipe autorisée.";
  if (code === "cannot_change_self_access") return "Tu ne peux pas réduire les droits de ton propre compte administrateur.";
  if (code === "not_found") return "Utilisateur introuvable.";
  return "Modification impossible.";
}

export async function GET() {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  const users = await authRpc<Array<Record<string, unknown>>>("crvo_auth_list_users_v3", { p_token_hash: current.tokenHash });
  return NextResponse.json({ ok: true, users }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const current = await requireAdmin();
  if (!current) return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim();
  const displayName = String(body.displayName ?? "").trim();
  const temporaryPassword = String(body.temporaryPassword ?? "");
  const accessProfile = String(body.accessProfile ?? "custom");
  const rows = await authRpc<Array<{ ok: boolean; user_id: string | null; error_code: string | null }>>("crvo_auth_create_user_v4", {
    p_token_hash: current.tokenHash,
    p_username: username,
    p_display_name: displayName,
    p_temporary_password: temporaryPassword,
    p_access_profile: accessProfile,
    p_page_permissions: list(body.pagePermissions),
    p_productivity_scopes: list(body.productivityScopes),
    p_team_scopes: list(body.teamScopes),
  });
  const row = rows[0];
  if (!row?.ok) return NextResponse.json({ error: accessError(row?.error_code) }, { status: 400 });
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
    const rows = await authRpc<Array<{ ok: boolean; error_code: string | null }>>("crvo_auth_set_user_active", { p_token_hash: current.tokenHash, p_user_id: userId, p_active: Boolean(body.active) });
    const row = rows[0];
    if (!row?.ok) return NextResponse.json({ error: row?.error_code === "cannot_disable_self" ? "Tu ne peux pas désactiver ton propre compte." : "Modification impossible." }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset-password") {
    const rows = await authRpc<Array<{ ok: boolean; error_code: string | null }>>("crvo_auth_reset_password", { p_token_hash: current.tokenHash, p_user_id: userId, p_temporary_password: String(body.temporaryPassword ?? "") });
    const row = rows[0];
    if (!row?.ok) return NextResponse.json({ error: row?.error_code === "password_too_short" ? "Le mot de passe temporaire doit contenir au moins 12 caractères." : "Réinitialisation impossible." }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "update-access") {
    const rows = await authRpc<Array<{ ok: boolean; error_code: string | null }>>("crvo_auth_update_user_access_v4", {
      p_token_hash: current.tokenHash,
      p_user_id: userId,
      p_access_profile: String(body.accessProfile ?? "custom"),
      p_page_permissions: list(body.pagePermissions),
      p_productivity_scopes: list(body.productivityScopes),
      p_team_scopes: list(body.teamScopes),
    });
    const row = rows[0];
    if (!row?.ok) return NextResponse.json({ error: accessError(row?.error_code) }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
}
