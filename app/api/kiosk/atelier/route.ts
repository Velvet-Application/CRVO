import { NextResponse } from "next/server";
import { GET as getDashboard } from "../../dashboard/route";
import { GET as getObjectives } from "../../objectives/route";

export const dynamic = "force-dynamic";

type DashboardPayload={connected?:boolean;snapshot?:{date?:string}|null;liveFreshness?:unknown};
type ObjectivesPayload={objectives?:unknown[];sortieDailyTargets?:Record<string,number>};

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const dashboardResponse = await getDashboard(new Request(`${origin}/api/dashboard?_=${Date.now()}`, { headers: request.headers }));
  const dashboard = await dashboardResponse.json() as DashboardPayload;
  const latestDate = String(dashboard.snapshot?.date ?? "");
  const month = /^\d{4}-\d{2}-\d{2}$/.test(latestDate) ? latestDate.slice(0, 7) : new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).format(new Date());
  const objectiveResponse = await getObjectives(new Request(`${origin}/api/objectives?month=${encodeURIComponent(month)}&_=${Date.now()}`, { headers: request.headers }));
  const objectives = await objectiveResponse.json() as ObjectivesPayload;

  return NextResponse.json({
    connected: Boolean(dashboard.connected),
    snapshot: dashboard.snapshot ?? null,
    liveFreshness: dashboard.liveFreshness ?? null,
    objectives: Array.isArray(objectives.objectives) ? objectives.objectives : [],
    sortieDailyTargets: objectives.sortieDailyTargets ?? {},
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
