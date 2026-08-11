import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY),
    sftpBridge: Boolean(process.env.SFTP_BRIDGE_HEALTH_URL),
    archiveBucket: process.env.SUPABASE_ARCHIVE_BUCKET ?? "kpi-raw-archive",
  }, { headers: { "Cache-Control": "no-store" } });
}
