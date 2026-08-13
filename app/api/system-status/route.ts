import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

const FTP_SOURCE_ID = "dfbb57cc-8771-4e53-b52b-38defa389b64";

type BridgeRun = {
  finished_at: string | null;
  status: string;
  files_seen: number | null;
  files_imported: number | null;
  details: Record<string, unknown> | null;
};

type ImportBatch = {
  original_filename: string;
  imported_at: string;
  metadata: Record<string, unknown> | null;
};

async function rest<T>(baseUrl: string, secretKey: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json() as Promise<T>;
}

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const supabaseConfigured = Boolean(supabaseUrl && secretKey);
  let supabase = false;
  let supabaseStatus = supabaseConfigured ? "configured" : "missing";
  let ftpRefresh: {
    lastRefreshAt: string | null;
    lastDepositAt: string | null;
    lastDepositFilename: string | null;
    filesSeen: number;
    filesImported: number;
  } | null = null;

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

    if (supabase) {
      try {
        const [runs, batches] = await Promise.all([
          rest<BridgeRun[]>(supabaseUrl, secretKey, "kpi_bridge_runs?select=finished_at,status,files_seen,files_imported,details&status=eq.success&order=finished_at.desc&limit=1"),
          rest<ImportBatch[]>(supabaseUrl, secretKey, `kpi_import_batches?select=original_filename,imported_at,metadata&source_id=eq.${FTP_SOURCE_ID}&order=imported_at.desc&limit=100`),
        ]);
        const latestDeposit = batches
          .map((batch) => {
            const raw = Number(batch.metadata?.modified_at ?? 0);
            return { batch, raw };
          })
          .filter((item) => Number.isFinite(item.raw) && item.raw > 0)
          .sort((a, b) => b.raw - a.raw)[0];
        ftpRefresh = {
          lastRefreshAt: runs[0]?.finished_at ?? null,
          lastDepositAt: latestDeposit ? new Date(latestDeposit.raw).toISOString() : null,
          lastDepositFilename: latestDeposit?.batch.original_filename ?? null,
          filesSeen: Number(runs[0]?.files_seen ?? 0),
          filesImported: Number(runs[0]?.files_imported ?? 0),
        };
      } catch {
        ftpRefresh = null;
      }
    }
  }

  const ftpBridge = Boolean(process.env.FTP_BRIDGE_HEALTH_URL ?? process.env.SFTP_BRIDGE_HEALTH_URL) || Boolean(ftpRefresh?.lastRefreshAt);

  return NextResponse.json({
    supabase,
    supabaseConfigured,
    supabaseStatus,
    ftpBridge,
    ftpRefresh,
    // Compatibilité avec les versions du front qui lisaient encore cette clé.
    sftpBridge: ftpBridge,
    archiveBucket: process.env.SUPABASE_ARCHIVE_BUCKET ?? "kpi-raw-archive",
  }, { headers: { "Cache-Control": "no-store" } });
}
