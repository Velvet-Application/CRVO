import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 12) return NextResponse.json({ error: "Le nouveau mot de passe doit contenir au moins 12 caractères." }, { status: 400 });
  const rows = await authRpc<Array<{ ok: boolean; error_code: string | null }>>("crvo_auth_change_password", {
    p_token_hash: current.tokenHash,
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
  const row = rows[0];
  if (!row?.ok) return NextResponse.json({ error: row?.error_code === "invalid_current_password" ? "Mot de passe actuel incorrect." : "Modification impossible." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
