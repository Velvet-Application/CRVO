import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/crvo-auth";
import { bonusRpc } from "../../../lib/bonus-rpc";
import { buildProrationContext, type BonusDetailForProration, type ProrationMode, type ProrationRulesPayload } from "../../../lib/bonus-proration";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Opération de proratisation impossible.";
  const forbidden = /réservé|requis|autorisé|périmètre|clôturé/i.test(message);
  return json({ error: message }, forbidden ? 403 : status);
}

async function workflowContext(tokenHash: string, workflowId: string) {
  const [detail, rules] = await Promise.all([
    bonusRpc<BonusDetailForProration>("kpi_bonus_get_workflow", { p_session_hash: tokenHash, p_workflow_id: workflowId }),
    bonusRpc<ProrationRulesPayload>("kpi_bonus_proration_rules_read", { p_session_hash: tokenHash, p_workflow_id: workflowId }),
  ]);
  return buildProrationContext(detail, rules);
}

async function defaultContext(tokenHash: string) {
  const rules = await bonusRpc<ProrationRulesPayload>("kpi_bonus_proration_defaults_read", { p_session_hash: tokenHash });
  return {
    ...rules,
    calculatedAt: new Date().toISOString(),
    workingDays: 0,
    workingDaysSource: "Défini dans chaque workflow mensuel à son ouverture",
    components: [],
  };
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session CRVO requise." }, 401);
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const workflowId = url.searchParams.get("workflowId");
  try {
    if (scope === "defaults" || workflowId === "__defaults__") return json(await defaultContext(current.tokenHash));
    if (!workflowId) return json({ error: "Workflow manquant." }, 400);
    return json(await workflowContext(current.tokenHash, workflowId));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session CRVO requise." }, 401);
  if (!(current.session.role === "admin" || current.session.access_profile === "hr")) {
    return json({ error: "Paramétrage réservé aux administrateurs et aux RH." }, 403);
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const workflowId = String(body.workflowId ?? "");
  const reasonCode = String(body.reasonCode ?? "");
  const individualMode = String(body.individualMode ?? "inherit") as ProrationMode;
  const collectiveMode = String(body.collectiveMode ?? "inherit") as ProrationMode;
  const individualThresholdDays = Number(body.individualThresholdDays ?? 0);
  const collectiveThresholdDays = Number(body.collectiveThresholdDays ?? 0);
  if (!workflowId || !reasonCode) return json({ error: "Workflow ou événement manquant." }, 400);
  try {
    if (workflowId === "__defaults__") {
      await bonusRpc("kpi_bonus_proration_default_rule_update", {
        p_session_hash: current.tokenHash,
        p_reason_code: reasonCode,
        p_individual_mode: individualMode,
        p_individual_threshold_days: individualThresholdDays,
        p_collective_mode: collectiveMode,
        p_collective_threshold_days: collectiveThresholdDays,
      });
      return json(await defaultContext(current.tokenHash));
    }
    await bonusRpc("kpi_bonus_proration_rule_update", {
      p_session_hash: current.tokenHash,
      p_workflow_id: workflowId,
      p_reason_code: reasonCode,
      p_individual_mode: individualMode,
      p_individual_threshold_days: individualThresholdDays,
      p_collective_mode: collectiveMode,
      p_collective_threshold_days: collectiveThresholdDays,
    });
    return json(await workflowContext(current.tokenHash, workflowId));
  } catch (error) {
    return fail(error);
  }
}
