import { NextResponse } from "next/server";
import { authRpc, currentSession, sha256Hex } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";
import { parseStaffDirectory } from "./staff-directory";

export const dynamic = "force-dynamic";

const IMPORT_GATEWAY = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-email-import-gateway";
const ACCEPTED = /\.(csv|xlsx|xls)$/i;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

async function enrichStaffDirectory(file:File){
  const supabaseUrl=process.env.SUPABASE_URL;
  const secretKey=process.env.SUPABASE_SECRET_KEY;
  if(!supabaseUrl||!secretKey)return {detected:0,bodyshop:0,warning:"Base CRVO non configurée pour l'annuaire RH."};
  const staff=await parseStaffDirectory(file);
  if(!staff.length)return {detected:0,bodyshop:0};
  const bodyshop=staff.filter(row=>row.team_code&&/(carross|t[oô]ler|body|fixline)/i.test(row.service??"")).length;
  for(let index=0;index<staff.length;index+=500){
    const response=await fetch(`${supabaseUrl}/rest/v1/kpi_rh_staff_dimension?on_conflict=employee_key`,{
      method:"POST",
      headers:supabaseRestHeaders(secretKey,{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"}),
      body:JSON.stringify(staff.slice(index,index+500)),
      cache:"no-store",
    });
    if(!response.ok)throw new Error(`Annuaire RH ${response.status}: ${await response.text()}`);
  }
  return {detected:staff.length,bodyshop};
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") {
    return NextResponse.json({ error: "Accès administrateur CRVO requis." }, { status: 401 });
  }

  const incoming = await request.formData();
  const value = incoming.get("file");
  const source = String(incoming.get("source") ?? "");
  if (!value || typeof value === "string" || typeof (value as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Sélectionne un fichier à importer." }, { status: 400 });
  }
  if (!["rh", "finance", "billed_time"].includes(source)) {
    return NextResponse.json({ error: "Type de données invalide." }, { status: 400 });
  }

  const file = value as File;
  if (!ACCEPTED.test(file.name)) return NextResponse.json({ error: "Format refusé. Utilise CSV, XLSX ou XLS." }, { status: 400 });
  if (!file.size || file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Le fichier dépasse la limite de 25 Mo." }, { status: 400 });

  const token = await sha256Hex(`crvo-direct-import:v1:${current.token}`);
  await authRpc<string>("kpi_set_email_gateway_token_admin", {
    p_session_hash: current.tokenHash,
    p_token_sha256: await sha256Hex(token),
  });

  const outbound = new FormData();
  outbound.set("file", file, file.name);
  outbound.set("source", source);
  outbound.set("sender", current.session.display_name || current.session.username);
  outbound.set("subject", "Import direct KPI CRVO");
  outbound.set("messageId", `direct-${Date.now()}-${crypto.randomUUID()}`);

  const response = await fetch(IMPORT_GATEWAY, {
    method: "POST",
    headers: { "x-crvo-ingest-token": token },
    body: outbound,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({ error: "Réponse d'import illisible." })) as Record<string,unknown>;

  if(response.ok&&(source==="rh"||source==="billed_time")){
    try{
      payload.staffDirectory=await enrichStaffDirectory(file);
    }catch(error){
      payload.staffDirectory={detected:0,bodyshop:0,warning:error instanceof Error?error.message:"Analyse de l'annuaire RH impossible."};
    }
  }

  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
