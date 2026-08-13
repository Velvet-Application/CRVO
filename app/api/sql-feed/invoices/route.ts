import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../../supabase-rest";
import { getSqlFeedIdentity } from "../../../sql-feed-auth";

export const dynamic = "force-dynamic";

const SOURCE = "SQL Reporting factures CRVO";

type InvoiceRow = {
  invoice_date: string;
  invoice_number: string;
  registration?: string | null;
  work_order?: string | null;
  client?: string | null;
  revenue_total?: number | null;
  labor_revenue?: number | null;
  parts_revenue?: number | null;
  other_revenue?: number | null;
  vin?: string | null;
  labor_hours?: number | null;
  metadata?: Record<string, unknown>;
};

type Payload = { replace?: boolean; rows?: InvoiceRow[] };

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

function text(value: unknown, max = 180) {
  const v = String(value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

function num(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const identity = await getSqlFeedIdentity(request);
  if (!identity) return NextResponse.json({ error: "Accès import SQL refusé." }, { status: 401 });
  const cfg = env();
  if (!cfg) return NextResponse.json({ error: "Supabase n’est pas configuré." }, { status: 503 });

  const body = await request.json() as Payload;
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 1000) return NextResponse.json({ error: "Lot factures invalide (1 à 1000 factures)." }, { status: 400 });

  if (body.replace) {
    const remove = await fetch(`${cfg.url}/rest/v1/kpi_invoice_facts?source_name=eq.${encodeURIComponent(SOURCE)}`, {
      method: "DELETE",
      headers: supabaseRestHeaders(cfg.key, { Prefer: "return=minimal" }),
    });
    if (!remove.ok) return NextResponse.json({ error: `Nettoyage factures impossible (${remove.status}).` }, { status: 502 });
  }

  const rows = body.rows.map((row) => ({
    invoice_date: row.invoice_date,
    invoice_number: text(row.invoice_number, 64),
    registration: text(row.registration, 32),
    work_order: text(row.work_order, 64),
    client: text(row.client, 80),
    revenue_total: num(row.revenue_total),
    labor_revenue: num(row.labor_revenue),
    parts_revenue: num(row.parts_revenue),
    other_revenue: num(row.other_revenue),
    vin: text(row.vin, 40),
    labor_hours: num(row.labor_hours),
    source_name: SOURCE,
    metadata: { ...(row.metadata ?? {}), imported_by: identity.actor, import_channel: identity.source },
    imported_at: new Date().toISOString(),
  })).filter((row) => /^20\d{2}-\d{2}-\d{2}$/.test(String(row.invoice_date)) && row.invoice_number);

  const save = await fetch(`${cfg.url}/rest/v1/kpi_invoice_facts?on_conflict=source_name,invoice_number`, {
    method: "POST",
    headers: supabaseRestHeaders(cfg.key, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!save.ok) return NextResponse.json({ error: `Enregistrement factures impossible (${save.status}): ${await save.text()}` }, { status: 502 });

  const identities = rows.map((row) => ({ work_order: row.work_order, registration: row.registration, vin: row.vin, sources: [SOURCE], metadata: { last_invoice_date: row.invoice_date } })).filter((row) => row.work_order);
  if (identities.length) {
    await fetch(`${cfg.url}/rest/v1/rpc/kpi_upsert_vehicle_identities`, {
      method: "POST",
      headers: supabaseRestHeaders(cfg.key, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ payload: identities }),
    }).catch(() => undefined);
  }

  return NextResponse.json({ saved: rows.length, source: SOURCE });
}
