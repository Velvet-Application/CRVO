import { spawn } from "node:child_process";
import { open, unlink } from "node:fs/promises";

const intervalMs = Math.max(60_000, Number(process.env.KPI_WATCH_INTERVAL_MS || 120_000));
const cycleTimeoutMs = Math.max(60_000, Number(process.env.KPI_WATCH_CYCLE_TIMEOUT_MS || 240_000));
const healthUrl = process.env.KPI_HEALTH_URL || "https://kpi-crvo.cyril-gay.workers.dev/api/health";
const lockPath = process.env.KPI_WATCH_LOCK || "/tmp/kpi-crvo-ftp-watcher.lock";
let stopping = false;
let lockHandle;

function log(event, details = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), service: "kpi-crvo-ftp-watcher", event, ...details })}\n`);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runNode(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit", env: process.env });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      reject(new Error(`${script} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${script} failed code=${code ?? "null"} signal=${signal ?? "none"}`));
    });
  });
}

async function verifyHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${healthUrl}${healthUrl.includes("?") ? "&" : "?"}_=${Date.now()}`, {
      headers: { "Cache-Control": "no-cache" }, signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    const age = Number(payload?.ftp?.syncAgeMinutes ?? Infinity);
    const ok = response.ok && payload?.dataReady === true && Number.isFinite(age) && age <= 15 && payload?.trustLevel !== "red";
    if (!ok) throw new Error(`health=${response.status} trust=${payload?.trustLevel ?? "?"} ftpAge=${Number.isFinite(age) ? age : "?"}`);
    return { status: response.status, trust: payload.trustLevel, ftpAgeMinutes: age, sourceAgeMinutes: payload?.production?.sourceAgeMinutes ?? null };
  } finally { clearTimeout(timer); }
}

async function cycle() {
  const started = Date.now();
  await runNode(new URL("./index.mjs", import.meta.url).pathname, cycleTimeoutMs);
  await runNode(new URL("./factory-live-sync.mjs", import.meta.url).pathname, cycleTimeoutMs);
  const health = await verifyHealth();
  log("cycle_success", { durationMs: Date.now() - started, ...health });
}

async function acquireLock() {
  try {
    lockHandle = await open(lockPath, "wx");
    await lockHandle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
  } catch (error) {
    throw new Error(`A watcher is already running or lock is unavailable: ${lockPath} (${error instanceof Error ? error.message : "unknown"})`);
  }
}
async function releaseLock() {
  try { await lockHandle?.close(); } catch {}
  try { await unlink(lockPath); } catch {}
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; log("shutdown_requested", { signal }); });

await acquireLock();
log("watcher_started", { pid: process.pid, intervalMs, cycleTimeoutMs, healthUrl });
try {
  while (!stopping) {
    try { await cycle(); }
    catch (error) { log("cycle_failed", { message: error instanceof Error ? error.message : "unknown" }); }
    if (!stopping) await sleep(intervalMs);
  }
} finally {
  await releaseLock();
  log("watcher_stopped");
}
