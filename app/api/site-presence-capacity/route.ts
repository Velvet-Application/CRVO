import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isoDate(value: string | null) {
  if (!value) return null;
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : null;
}

type AccessPayload = {
  allowed?: boolean;
  role?: string;
  profile?: string;
  level?: string | null;
  positionKey?: string | null;
  displayName?: string;
};

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session requise." }, 401);

  try {
    const url = new URL(request.url);
    if (url.searchParams.get("access") === "1") {
      const access = await authRpc<AccessPayload>("kpi_site_presence_capacity_access", {
        p_session_hash: current.tokenHash,
      });
      return json(access);
    }

    const requestedDate = url.searchParams.get("date");
    const date = requestedDate ? isoDate(requestedDate) : null;
    if (requestedDate && !date) return json({ error: "Date invalide." }, 400);

    if (url.searchParams.get("members") === "1") {
      const sector = String(url.searchParams.get("sector") ?? "").trim().toLowerCase();
      const team = String(url.searchParams.get("team") ?? "").trim().toUpperCase();
      if (!sector || !["A", "B", "C"].includes(team)) return json({ error: "Équipe ou activité invalide." }, 400);
      const payload = await authRpc<Record<string, unknown>>("kpi_site_presence_team_members", {
        p_session_hash: current.tokenHash,
        p_date: date,
        p_sector: sector,
        p_team: team,
      });
      return json(payload);
    }

    const payload = await authRpc<Record<string, unknown>>("kpi_site_presence_capacity_v9", {
      p_session_hash: current.tokenHash,
      p_date: date,
    });
    return json(payload);
  } catch (error) {
    console.error("site_presence_capacity_failed", error);
    const message = error instanceof Error
      ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "")
      : "Présentéisme temporairement indisponible.";
    const forbidden = /réservé|accès|interdit|42501/i.test(message);
    return json({ error: message }, forbidden ? 403 : 500);
  }
}
