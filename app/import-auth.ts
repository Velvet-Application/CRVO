const CHATGPT_EMAIL_HEADER = "oai-authenticated-user-email";
const CLOUDFLARE_ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email";
const IMPORT_COOKIE = "crvo_import_access";
const DEFAULT_ACCESS_TOKEN_SHA256 = "fb43c6bdb581beace363759653cf45499886eacb9ede7163638e7d4fa799682e";

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

  const sessionToken = readCookie(request.headers.get("cookie"), IMPORT_COOKIE);
  if (sessionToken && isValidImportSession(sessionToken)) {
    return { email: "cloudflare-dashboard", method: "access-code" };
  }

  return null;
}

export async function isValidAccessCode(accessCode: string): Promise<boolean> {
  const normalized = normalizeAccessCode(accessCode);
  if (normalized.length < 10 || normalized.length > 128) return false;
  const actual = await sha256Hex(normalized);
  return constantTimeEqual(actual, expectedAccessCodeHash());
}

export async function createImportSessionToken(accessCode: string): Promise<string> {
  return sha256Hex(normalizeAccessCode(accessCode));
}

export function importSessionCookie(sessionToken: string): string {
  return `${IMPORT_COOKIE}=${sessionToken}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`;
}

export function clearImportSessionCookie(): string {
  return `${IMPORT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function isValidImportSession(sessionToken: string): boolean {
  return /^[a-f0-9]{64}$/.test(sessionToken)
    && constantTimeEqual(sessionToken, expectedAccessCodeHash());
}

function expectedAccessCodeHash(): string {
  return (process.env.IMPORT_ACCESS_TOKEN_SHA256 ?? DEFAULT_ACCESS_TOKEN_SHA256).toLowerCase();
}

function normalizeAccessCode(value: string): string {
  return value.trim().toLowerCase();
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
