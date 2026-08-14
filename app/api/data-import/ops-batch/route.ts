import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const MAX_ROWS_PER_CHUNK = 2000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
type SourceKey = "billed_time" | "finance" | "workload";
type StartBody = { action: "start"; source?: SourceKey; filename?: string; sha256?: string; byteSize?: number; minDate?: string | null; maxDate?: string | null; totalRows?: number; headers?: string[] };
type ChunkBody = { action: "chunk"; batchId?: string; rows?: Array<{ row_index: number; data_date?: string | null; payload: Record<string, unknown> }> };
type CommitBody = { action: "commit"; batchId?: string; limit?: number };
type Body = StartBody | ChunkBody | CommitBody;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const current = await currentSession();
    if (!current || current.session.role !== "admin") return reply({ error: "Accès administrateur CRVO requis." }, 401);
    const body = await request.json().catch(() => null) as Body | null;
    if (!body?.action) return reply({ error: "Action d’import invalide." }, 400);

    if (body.action === "start") {
      const source = String(body.source ?? "") as SourceKey;
      const filename = String(body.filename ?? "").trim();
      const sha256 = String(body.sha256 ?? "").trim().toLowerCase();
      const byteSize = Number(body.byteSize ?? 0);
      const totalRows = Number(body.totalRows ?? 0);
      if (!["billed_time", "finance", "workload"].includes(source)) return reply({ error: "Type d’import invalide." }, 400);
      if (!filename || !/^[0-9a-f]{64}$/.test(sha256)) return reply({ error: "Métadonnées du fichier invalides." }, 400);
      if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_FILE_SIZE) return reply({ error: "Le fichier est vide ou dépasse 25 Mo." }, 400);
      if (!Number.isInteger(totalRows) || totalRows <= 0 || totalRows > 500000) return reply({ error: "Nombre de lignes invalide." }, 400);
      const result = await authRpc<Record<string, unknown>>("kpi_ops_batch_start_admin", {
        p_session_hash: current.tokenHash,
        p_source_key: source,
        p_filename: filename,
        p_file_sha256: sha256,
        p_byte_size: byteSize,
        p_min_date: body.minDate || null,
        p_max_date: body.maxDate || null,
        p_total_rows: totalRows,
        p_headers: Array.isArray(body.headers) ? body.headers.slice(0, 100) : [],
      });
      return reply(result);
    }

    const batchId = String(body.batchId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return reply({ error: "Lot d’import invalide." }, 400);

    if (body.action === "chunk") {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length || rows.length > MAX_ROWS_PER_CHUNK) return reply({ error: `Bloc invalide (1 à ${MAX_ROWS_PER_CHUNK} lignes).` }, 400);
      const result = await authRpc<Record<string, unknown>>("kpi_ops_batch_chunk_admin", {
        p_session_hash: current.tokenHash,
        p_batch_id: batchId,
        p_rows: rows,
      });
      return reply(result);
    }

    const limit = Math.max(500, Math.min(Number(body.limit ?? 5000) || 5000, 10000));
    const result = await authRpc<Record<string, unknown>>("kpi_ops_batch_commit_step_admin", {
      p_session_hash: current.tokenHash,
      p_batch_id: batchId,
      p_limit: limit,
    });
    return reply(result);
  } catch (error) {
    return reply({ error: error instanceof Error ? `Import impossible : ${error.message}` : "Import impossible." }, 500);
  }
}
