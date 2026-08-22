import { NextResponse } from "next/server";
import { CRVO_SESSION_COOKIE, CRVO_SESSION_SECONDS, authRpc, isClientPortalSession, newSessionToken, sha256Hex, type CrvoSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type LoginRow = {
  ok: boolean;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  role: "admin" | "user" | null;
  must_change_password: boolean;
  expires_at: string | null;
  error_code: string | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (!username || !password) return NextResponse.json({ error: "Identifiant et mot de passe requis." }, { status: 400 });

    const token = newSessionToken();
    const tokenHash = await sha256Hex(token);
    const rows = await authRpc<LoginRow[]>("crvo_auth_login", {
      p_username: username,
      p_password: password,
      p_token_hash: tokenHash,
      p_user_agent: request.headers.get("user-agent") ?? "",
    });
    const row = rows[0];
    if (!row?.ok) {
      const locked = row?.error_code === "temporarily_locked";
      const disabled = row?.error_code === "account_disabled";
      return NextResponse.json(
        { error: locked ? "Compte temporairement verrouillé après plusieurs tentatives." : disabled ? "Ce compte est désactivé." : "Identifiant ou mot de passe incorrect." },
        { status: locked ? 423 : 401 },
      );
    }

    const contextRows = await authRpc<CrvoSession[]>("crvo_auth_context_v3", { p_token_hash: tokenHash });
    const context = contextRows[0] ?? null;
    const clientPortal = context ? isClientPortalSession(context) : false;

    const response = NextResponse.json({
      ok: true,
      user: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        mustChangePassword: row.must_change_password,
        accessProfile: context?.access_profile ?? null,
        clientPortal,
      },
    });
    response.cookies.set(CRVO_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: CRVO_SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("crvo_login_failed", error);
    return NextResponse.json({ error: "Connexion temporairement indisponible." }, { status: 503 });
  }
}
