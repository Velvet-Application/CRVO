import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const BUCKET = "kpi-raw-archive";
const RETENTION_DAYS = 30;
const DATE_FOLDER = /^20\d{2}-\d{2}-\d{2}$/;
const HASH_PREFIX = /^[0-9a-f]{64}-/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function parisToday() {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function dayNumber(value: string) {
  const [y,m,d] = value.split("-").map(Number);
  return Math.floor(Date.UTC(y,m-1,d) / 86400000);
}
function serverClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const modern = secretKeys ? (JSON.parse(secretKeys) as Record<string,string>).default : undefined;
  const key = modern ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function listAll(supabase: ReturnType<typeof createClient>, folder: string) {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset, sortBy: { column: "created_at", order: "desc" } });
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
    offset += rows.length;
    if (offset > 10000) break;
  }
  return out;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  const supabase = serverClient();
  if (!supabase) return json({ error: "Configuration serveur indisponible." }, 503);

  const { data: run } = await supabase.from("kpi_retention_runs").insert({ run_kind: "storage" }).select("id").single();
  const runId = run?.id ?? null;
  try {
    const today = parisToday();
    const todayN = dayNumber(today);
    const root = await listAll(supabase, "");
    const folders = root.map((item) => String(item.name ?? "")).filter((name) => DATE_FOLDER.test(name));
    const removePaths: string[] = [];
    let estimatedBytes = 0;
    let keptObjects = 0;

    for (const folder of folders) {
      const folderN = dayNumber(folder);
      if (folderN >= todayN) continue;
      const objects = (await listAll(supabase, folder)).filter((item) => item?.id && item?.name);
      if (!objects.length) continue;

      if (folderN < todayN - RETENTION_DAYS) {
        for (const item of objects) {
          removePaths.push(`${folder}/${item.name}`);
          estimatedBytes += Number(item.metadata?.size ?? 0) || 0;
        }
        continue;
      }

      const grouped = new Map<string, any[]>();
      for (const item of objects) {
        const source = String(item.name).replace(HASH_PREFIX, "");
        const list = grouped.get(source) ?? [];
        list.push(item);
        grouped.set(source, list);
      }
      for (const list of grouped.values()) {
        list.sort((a,b) => String(b.created_at ?? b.updated_at ?? "").localeCompare(String(a.created_at ?? a.updated_at ?? "")));
        keptObjects += 1;
        for (const item of list.slice(1)) {
          removePaths.push(`${folder}/${item.name}`);
          estimatedBytes += Number(item.metadata?.size ?? 0) || 0;
        }
      }
    }

    let deleted = 0;
    for (let i = 0; i < removePaths.length; i += 100) {
      const chunk = removePaths.slice(i, i + 100);
      const { error } = await supabase.storage.from(BUCKET).remove(chunk);
      if (error) throw error;
      deleted += chunk.length;
      for (let j = 0; j < chunk.length; j += 50) {
        const paths = chunk.slice(j, j + 50);
        await supabase.from("kpi_import_batches").update({ archive_status: "missing" }).in("archive_object_path", paths);
      }
    }

    if (runId) await supabase.from("kpi_retention_runs").update({
      finished_at: new Date().toISOString(), status: "success", deleted_objects: deleted, deleted_bytes: estimatedBytes,
      details: { bucket: BUCKET, retentionDays: RETENTION_DAYS, dailyPolicy: "latest-per-source-per-day", keptObjects }
    }).eq("id", runId);

    return json({ ok: true, bucket: BUCKET, retentionDays: RETENTION_DAYS, deletedObjects: deleted, deletedBytes: estimatedBytes, keptObjects });
  } catch (error) {
    if (runId) await supabase.from("kpi_retention_runs").update({ finished_at: new Date().toISOString(), status: "failed", details: { error: error instanceof Error ? error.message : "unknown" } }).eq("id", runId);
    console.error(JSON.stringify({ event: "kpi_retention_cleanup_failed", message: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "Compactage Storage impossible." }, 500);
  }
});
