import { supabaseRestHeaders } from "../supabase-rest";

function config() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error("Le moteur de primes n'est pas configuré côté serveur.");
  return { supabaseUrl, secretKey };
}

export async function bonusRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { supabaseUrl, secretKey } = config();
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: supabaseRestHeaders(secretKey, {
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string; error?: string; hint?: string };
    throw new Error(payload.message || payload.error || payload.hint || `RPC primes ${name} indisponible (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
