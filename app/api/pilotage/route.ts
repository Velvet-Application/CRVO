import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

const FTP_SOURCE_ID = "dfbb57cc-8771-4e53-b52b-38defa389b64";

type Production = { name: string; value: number; tone: string };
type Snapshot = { date: string; label: string; source: string; entries: number; exits: number; stock: number; over15: number; over20: number; production: Production[] };
type SnapshotRow = { snapshot_at: string; source_name: string; metrics: Record<string, number | string> };
type Objective = { sectorKey: string; sectorLabel: string; dailyTarget: number; minThreshold: number | null; maxThreshold: number | null };
type ObjectiveRow = { sector_key: string; sector_label: string; daily_target: number | string; min_threshold: number | string | null; max_threshold: number | string | null };
type Workload = {
  registration: string;
  work_order: string | null;
  client: string | null;
  vin: string | null;
  sector_key: string;
  sector_label: string;
  status: string | null;
  primary_activity: string | null;
  alert: string | null;
  urgency: string | null;
  factory_age_days: number | null;
  age_days: number | null;
  remaining_minutes: number | null;
  estimated_total_minutes: number | null;
  potential_revenue_total: number | null;
  potential_labor_revenue: number | null;
  potential_parts_revenue: number | null;
  potential_other_revenue: number | null;
  data_source: "sql" | "ftp";
};
type SqlWorkload = Omit<Workload, "alert" | "urgency" | "factory_age_days" | "data_source">;
type FtpVehicle = { registration: string | null; work_order: string | null; client: string | null; vin: string | null; status: string | null; status_age_days: number | string | null; factory_age_days: number | string | null; alert: string | null; urgency: string | null };
type FtpBatch = { id: string; snapshot_at: string; imported_at: string; metadata: Record<string, unknown> | null };
type Setting = { sector_key: string; fifo_share: number; run_max_minutes: number; critical_age_days: number };
type Recommendation = Workload & { strategy: "FIFO" | "RUN"; reason: string; rank: number };
type SectorSummary = { snapshot_at: string; sector_key: string; sector_label: string; work_order_count: number | string; remaining_hours: number | string; potential_revenue: number | string; run_pool: number | string; max_age_days: number | string | null };
type FinanceRow = { metrics: Record<string, number | string | null> };

const productionNames: Record<string, string> = { expertise: "Expertise", dsp: "DSP", mecanique: "Mécanique", carrosserie: "Carrosserie", preparation: "Préparation", qualite: "Qualité", sortie_usine: "Sortie usine" };
const sectorByLabel = Object.fromEntries(Object.entries(productionNames).map(([key, label]) => [label, key]));
const fallbackTargets: Record<string, number> = { expertise: 90, dsp: 48, mecanique: 85, carrosserie: 63, preparation: 90, qualite: 90, sortie_usine: 92 };
const fallbackSnapshot: Snapshot = { date: "2026-08-12", label: "12 août 2026", source: "Book CRVO Lens - Journée du 12.08.2026.xlsx", entries: 8, exits: 94, stock: 1064, over15: 477, over20: 382, production: [
  { name: "Expertise", value: 65, tone: "coral" }, { name: "Mécanique", value: 75, tone: "green" }, { name: "DSP", value: 27, tone: "cyan" }, { name: "Carrosserie", value: 10, tone: "red" }, { name: "Préparation", value: 83, tone: "purple" }, { name: "Qualité", value: 87, tone: "orange" }, { name: "Sortie usine", value: 94, tone: "blue" },
] };

function config() { const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY; return url && key ? { url, key } : null; }
async function rest<T>(url: string, key: string, path: string): Promise<T> { const response = await fetch(`${url}/rest/v1/${path}`, { headers: supabaseRestHeaders(key, { Accept: "application/json" }), cache: "no-store" }); if (!response.ok) throw new Error(`Supabase ${response.status}`); return response.json() as Promise<T>; }
function numeric(value: unknown) { if (value == null || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function metric(metrics: Record<string, number | string>, key: string) { return numeric(metrics[key]) ?? 0; }
function sourceMode(source: string) { return /ftp/i.test(source) ? "ftp" : "book"; }
function normalized(value: unknown) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function formatSnapshot(row: SnapshotRow): Snapshot { const metrics = row.metrics ?? {}; return { date: row.snapshot_at, label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.snapshot_at}T12:00:00Z`)), source: row.source_name, entries: metric(metrics, "entries_vop"), exits: metric(metrics, "exits_vop"), stock: metric(metrics, "factory_stock"), over15: metric(metrics, "stock_over_15d"), over20: metric(metrics, "stock_over_20d"), production: [ { name: "Expertise", value: metric(metrics, "production_expertise"), tone: "coral" }, { name: "Mécanique", value: metric(metrics, "production_mechanics"), tone: "green" }, { name: "DSP", value: metric(metrics, "production_dsp"), tone: "cyan" }, { name: "Carrosserie", value: metric(metrics, "production_bodywork"), tone: "red" }, { name: "Préparation", value: metric(metrics, "production_preparation"), tone: "purple" }, { name: "Qualité", value: metric(metrics, "production_quality"), tone: "orange" }, { name: "Sortie usine", value: metric(metrics, "production_factory_exit") || metric(metrics, "exits_vop"), tone: "blue" } ] }; }
function fallbackObjectives(): Objective[] { return Object.entries(productionNames).map(([sectorKey, sectorLabel]) => ({ sectorKey, sectorLabel, dailyTarget: fallbackTargets[sectorKey] ?? 0, minThreshold: null, maxThreshold: null })); }

function classifyFtpVehicle(item: FtpVehicle) {
  const status = normalized(item.status);
  const alert = normalized(item.alert);
  if (/controle qualite|qualite/.test(status)) return { key: "qualite", label: "Qualité" };
  if (/mecanique/.test(status)) return { key: "mecanique", label: "Mécanique" };
  if (/\bdsp\b/.test(status)) return { key: "dsp", label: "DSP" };
  if (/carrosserie|fixline/.test(status)) return { key: "carrosserie", label: "Carrosserie" };
  if (/preparation|photo/.test(status)) return { key: "preparation", label: "Préparation" };
  if (/expertise|lavage rapide|receptionne en usine/.test(status)) return { key: "expertise", label: "Expertise" };
  if (/sortie usine/.test(status)) return { key: "sortie_usine", label: "Sortie usine" };
  if (/parc d attente travaux|parc attente travaux/.test(status)) {
    if (/mecanique/.test(alert)) return { key: "mecanique", label: "Mécanique" };
    if (/\bdsp\b/.test(alert)) return { key: "dsp", label: "DSP" };
    if (/fixline|carrosserie/.test(alert)) return { key: "carrosserie", label: "Carrosserie" };
    if (/stockage sortie usine/.test(alert)) return { key: "sortie_usine", label: "Sortie usine" };
  }
  return null;
}

function ftpToWorkload(item: FtpVehicle): Workload | null {
  const sector = classifyFtpVehicle(item);
  if (!sector) return null;
  const alert = item.alert?.trim() || null;
  return {
    registration: item.registration ?? "",
    work_order: item.work_order,
    client: item.client,
    vin: item.vin,
    sector_key: sector.key,
    sector_label: sector.label,
    status: item.status,
    primary_activity: alert ? `À faire : ${alert}` : item.status,
    alert,
    urgency: item.urgency,
    factory_age_days: numeric(item.factory_age_days),
    age_days: numeric(item.status_age_days) ?? numeric(item.factory_age_days),
    remaining_minutes: null,
    estimated_total_minutes: null,
    potential_revenue_total: null,
    potential_labor_revenue: null,
    potential_parts_revenue: null,
    potential_other_revenue: null,
    data_source: "ftp",
  };
}

function identityKeys(item: { work_order?: string | null; registration?: string | null; vin?: string | null }) {
  return [item.work_order ? `or:${normalized(item.work_order)}` : "", item.registration ? `reg:${normalized(item.registration)}` : "", item.vin ? `vin:${normalized(item.vin)}` : ""].filter(Boolean);
}

function choosePlan(candidates: Workload[], gap: number, setting: Setting) {
  if (gap <= 0 || !candidates.length) return [] as Recommendation[];
  const normalizedRows = candidates.map((item) => ({ ...item, age_days: numeric(item.age_days), remaining_minutes: numeric(item.remaining_minutes), estimated_total_minutes: numeric(item.estimated_total_minutes), potential_revenue_total: numeric(item.potential_revenue_total) }));
  const oldest = [...normalizedRows].sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));
  const withTime = normalizedRows.filter((item) => item.remaining_minutes != null);
  if (!withTime.length) return oldest.slice(0, gap).map((item, index) => ({ ...item, strategy: "FIFO" as const, reason: `FIFO · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j${item.alert ? ` · ${item.alert}` : ""}`, rank: index + 1 }));
  const fifoWanted = Math.min(gap, Math.max(1, Math.ceil(gap * Number(setting.fifo_share || .7))));
  const selected: Recommendation[] = oldest.slice(0, fifoWanted).map((item) => ({ ...item, strategy: "FIFO" as const, reason: `FIFO · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j${item.remaining_minutes != null ? ` · ${Math.round(item.remaining_minutes)} min` : ""}`, rank: 0 }));
  const used = new Set(selected.flatMap(identityKeys));
  const slots = gap - selected.length;
  if (slots > 0) {
    const runs = normalizedRows.filter((item) => identityKeys(item).every((key) => !used.has(key))).filter((item) => item.remaining_minutes != null && item.remaining_minutes > 0 && item.remaining_minutes <= Number(setting.run_max_minutes || 60)).sort((a, b) => (a.remaining_minutes ?? Infinity) - (b.remaining_minutes ?? Infinity) || (b.age_days ?? 0) - (a.age_days ?? 0)).slice(0, slots).map((item) => ({ ...item, strategy: "RUN" as const, reason: `RUN · ${Math.round(item.remaining_minutes ?? 0)} min · sécurise le volume`, rank: 0 }));
    selected.push(...runs); runs.flatMap(identityKeys).forEach((key) => used.add(key));
  }
  if (selected.length < gap) selected.push(...oldest.filter((item) => identityKeys(item).every((key) => !used.has(key))).slice(0, gap - selected.length).map((item) => ({ ...item, strategy: "FIFO" as const, reason: "FIFO complémentaire · aucun RUN court disponible", rank: 0 })));
  return selected.map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function GET() {
  const cfg = config();
  let snapshot = fallbackSnapshot;
  let objectives = fallbackObjectives();
  let sqlWorkload: SqlWorkload[] = [];
  let ftpVehicles: FtpVehicle[] = [];
  let settings: Setting[] = [];
  let summaries: SectorSummary[] = [];
  let invoiceToday = { revenue: 0, invoices: 0, available: false, source: "none" as "none" | "sql" | "book" };
  let workloadSnapshot: string | null = null;
  let ftpVehicleSnapshot: string | null = null;
  let ftpVehicleLoadedAt: string | null = null;
  let dataConnected = false;

  if (cfg) {
    try { const latestRows = await rest<SnapshotRow[]>(cfg.url, cfg.key, "kpi_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.desc&limit=1"); if (latestRows[0]) { snapshot = formatSnapshot(latestRows[0]); dataConnected = true; } } catch (error) { console.error(JSON.stringify({ event: "pilotage_snapshot_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try { const month = `${snapshot.date.slice(0, 7)}-01`; const rows = await rest<ObjectiveRow[]>(cfg.url, cfg.key, `kpi_monthly_objectives?select=sector_key,sector_label,daily_target,min_threshold,max_threshold&month=eq.${month}&order=sector_key.asc`); if (rows.length) objectives = rows.map((row) => ({ sectorKey: row.sector_key, sectorLabel: row.sector_label, dailyTarget: numeric(row.daily_target) ?? 0, minThreshold: numeric(row.min_threshold), maxThreshold: numeric(row.max_threshold) })); } catch (error) { console.error(JSON.stringify({ event: "pilotage_objectives_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try {
      const summaryDates = await rest<Array<{ snapshot_at: string }>>(cfg.url, cfg.key, `kpi_workload_sector_summary?select=snapshot_at&source_name=eq.${encodeURIComponent("SQL OR encours CRVO")}&order=snapshot_at.desc&limit=1`);
      workloadSnapshot = summaryDates[0]?.snapshot_at ?? null;
      if (workloadSnapshot) summaries = await rest<SectorSummary[]>(cfg.url, cfg.key, `kpi_workload_sector_summary?select=snapshot_at,sector_key,sector_label,work_order_count,remaining_hours,potential_revenue,run_pool,max_age_days&source_name=eq.${encodeURIComponent("SQL OR encours CRVO")}&snapshot_at=eq.${workloadSnapshot}&limit=100`);
      if (!workloadSnapshot) { const dates = await rest<Array<{ snapshot_at: string }>>(cfg.url, cfg.key, `kpi_vehicle_workload?select=snapshot_at&source_name=eq.${encodeURIComponent("SQL OR encours CRVO")}&order=snapshot_at.desc&limit=1`); workloadSnapshot = dates[0]?.snapshot_at ?? null; }
      if (workloadSnapshot) sqlWorkload = await rest<SqlWorkload[]>(cfg.url, cfg.key, `kpi_vehicle_workload?select=registration,work_order,client,vin,sector_key,sector_label,status,primary_activity,age_days,remaining_minutes,estimated_total_minutes,potential_revenue_total,potential_labor_revenue,potential_parts_revenue,potential_other_revenue&source_name=eq.${encodeURIComponent("SQL OR encours CRVO")}&snapshot_at=eq.${workloadSnapshot}&limit=10000`);
    } catch (error) { console.error(JSON.stringify({ event: "pilotage_workload_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try {
      const batches = await rest<FtpBatch[]>(cfg.url, cfg.key, `kpi_import_batches?select=id,snapshot_at,imported_at,metadata&source_id=eq.${FTP_SOURCE_ID}&original_filename=eq.EtatduParc.csv&order=imported_at.desc&limit=20`);
      const batch = batches.find((item) => item.metadata?.vehicle_state_status === "ready");
      if (batch) {
        ftpVehicleSnapshot = batch.snapshot_at;
        ftpVehicleLoadedAt = String(batch.metadata?.vehicle_state_loaded_at ?? batch.imported_at);
        ftpVehicles = await rest<FtpVehicle[]>(cfg.url, cfg.key, `kpi_ftp_vehicle_state?select=registration,work_order,client,vin,status,status_age_days,factory_age_days,alert,urgency&import_batch_id=eq.${batch.id}&limit=10000`);
      }
    } catch (error) { console.error(JSON.stringify({ event: "pilotage_ftp_vehicle_state_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try { settings = await rest<Setting[]>(cfg.url, cfg.key, "kpi_pilotage_settings?select=sector_key,fifo_share,run_max_minutes,critical_age_days"); } catch (error) { console.error(JSON.stringify({ event: "pilotage_settings_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try {
      const invoices = await rest<Array<{ revenue_total: number | null }>>(cfg.url, cfg.key, `kpi_invoice_facts?select=revenue_total&source_name=eq.${encodeURIComponent("SQL Reporting factures CRVO")}&invoice_date=eq.${snapshot.date}&limit=5000`);
      if (invoices.length) invoiceToday = { revenue: invoices.reduce((sum, item) => sum + (numeric(item.revenue_total) ?? 0), 0), invoices: invoices.length, available: true, source: "sql" };
      else { const finance = await rest<FinanceRow[]>(cfg.url, cfg.key, `kpi_financial_snapshots?select=metrics&snapshot_at=eq.${snapshot.date}&limit=1`); const metrics = finance[0]?.metrics ?? {}; const revenue = numeric(metrics.revenue_day); const invoicesDay = numeric(metrics.invoices_day); if (revenue != null) invoiceToday = { revenue, invoices: Math.round(invoicesDay ?? 0), available: true, source: "book" }; }
    } catch (error) { console.error(JSON.stringify({ event: "pilotage_invoices_failed", message: error instanceof Error ? error.message : "unknown" })); }
  }

  const ftpByIdentity = new Map<string, FtpVehicle>();
  ftpVehicles.forEach((item) => identityKeys(item).forEach((key) => ftpByIdentity.set(key, item)));
  const sqlIdentity = new Set<string>();
  const workload: Workload[] = sqlWorkload.map((item) => {
    const keys = identityKeys(item); keys.forEach((key) => sqlIdentity.add(key));
    const ftp = keys.map((key) => ftpByIdentity.get(key)).find(Boolean);
    return { ...item, alert: ftp?.alert ?? null, urgency: ftp?.urgency ?? null, factory_age_days: numeric(ftp?.factory_age_days), primary_activity: ftp?.alert ? `À faire : ${ftp.alert}` : item.primary_activity, data_source: "sql" as const };
  });
  ftpVehicles.map(ftpToWorkload).filter((item): item is Workload => Boolean(item)).filter((item) => identityKeys(item).every((key) => !sqlIdentity.has(key))).forEach((item) => workload.push(item));

  const settingsMap = new Map(settings.map((item) => [item.sector_key, item]));
  const objectiveMap = new Map(objectives.map((item) => [item.sectorKey, item]));
  const summaryMap = new Map(summaries.map((item) => [item.sector_key, item]));
  const plans = snapshot.production.map((production) => {
    const sectorKey = sectorByLabel[production.name]; if (!sectorKey) return null;
    const label = production.name; const actual = production.value; const target = Math.max(0, Number(objectiveMap.get(sectorKey)?.dailyTarget ?? fallbackTargets[sectorKey] ?? 0)); const gap = Math.max(target - actual, 0);
    const candidates = workload.filter((item) => item.sector_key === sectorKey);
    const summary = summaryMap.get(sectorKey);
    const setting = settingsMap.get(sectorKey) ?? { sector_key: sectorKey, fifo_share: .7, run_max_minutes: 60, critical_age_days: 20 };
    const recommendation = choosePlan(candidates, gap, setting);
    const oldest = [...candidates].sort((a, b) => (numeric(b.age_days) ?? 0) - (numeric(a.age_days) ?? 0)).slice(0, 10);
    const runCandidates = candidates.filter((item) => (numeric(item.remaining_minutes) ?? 0) > 0 && (numeric(item.remaining_minutes) ?? Infinity) <= Number(setting.run_max_minutes || 60)).sort((a, b) => (numeric(a.remaining_minutes) ?? Infinity) - (numeric(b.remaining_minutes) ?? Infinity) || (numeric(b.age_days) ?? 0) - (numeric(a.age_days) ?? 0)).slice(0, 10);
    const highTimeOld = oldest.filter((item) => numeric(item.remaining_minutes) != null && (numeric(item.remaining_minutes) ?? 0) > Number(setting.run_max_minutes || 60)).length;
    const computedRunPool = candidates.filter((item) => (numeric(item.remaining_minutes) ?? 0) > 0 && (numeric(item.remaining_minutes) ?? Infinity) <= Number(setting.run_max_minutes || 60)).length;
    const computedRemainingHours = candidates.reduce((sum, item) => sum + (numeric(item.remaining_minutes) ?? 0), 0) / 60;
    const computedPotentialRevenue = candidates.reduce((sum, item) => sum + (numeric(item.potential_revenue_total) ?? 0), 0);
    const timeReady = candidates.some((item) => numeric(item.remaining_minutes) != null);
    return { sectorKey, label, actual, target, gap, attainment: target > 0 ? Math.round(actual / target * 100) : 0, queue: candidates.length || Math.round(numeric(summary?.work_order_count) ?? 0), workloadReady: candidates.length > 0 || Boolean(summary), timeReady, runMaxMinutes: Number(setting.run_max_minutes || 60), fifoShare: Number(setting.fifo_share || .7), highTimeOld, runPool: timeReady ? Math.round(numeric(summary?.run_pool) ?? computedRunPool) : 0, remainingHours: numeric(summary?.remaining_hours) ?? computedRemainingHours, potentialRevenue: numeric(summary?.potential_revenue) ?? computedPotentialRevenue, oldest, fifoCandidates: oldest, runCandidates, recommendation };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));

  const major = plans.filter((item) => item.target > 0 && item.gap > 0).sort((a, b) => (a.attainment - b.attainment) || (b.gap - a.gap)).slice(0, 5);
  const totalSummary = summaryMap.get("__total__");
  const uniqueOrders = new Set(workload.map((item) => item.work_order).filter(Boolean));
  const workloadSummary = { workOrders: uniqueOrders.size || Math.round(numeric(totalSummary?.work_order_count) ?? 0), remainingHours: numeric(totalSummary?.remaining_hours) ?? workload.reduce((sum, item) => sum + (numeric(item.remaining_minutes) ?? 0), 0) / 60, potentialRevenue: numeric(totalSummary?.potential_revenue) ?? workload.reduce((sum, item) => sum + (numeric(item.potential_revenue_total) ?? 0), 0) };
  const productionMode = sourceMode(snapshot.source);

  return NextResponse.json({
    snapshot, dataConnected, workloadSnapshot: workloadSnapshot ?? ftpVehicleSnapshot, ftpVehicleSnapshot, ftpVehicleLoadedAt, productionMode,
    sources: { ftp: productionMode === "ftp", sftp: productionMode === "ftp", production: productionMode, workloadFtp: ftpVehicles.length > 0, workloadSql: summaries.length > 0 || sqlWorkload.length > 0, workloadTime: sqlWorkload.some((item) => numeric(item.remaining_minutes) != null), alertsFtp: ftpVehicles.some((item) => Boolean(item.alert)), invoicesSql: invoiceToday.source === "sql", financeBook: invoiceToday.source === "book" },
    invoiceToday, workloadSummary, major, plans,
    methodology: { fifo: "Les dossiers les plus anciens sur leur statut restent prioritaires. EtatduParc apporte l’alerte et le prochain passage attendu.", run: "Les dossiers courts utilisent le temps restant SQL quand il est disponible.", defaultFifoShare: .7, defaultRunMaxMinutes: 60 },
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
}
