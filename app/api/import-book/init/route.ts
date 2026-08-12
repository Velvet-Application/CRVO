import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getImportIdentity } from "../../../import-auth";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 250 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^20\d{2}-\d{2}-\d{2}$/;

type ImportRequest = {
  filename?: string;
  byteSize?: number;
  sha256?: string;
  snapshotAt?: string;
  contentType?: string;
};

function safeFilename(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-140);
}

export async function POST(request: Request) {
  const user = await getImportIdentity(request);
  if (!user) return NextResponse.json({ error: "Déverrouille l’import sécurisé avant de continuer.", authRequired: true }, { status: 401 });

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return NextResponse.json({ error: "La base de données n’est pas configurée." }, { status: 503 });

  const body = await request.json() as ImportRequest;
  const filename = safeFilename(body.filename ?? "");
  const byteSize = Number(body.byteSize);
  const sha256 = String(body.sha256 ?? "").toLowerCase();
  const snapshotAt = String(body.snapshotAt ?? "");
  if (!filename || !/\.(xlsx|xls)$/i.test(filename)) return NextResponse.json({ error: "Seuls les books Excel .xlsx et .xls sont acceptés." }, { status: 400 });
  if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_FILE_SIZE) return NextResponse.json({ error: "Le fichier dépasse la limite de 250 Mo." }, { status: 400 });
  if (!SHA256.test(sha256) || !DATE.test(snapshotAt)) return NextResponse.json({ error: "Le fichier ou sa date n’a pas pu être validé." }, { status: 400 });

  const supabase = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: duplicate, error: duplicateError } = await supabase.from("kpi_import_batches").select("id,snapshot_at,original_filename,status").eq("sha256", sha256).maybeSingle();
  if (duplicateError) return NextResponse.json({ error: "Impossible de vérifier l’historique." }, { status: 502 });
  if (duplicate) return NextResponse.json({ duplicate: true, existing: duplicate }, { status: 409 });

  const { data: source, error: sourceError } = await supabase.from("kpi_data_sources").select("id").eq("kind", "manual").eq("is_enabled", true).limit(1).single();
  if (sourceError || !source) return NextResponse.json({ error: "La source d’import manuel n’est pas disponible." }, { status: 503 });

  const objectPath = `${snapshotAt}/${sha256}-${filename}`;
  const { data: signed, error: signedError } = await supabase.storage.from("kpi-raw-archive").createSignedUploadUrl(objectPath);
  if (signedError || !signed) return NextResponse.json({ error: "Impossible de préparer l’archivage du book." }, { status: 502 });

  const { data: batch, error: batchError } = await supabase.from("kpi_import_batches").insert({
    source_id: source.id,
    snapshot_at: snapshotAt,
    original_filename: filename,
    archive_object_path: objectPath,
    sha256,
    byte_size: byteSize,
    status: "received",
    archive_status: "pending",
    metadata: { uploaded_by: user.email, upload_channel: "dashboard", content_type: body.contentType ?? "application/octet-stream" },
  }).select("id").single();
  if (batchError || !batch) return NextResponse.json({ error: "Impossible de créer l’import." }, { status: 502 });

  return NextResponse.json({ batchId: batch.id, signedUrl: signed.signedUrl, path: signed.path, token: signed.token });
}
