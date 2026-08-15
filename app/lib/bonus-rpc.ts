import { CRVO_SUPABASE_PUBLISHABLE_KEY, CRVO_SUPABASE_URL } from "./crvo-auth";

export async function bonusRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
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
    const payload = await response.json().catch(() => ({})) as { message?: string; error?: string; hint?: string };
    throw new Error(payload.message || payload.error || payload.hint || `RPC primes ${name} indisponible (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
