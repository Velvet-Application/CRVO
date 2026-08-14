import { NextResponse } from "next/server";
import { getImportIdentity } from "../../import-auth";
import { supabaseRestHeaders } from "../../supabase-rest";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type FinancialMetrics = Record<string, number | string | null>;
type FinancialSnapshot = { date: string; source: string; filename: string; metrics: FinancialMetrics; importedAt?: string };
type InvoiceFact = { invoice_date: string; invoice_number: string; work_order: string | null; revenue_total: number | string | null; labor_revenue: number | string | null; labor_hours: number | string | null };

const verifiedFinance: FinancialSnapshot[] = [
  { date: "2026-08-12", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 12.08.2026.xlsx", metrics: { vop: 638, revenue_day: 46079.34, revenue_day_target: 90419.04761904762, revenue_cumulative: 553231.54, revenue_cumulative_target: 1898800, fre_per_vo: 794.4713793103447, mo_per_vop: 9.680548589341704, revenue_per_vop: 867.1340752351095, labor_hours: 6176.19, labor_revenue_cumulative: 279655, invoices_day: 58, invoices_cumulative: 638 } },
  { date: "2026-08-11", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 11.08.2026.xlsx", metrics: { vop: 580, revenue_day: 46911.67, revenue_day_target: 90419.04761904762, revenue_cumulative: 507152.2, revenue_cumulative_target: 1898800, fre_per_vo: 885.1258490566036, mo_per_vop: 9.700913793103458, revenue_per_vop: 874.4003448275861, labor_hours: 5626.53, labor_revenue_cumulative: 255077.7 } },
  { date: "2026-08-10", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 10.08.2026.xlsx", metrics: { vop: 527, revenue_day: 73109.23, revenue_day_target: 90419.04761904762, revenue_cumulative: 460240.53, revenue_cumulative_target: 1898800, fre_per_vo: 880.8340963855421, mo_per_vop: 9.689222011385212, revenue_per_vop: 873.321688804554, labor_hours: 5106.22, labor_revenue_cumulative: 231219.5 } },
  { date: "2026-08-07", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 07.08.2026.xlsx", metrics: { vop: 444, revenue_day: 108771.86, revenue_day_target: 90419.04761904762, revenue_cumulative: 387131.3, revenue_cumulative_target: 1898800, fre_per_vo: 891.57262295082, mo_per_vop: 9.693851351351361, revenue_per_vop: 871.9173423423423, labor_hours: 4304.07, labor_revenue_cumulative: 194733.38 } },
  { date: "2026-08-06", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 06.08.2026.xlsx", metrics: { vop: 322, revenue_day: 76124.52, revenue_day_target: 90419.04761904762, revenue_cumulative: 278359.44, revenue_cumulative_target: 1898800, fre_per_vo: 809.8353191489363, mo_per_vop: 9.46767080745343, revenue_per_vop: 864.4703105590061, labor_hours: 3048.59, labor_revenue_cumulative: 137986.63 } },
  { date: "2026-08-05", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 05.08.2026.xlsx", metrics: { vop: 228, revenue_day: 44253.83, revenue_day_target: 90419.04761904762, revenue_cumulative: 202234.92, revenue_cumulative_target: 1898800, fre_per_vo: 750.0649152542371, mo_per_vop: 9.904342105263172, revenue_per_vop: 886.9952631578946, labor_hours: 2258.19, labor_revenue_cumulative: 101946 } },
  { date: "2026-08-04", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 04.08.2026.xlsx", metrics: { vop: 169, revenue_day: 104134.46, revenue_day_target: 90419.04761904762, revenue_cumulative: 157981.09, revenue_cumulative_target: 1898800, fre_per_vo: 973.2192523364483, mo_per_vop: 10.201715976331378, revenue_per_vop: 934.7993491124258, labor_hours: 1724.09, labor_revenue_cumulative: 78248 } },
  { date: "2026-08-03", source: "Book CRVO Lens", filename: "Book CRVO Lens - Journée du 03.08.2026.xlsx", metrics: { vop: 62, revenue_day: 53846.63, revenue_day_target: 90419.04761904762, revenue_cumulative: 53846.63, revenue_cumulative_target: 1898800, fre_per_vo: 868.4940322580645, mo_per_vop: 9.944193548387105, revenue_per_vop: 868.4940322580645, labor_hours: 616.54, labor_revenue_cumulative: 28276.52 } },
];

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}

function number(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mergeSnapshots(live: FinancialSnapshot[]) {
  const byDate = new Map(verifiedFinance.map((row) => [row.date, row]));
  live.forEach((row) => byDate.set(row.date, row));
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function applyInvoices(base: FinancialSnapshot[], facts: InvoiceFact[]) {
  if (!facts.length) return base;
  const baseByDate = new Map(base.map((item) => [item.date, item]));
  const byDate = new Map<string, InvoiceFact[]>();
  facts.forEach((fact) => {
    const list = byDate.get(fact.invoice_date) ?? [];
    list.push(fact);
    byDate.set(fact.invoice_date, list);
  });

  let currentMonth = "";
  let cumulativeRevenue = 0;
  let cumulativeLabor = 0;
  let cumulativeHours = 0;
  let cumulativeInvoices = 0;
  const sqlSnapshots: FinancialSnapshot[] = [];

  [...byDate.keys()].sort().forEach((date) => {
    const month = date.slice(0, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      cumulativeRevenue = 0; cumulativeLabor = 0; cumulativeHours = 0; cumulativeInvoices = 0;
    }
    const day = byDate.get(date) ?? [];
    const revenueDay = day.reduce((sum, row) => sum + number(row.revenue_total), 0);
    const laborDay = day.reduce((sum, row) => sum + number(row.labor_revenue), 0);
    const hoursDay = day.reduce((sum, row) => sum + number(row.labor_hours), 0);
    cumulativeRevenue += revenueDay; cumulativeLabor += laborDay; cumulativeHours += hoursDay; cumulativeInvoices += day.length;
    const baseRow = baseByDate.get(date);
    const metrics: FinancialMetrics = { ...(baseRow?.metrics ?? {}) };
    metrics.revenue_day = revenueDay;
    metrics.revenue_cumulative = cumulativeRevenue;
    metrics.labor_revenue_day = laborDay;
    metrics.labor_revenue_cumulative = cumulativeLabor;
    metrics.labor_hours_day = hoursDay;
    metrics.labor_hours = cumulativeHours;
    metrics.invoices_day = day.length;
    metrics.invoices_cumulative = cumulativeInvoices;
    metrics.sql_invoice_source = 1;
    const vop = number(metrics.vop);
    if (vop > 0) {
      metrics.revenue_per_vop = cumulativeRevenue / vop;
      metrics.mo_per_vop = cumulativeHours / vop;
    }
    sqlSnapshots.push({ date, source: "SQL Reporting factures CRVO", filename: "Reporting CRVO Lens factures", metrics, importedAt: baseRow?.importedAt });
  });

  const result = new Map(base.map((row) => [row.date, row]));
  sqlSnapshots.forEach((row) => result.set(row.date, row));
  return [...result.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const history = url.searchParams.get("history") === "1";

  const current = await currentSession();
  if (current) {
    try {
      const payload = await authRpc<Record<string, unknown>>("kpi_direction_finance", {
        p_session_hash: current.tokenHash,
        p_history: history,
      });
      return NextResponse.json(payload, {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "finance_rpc_failed", message: error instanceof Error ? error.message : "unknown" }));
    }
  }

  const config = env();
  if (!config) {
    const snapshots = mergeSnapshots([]);
    return NextResponse.json({ connected: false, backend: "embedded-finance", snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const [financeResponse, invoiceResponse] = await Promise.all([
      fetch(`${config.supabaseUrl}/rest/v1/kpi_financial_snapshots?select=snapshot_at,source_name,original_filename,metrics,imported_at&order=snapshot_at.desc&limit=120`, { headers: supabaseRestHeaders(config.secretKey, { Accept: "application/json" }), cache: "no-store" }),
      fetch(`${config.supabaseUrl}/rest/v1/kpi_invoice_facts?select=invoice_date,invoice_number,work_order,revenue_total,labor_revenue,labor_hours&source_name=eq.${encodeURIComponent("SQL Reporting factures CRVO")}&order=invoice_date.asc&limit=10000`, { headers: supabaseRestHeaders(config.secretKey, { Accept: "application/json" }), cache: "no-store" }),
    ]);
    if (!financeResponse.ok) throw new Error(`Supabase finance ${financeResponse.status}`);
    const rows = await financeResponse.json() as Array<Record<string, unknown>>;
    const live = rows.map((row) => ({ date: String(row.snapshot_at ?? ""), source: String(row.source_name ?? "Import Finance CRVO"), filename: String(row.original_filename ?? ""), metrics: (row.metrics ?? {}) as FinancialMetrics, importedAt: row.imported_at ? String(row.imported_at) : undefined }));
    const base = mergeSnapshots(live);
    const invoiceFacts = invoiceResponse.ok ? await invoiceResponse.json() as InvoiceFact[] : [];
    const snapshots = applyInvoices(base, invoiceFacts);
    return NextResponse.json({ connected: true, backend: invoiceFacts.length ? "supabase+sql-invoices" : "supabase+embedded-finance", sqlInvoices: invoiceFacts.length, snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "finance_fetch_failed", message: error instanceof Error ? error.message : "unknown" }));
    const snapshots = mergeSnapshots([]);
    return NextResponse.json({ connected: false, backend: "embedded-finance", snapshot: snapshots[0] ?? null, snapshots: history ? snapshots : undefined }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const identity = await getImportIdentity(request);
  if (!identity) return NextResponse.json({ authRequired: true, error: "Accès protégé requis." }, { status: 401 });
  const config = env();
  if (!config) return NextResponse.json({ error: "Supabase n'est pas configuré sur cet environnement." }, { status: 503 });
  const body = await request.json() as { snapshotAt?: string; filename?: string; sha256?: string; byteSize?: number; metrics?: FinancialMetrics };
  if (!body.snapshotAt || !/^\d{4}-\d{2}-\d{2}$/.test(body.snapshotAt)) return NextResponse.json({ error: "Date financière invalide." }, { status: 400 });
  if (!body.filename || !body.metrics || typeof body.metrics !== "object") return NextResponse.json({ error: "Import financier incomplet." }, { status: 400 });
  const row = { snapshot_at: body.snapshotAt, source_name: "Import Finance CRVO", original_filename: body.filename, sha256: body.sha256 || null, byte_size: Math.max(0, Number(body.byteSize) || 0), metrics: body.metrics, imported_at: new Date().toISOString() };
  const response = await fetch(`${config.supabaseUrl}/rest/v1/kpi_financial_snapshots?on_conflict=snapshot_at`, { method: "POST", headers: supabaseRestHeaders(config.secretKey, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify([row]) });
  if (!response.ok) return NextResponse.json({ error: `Supabase ${response.status}: ${await response.text()}` }, { status: 502 });
  return NextResponse.json({ saved: true, snapshotAt: body.snapshotAt, identity: identity.method });
}
