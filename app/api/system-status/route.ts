import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const supabaseConfigured = Boolean(supabaseUrl && secretKey);
  let supabase = false;
  let supabaseStatus = supabaseConfigured ? "configured" : "missing";

  if (supabaseUrl && secretKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/kpi_dashboard_snapshots?select=id&limit=1`, {
        headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }),
        cache: "no-store",
      });
      supabase = response.ok;
      supabaseStatus = response.ok ? "connected" : `error-${response.status}`;
    } catch {
      supabaseStatus = "unreachable";
    }
  }

  return NextResponse.json({
    supabase,
    supabaseConfigured,
    supabaseStatus,
    sftpBridge: Boolean(process.env.SFTP_BRIDGE_HEALTH_URL),
    archiveBucket: process.env.SUPABASE_ARCHIVE_BUCKET ?? "kpi-raw-archive",
  }, { headers: { "Cache-Control": "no-store" } });
}
