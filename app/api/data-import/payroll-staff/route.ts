import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const MAX_ROWS = 2000;

type PayrollRow = {
  matricule?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  service?: string | null;
  teamCode?: string | null;
  jobTitle?: string | null;
  entryDate?: string | null;
  exitDate?: string | null;
  status?: string | null;
};

type Body = {
  filename?: string;
  sha256?: string;
  rows?: PayrollRow[];
};

type ImportResult = {
  ok?: boolean;
  runId?: string;
  rows?: number;
  active?: number;
  exits?: number;
  bonusConfigured?: number;
  bonusPending?: number;
  historyPreserved?: boolean;
  error?: string;
};

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const current = await currentSession();
    const canImport = Boolean(current && (
      current.session.role === "admin" ||
      current.session.page_permissions?.includes("*") ||
      current.session.page_permissions?.includes("data_rh")
    ));
    if (!current || !canImport) return noStore({ error: "Droit Data RH requis." }, 403);

    const body = await request.json().catch(() => null) as Body | null;
    const filename = String(body?.filename ?? "").trim();
    const sha256 = String(body?.sha256 ?? "").trim().toLowerCase();
    const rows = Array.isArray(body?.rows) ? body!.rows : [];

    if (!filename) return noStore({ error: "Nom du fichier de paie manquant." }, 400);
    if (!/^[0-9a-f]{64}$/.test(sha256)) return noStore({ error: "Empreinte SHA-256 du fichier invalide." }, 400);
    if (!rows.length || rows.length > MAX_ROWS) return noStore({ error: `Import limité à 1–${MAX_ROWS} collaborateurs.` }, 400);

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const fullName = String(row.fullName ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`).trim();
      if (!fullName) return noStore({ error: `Ligne ${index + 1} : nom/prénom manquant.` }, 400);
      if (row.entryDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.entryDate))) return noStore({ error: `Ligne ${index + 1} : date d'entrée invalide.` }, 400);
      if (row.exitDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.exitDate))) return noStore({ error: `Ligne ${index + 1} : date de sortie invalide.` }, 400);
    }

    const result = await authRpc<ImportResult>("kpi_payroll_staff_import", {
      p_session_hash: current.tokenHash,
      p_source_filename: filename,
      p_source_sha256: sha256,
      p_rows: rows,
    });

    if (!result?.ok) return noStore({ error: result?.error || "Import paie refusé.", ...result }, 409);
    return noStore(result);
  } catch (error) {
    return noStore({
      error: error instanceof Error ? `Import paie impossible : ${error.message}` : "Import paie impossible.",
    }, 500);
  }
}
