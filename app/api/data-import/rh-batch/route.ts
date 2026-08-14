import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const MAX_ROWS_PER_CHUNK = 2500;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

type StartBody = {
  action: "start";
  filename?: string;
  sha256?: string;
  byteSize?: number;
  minDate?: string | null;
  maxDate?: string | null;
  totalRows?: number;
  headers?: string[];
};

type ChunkRow = {
  row_index: number;
  work_date: string;
  mechanic_name: string;
  time_code?: string | null;
  time_description?: string | null;
  time_value: number;
  matricule?: string | null;
  service?: string | null;
  team_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type ChunkBody = { action: "chunk"; batchId?: string; rows?: ChunkRow[] };
type CommitBody = { action: "commit"; batchId?: string; days?: number };
type FinishBody = { action: "finish"; batchId?: string };
type Body = StartBody | ChunkBody | CommitBody | FinishBody;

type CommitResult = Record<string, unknown> & { imported?: boolean; remainingRows?: number };

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const current = await currentSession();
    if (!current || current.session.role !== "admin") return noStore({ error: "Accès administrateur CRVO requis." }, 401);

    const body = await request.json().catch(() => null) as Body | null;
    if (!body?.action) return noStore({ error: "Action d’import RH invalide." }, 400);

    if (body.action === "start") {
      const filename = String(body.filename ?? "").trim();
      const sha256 = String(body.sha256 ?? "").trim().toLowerCase();
      const byteSize = Number(body.byteSize ?? 0);
      const totalRows = Number(body.totalRows ?? 0);
      if (!filename || !/^[0-9a-f]{64}$/.test(sha256)) return noStore({ error: "Métadonnées du fichier RH invalides." }, 400);
      if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_FILE_SIZE) return noStore({ error: "Le fichier RH est vide ou dépasse 25 Mo." }, 400);
      if (!Number.isInteger(totalRows) || totalRows <= 0 || totalRows > 500000) return noStore({ error: "Nombre de lignes RH invalide." }, 400);

      const result = await authRpc<Record<string, unknown>>("kpi_rh_batch_start_admin", {
        p_session_hash: current.tokenHash,
        p_filename: filename,
        p_file_sha256: sha256,
        p_byte_size: byteSize,
        p_min_date: body.minDate || null,
        p_max_date: body.maxDate || null,
        p_total_rows: totalRows,
        p_headers: Array.isArray(body.headers) ? body.headers.slice(0, 100) : [],
      });
      return noStore(result);
    }

    if (body.action === "chunk") {
      const batchId = String(body.batchId ?? "").trim();
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!/^[0-9a-f-]{36}$/i.test(batchId)) return noStore({ error: "Lot RH invalide." }, 400);
      if (!rows.length || rows.length > MAX_ROWS_PER_CHUNK) return noStore({ error: `Bloc RH invalide (1 à ${MAX_ROWS_PER_CHUNK} lignes).` }, 400);
      const result = await authRpc<Record<string, unknown>>("kpi_rh_batch_chunk_admin", {
        p_session_hash: current.tokenHash,
        p_batch_id: batchId,
        p_rows: rows,
      });
      return noStore(result);
    }

    const batchId = String(body.batchId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) return noStore({ error: "Lot RH invalide." }, 400);

    if (body.action === "commit") {
      const days = Math.max(1, Math.min(Number(body.days ?? 30) || 30, 90));
      const result = await authRpc<CommitResult>("kpi_rh_batch_commit_step_admin", {
        p_session_hash: current.tokenHash,
        p_batch_id: batchId,
        p_days: days,
      });
      return noStore(result);
    }

    let result: CommitResult = {};
    for (let step = 0; step < 60; step++) {
      result = await authRpc<CommitResult>("kpi_rh_batch_commit_step_admin", {
        p_session_hash: current.tokenHash,
        p_batch_id: batchId,
        p_days: 30,
      });
      if (result.imported) return noStore(result);
      if (Number(result.remainingRows ?? 0) <= 0) break;
    }

    return noStore({
      error: "La finalisation RH n’est pas terminée. Relance l’import : le lot est conservé et reprendra sans perdre les blocs reçus.",
      ...result,
    }, 409);
  } catch (error) {
    return noStore({
      error: error instanceof Error ? `Import RH impossible : ${error.message}` : "Import RH impossible.",
    }, 500);
  }
}
