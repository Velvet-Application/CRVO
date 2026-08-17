import { supabaseRestHeaders } from "../../supabase-rest";

export type SnapshotRow = {
  snapshot_at: string;
  source_name: string;
  metrics: Record<string, number | string | null>;
};

type LiveRow = SnapshotRow & {
  source_modified_at: string | null;
  factory_modified_at: string | null;
  park_modified_at: string | null;
};

type DirectionLiveFlowRow = {
  snapshot_at: string;
  park_modified_at: string | null;
  preparation_remaining: number | string | null;
  quality_remaining: number | string | null;
  photo_remaining: number | string | null;
};

type ObjectiveRow = {
  month: string;
  sector_key: string;
  sector_label: string;
  daily_target: number | string;
  min_threshold: number | string | null;
  max_threshold: number | string | null;
  updated_at: string | null;
};

type DailyExitRow = { target_date: string; target_value: number | string };
type FinanceTargetRow = { revenue_target: number | string | null };
type InvoiceRow = {
  invoice_date: string;
  revenue_total: number | string | null;
  labor_revenue: number | string | null;
  labor_hours: number | string | null;
};

const SATURDAY_ADDITIVE_METRICS = [
  "entries_vop",
  "exits_vop",
  "production_expertise",
  "production_mechanics",
  "production_dsp",
  "production_bodywork",
  "production_preparation",
  "production_quality",
  "production_factory_exit",
];
const STOCK_METRICS = ["factory_stock", "stock_over_15d", "stock_over_20d"];
const BUSINESS_DAYS = new Set([1, 2, 3, 4, 5]);

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function rest<T>(path: string): Promise<T> {
  const config = env();
  if (!config) throw new Error("Base CRVO non configurée.");
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: supabaseRestHeaders(config.secretKey, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function sourcePriority(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return 30;
  if (value.includes("manuel") || value.includes("book") || value.includes("excel")) return 20;
  return 10;
}

function sourceMode(source: string) {
  const value = source.toLowerCase();
  if (value.includes("ftp") || value.includes("sftp")) return "ftp";
  if (value.includes("manuel") || value.includes("book") || value.includes("excel")) return "historical_import";
  return "database";
}

function metricValue(metrics: SnapshotRow["metrics"], key: string) {
  return numberValue(metrics[key]);
}

function previousIsoDate(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function utcDay(dateIso: string) {
  return new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

function hasMeaningfulMetrics(row: SnapshotRow) {
  return [...SATURDAY_ADDITIVE_METRICS, ...STOCK_METRICS].some((key) => metricValue(row.metrics, key) > 0);
}

function normalizeBusinessDays(rows: SnapshotRow[]) {
  const byDate = new Map(rows.map((row) => [row.snapshot_at, { ...row, metrics: { ...row.metrics } }]));
  for (const saturday of [...byDate.values()]) {
    if (utcDay(saturday.snapshot_at) !== 6) continue;
    const fridayDate = previousIsoDate(saturday.snapshot_at);
    const friday = byDate.get(fridayDate);
    if (friday) {
      const metrics = { ...friday.metrics };
      for (const key of SATURDAY_ADDITIVE_METRICS) metrics[key] = metricValue(friday.metrics, key) + metricValue(saturday.metrics, key);
      for (const key of STOCK_METRICS) {
        const saturdayValue = metricValue(saturday.metrics, key);
        if (saturdayValue > 0) metrics[key] = saturdayValue;
      }
      byDate.set(fridayDate, {
        ...friday,
        source_name: hasMeaningfulMetrics(saturday) ? `${friday.source_name} · samedi consolidé` : friday.source_name,
        metrics,
      });
    } else if (hasMeaningfulMetrics(saturday)) {
      byDate.set(fridayDate, {
        ...saturday,
        snapshot_at: fridayDate,
        source_name: `${saturday.source_name} · samedi rattaché au vendredi`,
        metrics: { ...saturday.metrics },
      });
    }
    byDate.delete(saturday.snapshot_at);
  }
  for (const row of [...byDate.values()]) if (utcDay(row.snapshot_at) === 0) byDate.delete(row.snapshot_at);
  return [...byDate.values()].filter((row) => BUSINESS_DAYS.has(utcDay(row.snapshot_at))).sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

function mergeRealRows(rows: SnapshotRow[]) {
  const byDate = new Map<string, SnapshotRow>();
  for (const row of [...rows].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at))) {
    const current = byDate.get(row.snapshot_at);
    if (!current || sourcePriority(row.source_name) >= sourcePriority(current.source_name)) byDate.set(row.snapshot_at, row);
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
}

function formatSnapshot(row: SnapshotRow) {
  const metrics = row.metrics ?? {};
  return {
    date: row.snapshot_at,
    label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.snapshot_at}T12:00:00Z`)),
    source: row.source_name,
    sourceMode: sourceMode(row.source_name),
    entries: metricValue(metrics, "entries_vop"),
    exits: metricValue(metrics, "exits_vop"),
    stock: metricValue(metrics, "factory_stock"),
    over15: metricValue(metrics, "stock_over_15d"),
    over20: metricValue(metrics, "stock_over_20d"),
    production: [
      { name: "Expertise", value: metricValue(metrics, "production_expertise"), tone: "expertise" },
      { name: "Mécanique", value: metricValue(metrics, "production_mechanics"), tone: "mecanique" },
      { name: "DSP", value: metricValue(metrics, "production_dsp"), tone: "dsp" },
      { name: "Carrosserie", value: metricValue(metrics, "production_bodywork"), tone: "carrosserie" },
      { name: "Préparation", value: metricValue(metrics, "production_preparation"), tone: "preparation" },
      { name: "Qualité", value: metricValue(metrics, "production_quality"), tone: "qualite_photo" },
      { name: "Sortie usine", value: metricValue(metrics, "production_factory_exit") || metricValue(metrics, "exits_vop"), tone: "sortie_usine" },
    ],
  };
}

export async function loadKioskDashboard(history = false, requestedDate: string | null = null) {
  const [historyRows, liveRows, directionRows] = await Promise.all([
    rest<SnapshotRow[]>("kpi_public_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.asc&limit=180"),
    rest<LiveRow[]>("kpi_ftp_live_dashboard?select=snapshot_at,source_name,metrics,source_modified_at,factory_modified_at,park_modified_at&limit=1"),
    rest<DirectionLiveFlowRow[]>("kpi_ftp_direction_live_flow?select=snapshot_at,park_modified_at,preparation_remaining,quality_remaining,photo_remaining&limit=1").catch(() => []),
  ]);
  const all = normalizeBusinessDays(mergeRealRows([...historyRows, ...liveRows]));
  if (!all.length) throw new Error("Aucune donnée opérationnelle réelle n'est disponible.");
  const source = requestedDate ? all.find((row) => row.snapshot_at === requestedDate) : all.at(-1);
  if (!source) throw new Error("Aucune donnée réelle pour la date demandée.");
  const live = liveRows[0] ?? null;
  const direction = directionRows[0] ?? null;
  const liveMetrics = live?.metrics ?? {};
  return {
    connected: true,
    backend: "kiosk-supabase-real-sources",
    sourceMode: sourceMode(source.source_name),
    latestSource: source.source_name,
    snapshot: formatSnapshot(source),
    snapshots: history ? all.map(formatSnapshot) : undefined,
    liveFlow: live ? {
      date: live.snapshot_at,
      received: metricValue(liveMetrics, "entries_vop"),
      preparationRemaining: numberValue(direction?.preparation_remaining),
      qualityRemaining: numberValue(direction?.quality_remaining),
      photoRemaining: numberValue(direction?.photo_remaining),
      exits: metricValue(liveMetrics, "production_factory_exit") || metricValue(liveMetrics, "exits_vop"),
      stock: metricValue(liveMetrics, "factory_stock"),
      parkModifiedAt: direction?.park_modified_at ?? live.park_modified_at,
    } : null,
    liveFreshness: live ? {
      sourceModifiedAt: live.source_modified_at,
      factoryModifiedAt: live.factory_modified_at,
      parkModifiedAt: live.park_modified_at,
    } : null,
  };
}

function monthStart(value: string | null) {
  const month = value && /^20\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date());
  return `${month}-01`;
}

function nextMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 10);
}

export async function loadKioskObjectives(month: string | null) {
  const start = monthStart(month);
  const end = nextMonth(start);
  const [rows, daily] = await Promise.all([
    rest<ObjectiveRow[]>(`kpi_monthly_objectives?select=month,sector_key,sector_label,daily_target,min_threshold,max_threshold,updated_at&month=eq.${start}&order=sector_label.asc`),
    rest<DailyExitRow[]>(`kpi_daily_exit_objectives?select=target_date,target_value&target_date=gte.${start}&target_date=lt.${end}&order=target_date.asc`),
  ]);
  return {
    connected: true,
    configured: rows.length > 0,
    month: start,
    objectives: rows.map((row) => ({
      month: row.month,
      sectorKey: row.sector_key,
      sectorLabel: row.sector_label,
      dailyTarget: numberValue(row.daily_target),
      minThreshold: row.min_threshold == null ? null : numberValue(row.min_threshold),
      maxThreshold: row.max_threshold == null ? null : numberValue(row.max_threshold),
      updatedAt: row.updated_at,
    })),
    sortieDailyTargets: Object.fromEntries(daily.map((row) => [row.target_date, numberValue(row.target_value)])),
    storage: "supabase-kiosk-readonly",
  };
}

export async function loadKioskSystemStatus() {
  return { supabase: true, supabaseStatus: "connected", ftpBridge: true, ftpRefresh: null };
}

function parisToday() {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
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

export async function loadKioskFinance(history = false) {
  const today = parisToday();
  const start = `${today.slice(0, 7)}-01`;
  const end = nextMonth(start);
  const source = encodeURIComponent("SQL Reporting factures CRVO");
  const [targetRows, invoiceRows] = await Promise.all([
    rest<FinanceTargetRow[]>(`kpi_finance_targets?select=revenue_target&month=eq.${start}&limit=1`),
    rest<InvoiceRow[]>(`kpi_invoice_facts?select=invoice_date,revenue_total,labor_revenue,labor_hours&invoice_date=gte.${start}&invoice_date=lt.${end}&invoice_date=lte.${today}&source_name=eq.${source}&order=invoice_date.asc&limit=20000`),
  ]);
  const budgetRaw = targetRows[0]?.revenue_target;
  const budget = budgetRaw == null ? null : numberValue(budgetRaw);
  if (!invoiceRows.length) return { connected: false, backend: "kiosk-direct-invoices", targetConfigured: budget != null, asOfDate: null, snapshot: null, snapshots: history ? [] : undefined, error: "Aucune facture réelle importée pour le mois courant." };

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
      source: "Reporting factures CRVO · direct kiosk",
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
  const snapshots = [...ascending].reverse();
  return {
    connected: true,
    backend: "kiosk-direct-invoices",
    targetConfigured: budget != null,
    asOfDate: latest?.date ?? null,
    snapshot: latest,
    snapshots: history ? snapshots : undefined,
  };
}
