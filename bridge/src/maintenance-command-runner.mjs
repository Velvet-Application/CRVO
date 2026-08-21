import crypto from "node:crypto";
import { spawn } from "node:child_process";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const ftpPassword = process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD;
const healthUrl = process.env.KPI_HEALTH_URL || "https://kpi-crvo.cyril-gay.workers.dev/api/health";
const gatewayUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/kpi-maintenance-gateway` : "";
const gatewayToken = ftpPassword ? crypto.createHash("sha256").update(`kpi-crvo-ftp-bridge:v1:${ftpPassword}`).digest("hex") : "";
const timeoutMs = Math.max(60_000, Number(process.env.KPI_MAINTENANCE_TIMEOUT_MS || 300_000));

if (!gatewayUrl || !gatewayToken) throw new Error("SUPABASE_URL and FTP_PASSWORD are required for the maintenance runner.");

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), service: "kpi-maintenance-runner", event, ...details })}\n`);
}

async function gateway(action, body = {}) {
  const response = await fetch(`${gatewayUrl}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kpi-bridge-token": gatewayToken },
    body: JSON.stringify({ runner: "github-actions", appVersion: "maintenance-runner-v1", ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Maintenance gateway ${response.status}: ${payload.error ?? "unknown"}`);
  return payload;
}

async function runNode(script) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, [new URL(script, import.meta.url).pathname], { stdio: "inherit", env: process.env });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      reject(new Error(`${script} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ script, durationMs: Date.now() - started });
      else reject(new Error(`${script} failed code=${code ?? "null"} signal=${signal ?? "none"}`));
    });
  });
}

async function readHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${healthUrl}${healthUrl.includes("?") ? "&" : "?"}_=${Date.now()}`, { headers: { "Cache-Control": "no-cache" }, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { responseOk: response.ok, status: response.status, payload };
  } finally { clearTimeout(timer); }
}

async function perform(action) {
  const steps = [];
  if (action === "refresh_factory") {
    steps.push(await runNode("./factory-live-sync.mjs"));
  } else if (action === "test_ftp") {
    steps.push(await runNode("./index.mjs"));
  } else if (["refresh_ftp", "restart_bridge", "refresh_all_feeds", "rebuild_kpi"].includes(action)) {
    steps.push(await runNode("./index.mjs"));
    steps.push(await runNode("./factory-live-sync.mjs"));
  } else {
    throw new Error(`Unsupported bridge maintenance action: ${action}`);
  }
  const health = await readHealth().catch(error => ({ responseOk: false, status: 0, payload: { error: error instanceof Error ? error.message : "health_failed" } }));
  return {
    action,
    steps,
    healthStatus: health.status,
    healthOk: health.responseOk,
    trustLevel: health.payload?.trustLevel ?? null,
    dataReady: health.payload?.dataReady ?? null,
    ftpAgeMinutes: health.payload?.ftp?.syncAgeMinutes ?? null,
    sourceAgeMinutes: health.payload?.production?.sourceAgeMinutes ?? null,
  };
}

async function processCommands() {
  let processed = 0;
  for (let index = 0; index < 3; index += 1) {
    const claimed = await gateway("bridge-claim");
    const command = claimed.command;
    if (!command) break;
    processed += 1;
    log("command_claimed", { commandId: command.id, targetKey: command.target_key, action: command.action });
    try {
      const started = Date.now();
      const result = await perform(command.action);
      await gateway("bridge-result", { commandId: command.id, targetKey: command.target_key, ok: true, result: { ...result, durationMs: Date.now() - started } });
      log("command_success", { commandId: command.id, action: command.action, durationMs: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      await gateway("bridge-result", { commandId: command.id, targetKey: command.target_key, ok: false, result: {}, error: message }).catch(() => null);
      log("command_failed", { commandId: command.id, action: command.action, message });
    }
  }
  log("runner_finished", { processed });
}

await processCommands();
