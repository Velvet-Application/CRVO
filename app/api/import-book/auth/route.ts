import { NextResponse } from "next/server";
import {
  clearImportSessionCookie,
  createImportSessionToken,
  getImportIdentity,
  importSessionCookie,
  isValidAccessCode,
} from "../../../import-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await getImportIdentity(request);
  return NextResponse.json({
    authenticated: Boolean(identity),
    method: identity?.method ?? null,
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 415 });
  }

  const body = await request.json() as { accessCode?: string };
  const accessCode = String(body.accessCode ?? "");
  if (!await isValidAccessCode(accessCode)) {
    return NextResponse.json({ error: "Code d’accès incorrect." }, { status: 401 });
  }

  const sessionToken = await createImportSessionToken(accessCode);
  const response = NextResponse.json({ authenticated: true, method: "access-code" });
  response.headers.set("Set-Cookie", importSessionCookie(sessionToken));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.headers.set("Set-Cookie", clearImportSessionCookie());
  return response;
}
