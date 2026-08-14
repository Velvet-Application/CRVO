import { NextResponse } from "next/server";
import { CRVO_SESSION_COOKIE, authRpc, currentSession } from "../../../lib/crvo-auth";

export async function POST() {
  const current = await currentSession();
  if (current) await authRpc<boolean>("crvo_auth_logout", { p_token_hash: current.tokenHash }).catch(() => false);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(CRVO_SESSION_COOKIE);
  return response;
}
