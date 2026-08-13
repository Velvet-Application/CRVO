import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../../supabase-rest";
import { getSqlFeedIdentity } from "../../../sql-feed-auth";

export const dynamic = "force-dynamic";

const SOURCE = "SQL OR encours CRVO";

type WorkloadRow = {
  snapshot_at: string;
  registration?: string | null;
  work_order: string;
  client?: string | null;
  sector_key: string;
  sector_label: string;
  status?: string | null;
  age_days?: number | null;
  remaining_minutes?: number | null;
  booked_minutes?: number | null;
  estimated_total_minutes?: number | null;
  vin?: string | null;
  opened_at?: string | null;
  potential_revenue_total?: number | null;
  potential_labor_revenue?: number | null;
  potential_parts_revenue?: number | null;
  potential_other_revenue?: number | null;
  primary_activity?: string | null;
  metadata?: Record<string, unknown>;
};

type Payload = { snapshotAt?: string; replace?: boolean; rows?: WorkloadRow[] };

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

function cleanText(value: unknown, max = 180) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
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
  const snapshotAt = String(body.snapshotAt ?? "");
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(snapshotAt)) return NextResponse.json({ error: "Date d’encours invalide." }, { status: 400 });
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 800) return NextResponse.json({ error: "Lot encours invalide (1 à 800 lignes)." }, { status: 400 });

  if (body.replace) {
    const remove = await fetch(`${cfg.url}/rest/v1/kpi_vehicle_workload?source_name=eq.${encodeURIComponent(SOURCE)}&snapshot_at=eq.${snapshotAt}`, {
      method: "DELETE",
      headers: supabaseRestHeaders(cfg.key, { Prefer: "return=minimal" }),
    });
    if (!remove.ok) return NextResponse.json({ error: `Nettoyage encours impossible (${remove.status}).` }, { status: 502 });
  }

  const rows = body.rows.map((row) => ({
    snapshot_at: snapshotAt,
    observed_at: new Date().toISOString(),
    registration: cleanText(row.registration, 32),
    work_order: cleanText(row.work_order, 64),
    client: cleanText(row.client, 80),
    sector_key: cleanText(row.sector_key, 64),
    sector_label: cleanText(row.sector_label, 100),
    status: cleanText(row.status, 220),
    age_days: num(row.age_days),
    remaining_minutes: num(row.remaining_minutes),
    booked_minutes: num(row.booked_minutes),
    estimated_total_minutes: num(row.estimated_total_minutes),
    vin: cleanText(row.vin, 40),
    opened_at: row.opened_at || null,
    potential_revenue_total: num(row.potential_revenue_total),
    potential_labor_revenue: num(row.potential_labor_revenue),
    potential_parts_revenue: num(row.potential_parts_revenue),
    potential_other_revenue: num(row.potential_other_revenue),
    primary_activity: cleanText(row.primary_activity, 220),
    source_name: SOURCE,
    metadata: { ...(row.metadata ?? {}), imported_by: identity.actor, import_channel: identity.source },
  })).filter((row) => row.work_order && row.sector_key && row.sector_label);

  const save = await fetch(`${cfg.url}/rest/v1/kpi_vehicle_workload?on_conflict=snapshot_at,work_order,sector_key,source_name`, {
    method: "POST",
    headers: supabaseRestHeaders(cfg.key, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
  });
  if (!save.ok) return NextResponse.json({ error: `Enregistrement encours impossible (${save.status}): ${await save.text()}` }, { status: 502 });

  const identities = rows.map((row) => ({ work_order: row.work_order, registration: row.registration, vin: row.vin, sources: [SOURCE], metadata: { last_snapshot: snapshotAt } }));
  await fetch(`${cfg.url}/rest/v1/rpc/kpi_upsert_vehicle_identities`, {
    method: "POST",
    headers: supabaseRestHeaders(cfg.key, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ payload: identities }),
  }).catch(() => undefined);

  return NextResponse.json({ saved: rows.length, snapshotAt, source: SOURCE });
}
