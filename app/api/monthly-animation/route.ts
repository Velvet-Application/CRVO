import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { bonusRpc } from "../../lib/bonus-rpc";

export const dynamic = "force-dynamic";

function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Opération impossible.";
  const forbidden = /requis|autorisé|périmètre|seul|hors périmètre/i.test(message);
  return NextResponse.json({ error: message }, { status: forbidden ? 403 : status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");
    const result = workflowId
      ? await bonusRpc<Record<string, unknown>>("kpi_bonus_get_workflow", { p_session_hash: current.tokenHash, p_workflow_id: workflowId })
      : await bonusRpc<Record<string, unknown>>("kpi_bonus_list_workflows", { p_session_hash: current.tokenHash });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  try {
    let result: unknown;
    if (action === "open") {
      const month = String(body.month ?? "");
      if (!/^20\d{2}-\d{2}$/.test(month)) throw new Error("Mois invalide.");
      result = await bonusRpc("kpi_bonus_open_workflow", { p_session_hash: current.tokenHash, p_month: `${month}-01` });
    } else if (action === "recalculate") {
      result = await bonusRpc("kpi_bonus_recalculate_workflow", { p_session_hash: current.tokenHash, p_workflow_id: String(body.workflowId ?? "") });
    } else if (action === "input") {
      result = await bonusRpc("kpi_bonus_upsert_input", {
        p_session_hash: current.tokenHash,
        p_workflow_id: String(body.workflowId ?? ""),
        p_scope_type: String(body.scopeType ?? "global"),
        p_scope_key: String(body.scopeKey ?? "*"),
        p_input_key: String(body.inputKey ?? ""),
        p_numeric: body.numericValue === "" || body.numericValue == null ? null : Number(body.numericValue),
        p_text: body.textValue == null ? null : String(body.textValue),
        p_comment: body.comment == null ? null : String(body.comment),
      });
    } else if (action === "validate") {
      const tier = Number(body.tier);
      if (!Number.isInteger(tier) || tier < 0 || tier > 5) throw new Error("Palier invalide.");
      result = await bonusRpc("kpi_bonus_validate_component", {
        p_session_hash: current.tokenHash,
        p_component_id: String(body.componentId ?? ""),
        p_level: String(body.level ?? ""),
        p_tier: tier,
        p_comment: body.comment == null ? null : String(body.comment),
      });
    } else if (action === "audit") {
      result = await bonusRpc("kpi_bonus_run_audit", { p_session_hash: current.tokenHash, p_workflow_id: String(body.workflowId ?? "") });
    } else if (action === "close") {
      result = await bonusRpc("kpi_bonus_close_workflow", { p_session_hash: current.tokenHash, p_workflow_id: String(body.workflowId ?? "") });
    } else if (action === "log-export") {
      const rawType = String(body.exportType ?? "");
      const exportType = rawType === "pdf" || rawType === "employee_pdf" ? "employee_pdf" : rawType === "xlsx" || rawType === "payroll_xlsx" ? "payroll_xlsx" : rawType;
      result = await bonusRpc("kpi_bonus_record_export", {
        p_session_hash: current.tokenHash,
        p_workflow_id: String(body.workflowId ?? ""),
        p_export_type: exportType,
        p_employee_key: body.employeeKey ? String(body.employeeKey) : null,
        p_sha256: body.sha256 ? String(body.sha256) : null,
        p_metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      });
    } else {
      return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}
