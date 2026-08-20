import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { bonusRpc } from "../../lib/bonus-rpc";
import { buildProrationContext, type BonusDetailForProration, type ProrationRulesPayload } from "../../lib/bonus-proration";

export const dynamic = "force-dynamic";

function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Opération impossible.";
  const forbidden = /requis|autorisé|périmètre|seul|hors périmètre/i.test(message);
  return NextResponse.json({ error: message }, { status: forbidden ? 403 : status, headers: { "Cache-Control": "no-store" } });
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).filter(key => object[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value) ?? "null";
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function enrichProration(tokenHash:string,detail:Record<string,unknown>){
  try{
    const typed=detail as unknown as BonusDetailForProration;
    const rules=await bonusRpc<ProrationRulesPayload>("kpi_bonus_proration_rules_read",{p_session_hash:tokenHash,p_workflow_id:typed.workflow.id});
    const context=buildProrationContext(typed,rules);
    const map=new Map(context.components.map(item=>[item.employeeKey,item]));
    const sourceComponents=Array.isArray((detail as {components?:unknown[]}).components)?(detail as {components:Record<string,unknown>[]}).components:[];
    const components=sourceComponents.map(component=>{
      const employeeKey=typeof component.employeeKey==="string"?component.employeeKey:null;
      const p=employeeKey?map.get(employeeKey):null;
      if(!p)return component;
      const sourcePayload=typeof component.sourcePayload==="object"&&component.sourcePayload?component.sourcePayload as Record<string,unknown>:{};
      return {...component,
        individualAmountEur:p.individualAfterEur,
        collectiveProration:p.collectiveFactor,
        totalAmountEur:p.totalAfterEur,
        sourcePayload:{...sourcePayload,proration:{
          source:p.sourceSummary,
          individualFactor:p.individualFactor,
          collectiveFactor:p.collectiveFactor,
          individualAmountBeforeEur:p.individualBeforeEur,
          collectiveAmountBeforeEur:p.collectiveBeforeEur,
          totalAmountBeforeEur:p.totalBeforeEur,
          totalImpactEur:p.totalImpactEur,
          eventCount:p.events.length,
          calculatedAt:context.calculatedAt,
        }}
      };
    });
    return {...detail,components,proration:{calculatedAt:context.calculatedAt,workingDays:context.workingDays,workingDaysSource:context.workingDaysSource,rulesCount:context.rules.length,source:context.sources?.calculation??"Moteur KPI CRVO"}};
  }catch(error){
    console.error("monthly_bonus_proration_enrichment_fallback",error);
    return detail;
  }
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");
    if(workflowId){
      const detail=await bonusRpc<Record<string, unknown>>("kpi_bonus_get_workflow", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
      return NextResponse.json(await enrichProration(current.tokenHash,detail), { headers: { "Cache-Control": "no-store" } });
    }
    const result=await bonusRpc<Record<string, unknown>>("kpi_bonus_list_workflows", { p_session_hash: current.tokenHash });
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
      const opened = await bonusRpc<Record<string, unknown>>("kpi_bonus_open_workflow", { p_session_hash: current.tokenHash, p_month: `${month}-01` });
      const workflowId = String(opened.workflowId ?? "");
      if (workflowId) await bonusRpc("kpi_bonus_refresh_hours", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
      result = opened;
    } else if (action === "recalculate") {
      const workflowId = String(body.workflowId ?? "");
      await bonusRpc("kpi_bonus_refresh_hours", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
      result = await bonusRpc("kpi_bonus_recalculate_workflow", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
    } else if (action === "input") {
      const workflowId = String(body.workflowId ?? "");
      result = await bonusRpc("kpi_bonus_upsert_input", {
        p_session_hash: current.tokenHash,
        p_workflow_id: workflowId,
        p_scope_type: String(body.scopeType ?? "global"),
        p_scope_key: String(body.scopeKey ?? "*"),
        p_input_key: String(body.inputKey ?? ""),
        p_numeric: body.numericValue === "" || body.numericValue == null ? null : Number(body.numericValue),
        p_text: body.textValue == null ? null : String(body.textValue),
        p_comment: body.comment == null ? null : String(body.comment),
      });
      await bonusRpc("kpi_bonus_refresh_hours", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
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
      const workflowId = String(body.workflowId ?? "");
      if (!workflowId) throw new Error("Workflow manquant.");

      // Closing is deliberately sequenced. Every stage is server-side and the DB closing
      // function refuses a missing/stale/mismatched evidence freeze.
      await bonusRpc("kpi_bonus_refresh_hours", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
      await bonusRpc("kpi_bonus_recalculate_workflow", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
      await bonusRpc("kpi_bonus_prepare_closure", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });

      const [detail, rules] = await Promise.all([
        bonusRpc<BonusDetailForProration>("kpi_bonus_get_workflow", { p_session_hash: current.tokenHash, p_workflow_id: workflowId }),
        bonusRpc<ProrationRulesPayload>("kpi_bonus_proration_rules_read", { p_session_hash: current.tokenHash, p_workflow_id: workflowId }),
      ]);
      const context = buildProrationContext(detail, rules);
      const prorationHash = await sha256Text(stableStringify(context));

      await bonusRpc("kpi_bonus_proration_freeze_workflow", {
        p_session_hash: current.tokenHash,
        p_workflow_id: workflowId,
        p_context: context,
        p_hash: prorationHash,
      });
      result = await bonusRpc("kpi_bonus_close_workflow", { p_session_hash: current.tokenHash, p_workflow_id: workflowId });
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
