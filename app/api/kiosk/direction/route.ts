import { NextResponse } from "next/server";
import { GET as getDashboard } from "../../dashboard/route";
import { GET as getFinance } from "../../finance/route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const [dashboardResponse, financeResponse] = await Promise.all([
    getDashboard(new Request(`${origin}/api/dashboard?history=1&_=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } })),
    getFinance(new Request(`${origin}/api/finance?history=1&_=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } })),
  ]);
  const dashboard = await dashboardResponse.json();
  const finance = await financeResponse.json();

  return NextResponse.json({
    dashboard: {
      connected: Boolean(dashboard?.connected),
      snapshot: dashboard?.snapshot ?? null,
      snapshots: Array.isArray(dashboard?.snapshots) ? dashboard.snapshots : [],
      liveFreshness: dashboard?.liveFreshness ?? null,
    },
    finance: {
      snapshot: finance?.snapshot ?? null,
      snapshots: Array.isArray(finance?.snapshots) ? finance.snapshots : [],
    },
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
