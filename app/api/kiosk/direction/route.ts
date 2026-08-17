import { NextResponse } from "next/server";
import { loadKioskDashboard } from "../kiosk-data";
import { supabaseRestHeaders } from "../../../supabase-rest";

export const dynamic = "force-dynamic";

type FinanceTargetRow = { revenue_target: number | string | null };
type InvoiceRow = {
  invoice_date: string;
  source_name: string;
  revenue_total: number | string | null;
  labor_revenue: number | string | null;
  labor_hours: number | string | null;
};

const FINANCE_SOURCE = "SQL Reporting factures CRVO";

function config() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parisToday() {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function nextMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function businessDaysInMonth(monthIso: string) {
  const [year, month] = monthIso.slice(0, 7).split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  let count = 0;
  while (cursor.getUTCMonth() === month - 1) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(count, 1);
}

async function rest<T>(path: string): Promise<T> {
  const db = config();
  if (!db) throw new Error("Base CRVO non configurée.");
  const response = await fetch(`${db.supabaseUrl}/rest/v1/${path}`, {
    headers: supabaseRestHeaders(db.secretKey, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function loadDirectionFinance(history: boolean) {
  const today = parisToday();
  const start = `${today.slice(0, 7)}-01`;
  const end = nextMonth(start);

  // Read the month first, then filter the certified invoice source in code.
  // This avoids fragile PostgREST URL filtering on a source label containing spaces.
  const [targetRows, rawInvoiceRows] = await Promise.all([
    rest<FinanceTargetRow[]>(`kpi_finance_targets?select=revenue_target&month=eq.${start}&limit=1`),
    rest<InvoiceRow[]>(`kpi_invoice_facts?select=invoice_date,source_name,revenue_total,labor_revenue,labor_hours&invoice_date=gte.${start}&invoice_date=lt.${end}&invoice_date=lte.${today}&order=invoice_date.asc&limit=20000`),
  ]);

  const budgetRaw = targetRows[0]?.revenue_target;
  const budget = budgetRaw == null ? null : numberValue(budgetRaw);
  const invoiceRows = rawInvoiceRows.filter((row) => row.source_name === FINANCE_SOURCE);

  if (!invoiceRows.length) {
    return {
      connected: false,
      backend: "kiosk-direct-invoices-v2",
      targetConfigured: budget != null,
      budget,
      asOfDate: null,
      snapshot: null,
      snapshots: history ? [] : undefined,
      error: `Aucune facture '${FINANCE_SOURCE}' disponible pour le mois courant.`,
    };
  }

  const daily = new Map<string, { invoices: number; revenue: number; laborRevenue: number; laborHours: number }>();
  for (const row of invoiceRows) {
    const item = daily.get(row.invoice_date) ?? { invoices: 0, revenue: 0, laborRevenue: 0, laborHours: 0 };
    item.invoices += 1;
    item.revenue += numberValue(row.revenue_total);
    item.laborRevenue += numberValue(row.labor_revenue);
    item.laborHours += numberValue(row.labor_hours);
    daily.set(row.invoice_date, item);
  }

  const businessDays = businessDaysInMonth(start);
  let invoicesCumulative = 0;
  let revenueCumulative = 0;
  let laborRevenueCumulative = 0;
  let laborHoursCumulative = 0;

  const ascending = [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, item]) => {
    invoicesCumulative += item.invoices;
    revenueCumulative += item.revenue;
    laborRevenueCumulative += item.laborRevenue;
    laborHoursCumulative += item.laborHours;
    return {
      date,
      source: "Reporting factures CRVO · direct kiosk v2",
      filename: "Reporting CRVO Lens factures",
      metrics: {
        revenue_day: Number(item.revenue.toFixed(2)),
        revenue_cumulative: Number(revenueCumulative.toFixed(2)),
        revenue_day_target: budget == null ? null : Number((budget / businessDays).toFixed(2)),
        revenue_cumulative_target: budget == null ? null : Number(budget.toFixed(2)),
        labor_revenue_day: Number(item.laborRevenue.toFixed(2)),
        labor_revenue_cumulative: Number(laborRevenueCumulative.toFixed(2)),
        labor_hours_day: Number(item.laborHours.toFixed(2)),
        labor_hours: Number(laborHoursCumulative.toFixed(2)),
        invoices_day: item.invoices,
        invoices_cumulative: invoicesCumulative,
        sql_invoice_source: 1,
      },
    };
  });

  const latest = ascending.at(-1) ?? null;
  return {
    connected: true,
    backend: "kiosk-direct-invoices-v2",
    targetConfigured: budget != null,
    budget,
    asOfDate: latest?.date ?? null,
    snapshot: latest,
    snapshots: history ? [...ascending].reverse() : undefined,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource") ?? "dashboard";
  try {
    if (resource === "finance") {
      return NextResponse.json(await loadDirectionFinance(url.searchParams.get("history") === "1"), {
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
      });
    }
    const requestedDate = url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
    return NextResponse.json(await loadKioskDashboard(url.searchParams.get("history") === "1", requestedDate), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { connected: false, error: error instanceof Error ? error.message : "Écran direction indisponible." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
