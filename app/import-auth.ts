const CHATGPT_EMAIL_HEADER = "oai-authenticated-user-email";
const CLOUDFLARE_ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
const IMPORT_COOKIE = "crvo_import_access";
const DEFAULT_ACCESS_TOKEN_SHA256 = "7305e47fcf8a5418a24e7756a055c8d435690193e482c060901c87bdf5f41986";

export type ImportIdentity = {
  email: string;
  method: "chatgpt" | "cloudflare-access" | "access-code";
};

export async function getImportIdentity(request: Request): Promise<ImportIdentity | null> {
  const chatGPTEmail = request.headers.get(CHATGPT_EMAIL_HEADER)?.trim();
  if (chatGPTEmail) return { email: chatGPTEmail, method: "chatgpt" };

  const cloudflareAccessEmail = request.headers.get(CLOUDFLARE_ACCESS_EMAIL_HEADER)?.trim();
  if (cloudflareAccessEmail) {
    return { email: cloudflareAccessEmail, method: "cloudflare-access" };
  }

  const token = readCookie(request.headers.get("cookie"), IMPORT_COOKIE);
  if (token && await isValidAccessToken(token)) {
    return { email: "cloudflare-dashboard", method: "access-code" };
  }

  return null;
}

export async function isValidAccessToken(token: string): Promise<boolean> {
  if (!/^[a-f0-9]{48}$/.test(token)) return false;
  const actual = await sha256Hex(token);
  const expected = process.env.IMPORT_ACCESS_TOKEN_SHA256 ?? DEFAULT_ACCESS_TOKEN_SHA256;
  return constantTimeEqual(actual, expected.toLowerCase());
}

export function importSessionCookie(token: string): string {
  return `${IMPORT_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`;
}

export function clearImportSessionCookie(): string {
  return `${IMPORT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const entry of cookieHeader.split(";")) {
    const [key, ...valueParts] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
