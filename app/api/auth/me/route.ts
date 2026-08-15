import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  const { session } = current;
  return NextResponse.json({
    ok: true,
    user: {
      id: session.user_id,
      username: session.username,
      displayName: session.display_name,
      role: session.role,
      accessProfile: session.access_profile,
      pagePermissions: session.page_permissions ?? [],
      productivityScopes: session.productivity_scopes ?? [],
      mustChangePassword: session.must_change_password,
      expiresAt: session.expires_at,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
