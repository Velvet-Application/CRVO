export function supabaseRestHeaders(secretKey: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    apikey: secretKey,
    ...extra,
  };

  if (secretKey.startsWith("eyJ") && secretKey.split(".").length === 3) {
    headers.Authorization = `Bearer ${secretKey}`;
  }

  return headers;
}
