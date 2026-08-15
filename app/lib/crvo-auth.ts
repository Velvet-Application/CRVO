import { cookies } from "next/headers";

export const CRVO_SESSION_COOKIE = "crvo_session";
export const CRVO_SESSION_SECONDS = 12 * 60 * 60;

export const CRVO_SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
export const CRVO_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

export type AccessProfile = "admin" | "service_manager" | "team_manager" | "custom";

export type CrvoSession = {
  ok: boolean;
  user_id: string;
  username: string;
  display_name: string;
  role: "admin" | "user";
  must_change_password: boolean;
  expires_at: string;
  access_profile: AccessProfile;
  page_permissions: string[];
  productivity_scopes: string[];
  team_scopes: string[];
  can_manage_bonus_workflow: boolean;
};

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function authRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${CRVO_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: CRVO_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Auth RPC ${name} failed with ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

export async function validateSessionToken(token: string | null | undefined): Promise<CrvoSession | null> {
  if (!token || token.length < 32) return null;
  const hash = await sha256Hex(token);
  const rows = await authRpc<CrvoSession[]>("crvo_auth_context_v2", { p_token_hash: hash });
  return rows[0] ?? null;
}

export async function currentSession(): Promise<{ token: string; tokenHash: string; session: CrvoSession } | null> {
  const store = await cookies();
  const token = store.get(CRVO_SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const rows = await authRpc<CrvoSession[]>("crvo_auth_context_v2", { p_token_hash: tokenHash });
  const session = rows[0];
  if (!session?.ok) return null;
  return { token, tokenHash, session };
}

export function newSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
