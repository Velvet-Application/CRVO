import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const EXPECTED_BRIDGE_TOKEN_SHA256 = "23354751dd7436e2115b97fe34b9192e75d0e7bc4daab1b0a4acd9179bd7c410";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRIDGE_TARGETS = ["source.ftp", "bridge.ftp", "data.factory", "data.park", "module.client_dashboard"];
const BRIDGE_ACTIONS = ["test_ftp", "refresh_ftp", "restart_bridge", "refresh_factory", "refresh_all_feeds", "rebuild_kpi"];
const GUARDIAN_ACTIONS = ["reload_page", "clear_cache", "restart_browser", "restart_guardian", "reboot_device"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function serverClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const modernSecretKey = secretKeys ? (JSON.parse(secretKeys) as Record<string, string>).default : undefined;
  const serverKey = modernSecretKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serverKey) return null;
  return createClient(supabaseUrl, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function bridgeAuthorized(request: Request) {
  const token = request.headers.get("x-kpi-bridge-token") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(token)) return false;
  return constantTimeEqual(await sha256Hex(token.toLowerCase()), EXPECTED_BRIDGE_TOKEN_SHA256);
}
async function guardianAuthorized(supabase: ReturnType<typeof createClient>, request: Request, targetKey: string) {
  if (!/^screen\.(atelier|direction)$/.test(targetKey)) return false;
  const token = request.headers.get("x-kpi-guardian-token") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(token)) return false;
  const { data } = await supabase.from("kpi_maintenance_targets").select("agent_token_hash,enabled").eq("target_key", targetKey).maybeSingle();
  if (!data?.enabled || !data.agent_token_hash) return false;
  return constantTimeEqual(await sha256Hex(token.toLowerCase()), String(data.agent_token_hash).toLowerCase());
}
async function heartbeat(supabase: ReturnType<typeof createClient>, targetKey: string, details: Record<string, unknown> = {}, appVersion?: string | null) {
  const now = new Date().toISOString();
  await supabase.from("kpi_maintenance_heartbeats").upsert({ target_key: targetKey, heartbeat_at: now, status: "online", app_version: appVersion ?? null, details, updated_at: now }, { onConflict: "target_key" });
}
async function claimOldest(supabase: ReturnType<typeof createClient>, targetKeys: string[], actions: string[]) {
  const { data: candidate, error } = await supabase.from("kpi_maintenance_commands").select("id,target_key,action,request,requested_at").eq("status", "queued").in("target_key", targetKeys).in("action", actions).order("requested_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (!candidate) return null;
  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase.from("kpi_maintenance_commands").update({ status: "running", started_at: startedAt }).eq("id", candidate.id).eq("status", "queued").select("id,target_key,action,request,requested_at,started_at").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;
  await supabase.from("kpi_maintenance_events").insert({ target_key: claimed.target_key, command_id: claimed.id, event_type: "command_started", severity: "info", message: "Action de maintenance démarrée.", details: { action: claimed.action } });
  return claimed;
}
async function finishCommand(supabase: ReturnType<typeof createClient>, commandId: string, targetKey: string, ok: boolean, result: Record<string, unknown>, errorText?: string | null) {
  if (!UUID.test(commandId)) throw new Error("Commande invalide.");
  const status = ok ? "success" : "failed";
  const finishedAt = new Date().toISOString();
  const { error } = await supabase.from("kpi_maintenance_commands").update({ status, finished_at: finishedAt, result: result ?? {}, error: errorText ?? null }).eq("id", commandId).eq("target_key", targetKey).in("status", ["running", "queued"]);
  if (error) throw error;
  await supabase.from("kpi_maintenance_events").insert({ target_key: targetKey, command_id: commandId, event_type: ok ? "command_success" : "command_failed", severity: ok ? "info" : "critical", message: ok ? "Action de maintenance terminée avec succès." : "Action de maintenance en échec.", details: { ...result, error: errorText ?? null } });
}

Deno.serve(async (request: Request) => {
  const supabase = serverClient();
  if (!supabase) return json({ error: "Configuration serveur indisponible." }, 503);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "";
  try {
    if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;

    if (action.startsWith("bridge-")) {
      if (!await bridgeAuthorized(request)) return json({ error: "Accès bridge refusé." }, 401);
      await heartbeat(supabase, "bridge.ftp", { runner: String(body.runner ?? "github-actions"), pid: body.pid ?? null }, String(body.appVersion ?? "bridge-v1"));
      if (action === "bridge-claim") return json({ ok: true, command: await claimOldest(supabase, BRIDGE_TARGETS, BRIDGE_ACTIONS) });
      if (action === "bridge-result") {
        const commandId = String(body.commandId ?? ""); const targetKey = String(body.targetKey ?? "");
        if (!BRIDGE_TARGETS.includes(targetKey)) return json({ error: "Cible bridge invalide." }, 400);
        await finishCommand(supabase, commandId, targetKey, body.ok === true, (body.result && typeof body.result === "object" ? body.result : {}) as Record<string, unknown>, body.error ? String(body.error).slice(0, 2000) : null);
        return json({ ok: true });
      }
      if (action === "bridge-event") {
        const severity = ["info", "warning", "critical"].includes(String(body.severity)) ? String(body.severity) : "info";
        const targetKey = BRIDGE_TARGETS.includes(String(body.targetKey)) ? String(body.targetKey) : "bridge.ftp";
        await supabase.from("kpi_maintenance_events").insert({ target_key: targetKey, event_type: String(body.eventType ?? "bridge_event").slice(0, 80), severity, message: String(body.message ?? "Événement bridge").slice(0, 1000), details: body.details && typeof body.details === "object" ? body.details : {} });
        return json({ ok: true });
      }
      return json({ error: "Action bridge inconnue." }, 404);
    }

    if (action.startsWith("guardian-")) {
      const targetKey = String(body.targetKey ?? "");
      if (!await guardianAuthorized(supabase, request, targetKey)) return json({ error: "Accès Guardian refusé." }, 401);
      const details = body.details && typeof body.details === "object" ? body.details as Record<string, unknown> : {};
      await heartbeat(supabase, targetKey, details, body.appVersion ? String(body.appVersion).slice(0, 120) : "browser-guardian");
      if (action === "guardian-heartbeat") return json({ ok: true });
      if (action === "guardian-claim") return json({ ok: true, command: await claimOldest(supabase, [targetKey], GUARDIAN_ACTIONS) });
      if (action === "guardian-result") {
        const commandId = String(body.commandId ?? "");
        await finishCommand(supabase, commandId, targetKey, body.ok === true, (body.result && typeof body.result === "object" ? body.result : {}) as Record<string, unknown>, body.error ? String(body.error).slice(0, 2000) : null);
        return json({ ok: true });
      }
      return json({ error: "Action Guardian inconnue." }, 404);
    }

    return json({ error: "Action inconnue." }, 404);
  } catch (error) {
    console.error(JSON.stringify({ event: "kpi_maintenance_gateway_failed", action, message: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "La passerelle de maintenance a rencontré une erreur." }, 500);
  }
});
