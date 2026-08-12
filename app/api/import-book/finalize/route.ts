import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getImportIdentity } from "../../../import-auth";

export const dynamic = "force-dynamic";

type Metric = { key: string; label: string; value: number };
type FinalizeRequest = { batchId?: string; metrics?: Metric[]; archiveStored?: boolean };

export async function POST(request: Request) {
  const user = await getImportIdentity(request);
  if (!user) return NextResponse.json({ error: "Déverrouille l’import sécurisé avant de continuer.", authRequired: true }, { status: 401 });
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return NextResponse.json({ error: "La base de données n’est pas configurée." }, { status: 503 });

  const body = await request.json() as FinalizeRequest;
  const batchId = String(body.batchId ?? "");
  const metrics = Array.isArray(body.metrics)
    ? body.metrics.filter((metric) => /^[a-z0-9_]{2,64}$/.test(metric.key) && typeof metric.label === "string" && Number.isFinite(metric.value)).slice(0, 50)
    : [];
  if (!/^[0-9a-f-]{36}$/.test(batchId) || metrics.length < 12) return NextResponse.json({ error: "Les indicateurs du book sont incomplets." }, { status: 400 });

  const supabase = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: batch, error: batchError } = await supabase
    .from("kpi_import_batches")
    .select("id,archive_object_path,status,metadata")
    .eq("id", batchId)
    .single();
  if (batchError || !batch || batch.status !== "received") return NextResponse.json({ error: "Cet import n’est plus disponible." }, { status: 409 });

  let archiveStored = false;
  if (body.archiveStored !== false && batch.archive_object_path) {
    const folder = batch.archive_object_path.split("/")[0];
    const filename = batch.archive_object_path.split("/").at(-1);
    const { data: objects, error: listError } = await supabase.storage.from("kpi-raw-archive").list(folder, { search: filename, limit: 1 });
    archiveStored = !listError && Boolean(objects?.length);
  }

  const rows = metrics.map((metric) => ({
    import_batch_id: batchId,
    metric_key: metric.key,
    metric_label: metric.label.slice(0, 120),
    metric_value: metric.value,
    unit: "count",
    dimensions: {},
  }));
  const { error: metricError } = await supabase.from("kpi_snapshot_metrics").insert(rows);
  if (metricError) return NextResponse.json({ error: "Les indicateurs n’ont pas pu être enregistrés." }, { status: 502 });

  const metadata = {
    ...(batch.metadata && typeof batch.metadata === "object" ? batch.metadata : {}),
    finalized_by: user.email,
    finalized_at: new Date().toISOString(),
    archive_warning: archiveStored ? null : "Original Excel non archivé ; KPI validés depuis l’analyse locale du fichier.",
  };
  const { error: updateError } = await supabase.from("kpi_import_batches").update({
    status: "verified",
    archive_status: archiveStored ? "stored" : "missing",
    row_count: rows.length,
    metadata,
  }).eq("id", batchId);
  if (updateError) return NextResponse.json({ error: "Les KPI sont enregistrés mais la validation de l’import a échoué." }, { status: 502 });

  return NextResponse.json({ ok: true, metrics: rows.length, archiveStored });
}
