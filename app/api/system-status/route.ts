import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DashboardPayload = {
  connected?: boolean;
  sourceMode?: string;
  liveFreshness?: {
    sourceModifiedAt?: string | null;
    factoryModifiedAt?: string | null;
    parkModifiedAt?: string | null;
  } | null;
};

export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const response = await fetch(`${origin}/api/dashboard?_=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error(`dashboard ${response.status}`);
    const dashboard = await response.json() as DashboardPayload;
    const live = dashboard.connected === true && dashboard.sourceMode === "ftp";
    const sourceModifiedAt = dashboard.liveFreshness?.sourceModifiedAt ?? dashboard.liveFreshness?.factoryModifiedAt ?? null;
    const depositAt = dashboard.liveFreshness?.parkModifiedAt ?? sourceModifiedAt;
    const ftpRefresh = live ? {
      lastRefreshAt: sourceModifiedAt,
      lastDepositAt: depositAt,
      lastDepositFilename: "EtatduParc.csv",
      filesSeen: 0,
      filesImported: 0,
    } : null;
    return NextResponse.json({
      supabase: Boolean(dashboard.connected),
      supabaseConfigured: true,
      supabaseStatus: dashboard.connected ? "connected" : "fallback",
      ftpBridge: live,
      sftpBridge: live,
      ftpRefresh,
      archiveBucket: "kpi-raw-archive",
    }, { headers: { "Cache-Control": "public, max-age=45, stale-while-revalidate=60" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "system_status_dashboard_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ supabase:false, supabaseConfigured:true, supabaseStatus:"unreachable", ftpBridge:false, sftpBridge:false, ftpRefresh:null, archiveBucket:"kpi-raw-archive" }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}
