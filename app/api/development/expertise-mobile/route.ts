import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isExpertiseStatus(status: unknown) {
  return /réception|reception|expert|lavage|chiffr|devis|validation/i.test(String(status ?? ""));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vehicle = url.searchParams.get("vehicle")?.trim();
  const target = new URL("/api/development/production", request.url);
  target.searchParams.set("fifo", "0");
  target.searchParams.set("_", String(Date.now()));
  if (vehicle) target.searchParams.set("vehicle", vehicle);

  const response = await fetch(target, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
      accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ connected: false, error: `HTTP ${response.status}` })) as Record<string, unknown>;

  if (!response.ok) {
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!vehicle && Array.isArray(payload.vehicles)) {
    payload.vehicles = payload.vehicles.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return row.inFactory === true && row.processProfile !== "EXCLU" && isExpertiseStatus(row.status);
    });
  }

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
  });
}
