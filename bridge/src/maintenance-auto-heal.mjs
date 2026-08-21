import crypto from "node:crypto";
import { spawn } from "node:child_process";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const ftpPassword = process.env.FTP_PASSWORD ?? process.env.SFTP_PASSWORD;
const healthUrl = process.env.KPI_HEALTH_URL || "https://kpi-crvo.cyril-gay.workers.dev/api/health";
const gatewayUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/kpi-maintenance-gateway` : "";
const gatewayToken = ftpPassword ? crypto.createHash("sha256").update(`kpi-crvo-ftp-bridge:v1:${ftpPassword}`).digest("hex") : "";
const timeoutMs = 300_000;

if (!gatewayUrl || !gatewayToken) throw new Error("SUPABASE_URL and FTP_PASSWORD are required for auto-heal.");

function log(event, details = {}) { process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), service: "kpi-maintenance-auto-heal", event, ...details })}\n`); }

async function gateway(action, body = {}) {
  const response = await fetch(`${gatewayUrl}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-kpi-bridge-token": gatewayToken },
    body: JSON.stringify({ runner: "github-actions-auto-heal", appVersion: "auto-heal-v1", ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Maintenance gateway ${response.status}: ${payload.error ?? "unknown"}`);
  return payload;
}

async function readHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${healthUrl}${healthUrl.includes("?") ? "&" : "?"}_=${Date.now()}`, { headers: { "Cache-Control": "no-cache" }, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    const ftpAge = Number(payload?.ftp?.syncAgeMinutes ?? Infinity);
    const sourceAge = Number(payload?.production?.sourceAgeMinutes ?? Infinity);
    const abnormal = !response.ok || payload?.dataReady !== true || payload?.trustLevel === "red" || !Number.isFinite(ftpAge) || ftpAge > 80 || !Number.isFinite(sourceAge) || sourceAge > 145;
    return { abnormal, status: response.status, trustLevel: payload?.trustLevel ?? null, dataReady: payload?.dataReady ?? false, ftpAgeMinutes: Number.isFinite(ftpAge) ? ftpAge : null, sourceAgeMinutes: Number.isFinite(sourceAge) ? sourceAge : null };
  } catch (error) {
    return { abnormal: true, status: 0, trustLevel: "red", dataReady: false, ftpAgeMinutes: null, sourceAgeMinutes: null, error: error instanceof Error ? error.message : "unknown" };
  } finally { clearTimeout(timer); }
}

async function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL(script, import.meta.url).pathname], { stdio: "inherit", env: process.env });
    const timer = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 5_000).unref(); reject(new Error(`${script} timed out`)); }, timeoutMs);
    timer.unref();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => { clearTimeout(timer); code === 0 ? resolve(null) : reject(new Error(`${script} failed code=${code ?? "null"} signal=${signal ?? "none"}`)); });
  });
}

const before = await readHealth();
if (!before.abnormal) {
  log("healthy_no_action", before);
  process.exit(0);
}

await gateway("bridge-event", { targetKey: "bridge.ftp", eventType: "auto_repair_attempt", severity: "warning", message: "Auto-réparation déclenchée après détection d'une anomalie persistante.", details: { before } }).catch(() => null);
log("auto_repair_started", before);

try {
  await runNode("./index.mjs");
  await runNode("./factory-live-sync.mjs");
  const after = await readHealth();
  if (after.abnormal) {
    await gateway("bridge-event", { targetKey: "bridge.ftp", eventType: "auto_repair_failed", severity: "critical", message: "Auto-réparation terminée mais l'anomalie persiste.", details: { before, after } }).catch(() => null);
    log("auto_repair_failed", { before, after });
    process.exit(1);
  }
  await gateway("bridge-event", { targetKey: "bridge.ftp", eventType: "auto_repair_success", severity: "info", message: "Auto-réparation réussie, le système est revenu au vert.", details: { before, after } }).catch(() => null);
  log("auto_repair_success", { before, after });
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown";
  await gateway("bridge-event", { targetKey: "bridge.ftp", eventType: "auto_repair_failed", severity: "critical", message: "Auto-réparation en échec technique.", details: { before, error: message } }).catch(() => null);
  log("auto_repair_exception", { message });
  process.exit(1);
}
