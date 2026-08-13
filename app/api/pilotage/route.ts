import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type Production = { name: string; value: number; tone: string };
type Snapshot = { date: string; label: string; entries: number; exits: number; stock: number; over15: number; over20: number; production: Production[] };
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
  age_days: number | null;
  remaining_minutes: number | null;
  estimated_total_minutes: number | null;
  potential_revenue_total: number | null;
  potential_labor_revenue: number | null;
  potential_parts_revenue: number | null;
  potential_other_revenue: number | null;
};
type Setting = { sector_key: string; fifo_share: number; run_max_minutes: number; critical_age_days: number };
type Recommendation = Workload & { strategy: "FIFO" | "RUN"; reason: string; rank: number };

const productionNames: Record<string, string> = { expertise: "Expertise", chiffrage: "Chiffrage", controle_technique: "Contrôle technique", dsp: "DSP", jantes: "Jantes", mecanique: "Mécanique", carrosserie: "Carrosserie", parc_travaux: "Parc travaux", preparation: "Préparation", qualite: "Qualité", sortie_usine: "Sortie usine" };
const fallbackTargets: Record<string, number> = { expertise: 90, chiffrage: 50, controle_technique: 50, dsp: 48, jantes: 35, mecanique: 85, carrosserie: 63, parc_travaux: 80, preparation: 90, qualite: 90, sortie_usine: 92 };
const fallbackSnapshot: Snapshot = { date: "2026-08-12", label: "12 août 2026", entries: 8, exits: 94, stock: 1064, over15: 477, over20: 382, production: [
  { name: "Expertise", value: 65, tone: "coral" }, { name: "Mécanique", value: 75, tone: "green" }, { name: "DSP", value: 27, tone: "cyan" }, { name: "Carrosserie", value: 10, tone: "red" }, { name: "Préparation", value: 83, tone: "purple" }, { name: "Qualité", value: 87, tone: "orange" }, { name: "Sortie usine", value: 94, tone: "blue" },
] };

function config() { const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY; return url && key ? { url, key } : null; }
async function rest<T>(url: string, key: string, path: string): Promise<T> { const response = await fetch(`${url}/rest/v1/${path}`, { headers: supabaseRestHeaders(key, { Accept: "application/json" }), cache: "no-store" }); if (!response.ok) throw new Error(`Supabase ${response.status}`); return response.json() as Promise<T>; }
function numeric(value: unknown) { if (value == null || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function metric(metrics: Record<string, number | string>, key: string) { return numeric(metrics[key]) ?? 0; }
function formatSnapshot(row: SnapshotRow): Snapshot { const metrics = row.metrics ?? {}; return { date: row.snapshot_at, label: new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.snapshot_at}T12:00:00Z`)), entries: metric(metrics, "entries_vop"), exits: metric(metrics, "exits_vop"), stock: metric(metrics, "factory_stock"), over15: metric(metrics, "stock_over_15d"), over20: metric(metrics, "stock_over_20d"), production: [ { name: "Expertise", value: metric(metrics, "production_expertise"), tone: "coral" }, { name: "Mécanique", value: metric(metrics, "production_mechanics"), tone: "green" }, { name: "DSP", value: metric(metrics, "production_dsp"), tone: "cyan" }, { name: "Carrosserie", value: metric(metrics, "production_bodywork"), tone: "red" }, { name: "Préparation", value: metric(metrics, "production_preparation"), tone: "purple" }, { name: "Qualité", value: metric(metrics, "production_quality"), tone: "orange" }, { name: "Sortie usine", value: metric(metrics, "production_factory_exit") || metric(metrics, "exits_vop"), tone: "blue" } ] }; }
function fallbackObjectives(): Objective[] { return Object.entries(productionNames).map(([sectorKey, sectorLabel]) => ({ sectorKey, sectorLabel, dailyTarget: fallbackTargets[sectorKey] ?? 0, minThreshold: null, maxThreshold: null })); }

function choosePlan(candidates: Workload[], gap: number, setting: Setting) {
  if (gap <= 0 || !candidates.length) return [] as Recommendation[];
  const normalized = candidates.map((item) => ({ ...item, age_days: numeric(item.age_days), remaining_minutes: numeric(item.remaining_minutes), estimated_total_minutes: numeric(item.estimated_total_minutes), potential_revenue_total: numeric(item.potential_revenue_total) }));
  const oldest = [...normalized].sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));
  const withTime = normalized.filter((item) => item.remaining_minutes != null);
  if (!withTime.length) return oldest.slice(0, gap).map((item, index) => ({ ...item, strategy: "FIFO" as const, reason: `FIFO · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j`, rank: index + 1 }));

  const fifoWanted = Math.min(gap, Math.max(1, Math.ceil(gap * Number(setting.fifo_share || .7))));
  const selected: Recommendation[] = oldest.slice(0, fifoWanted).map((item) => ({ ...item, strategy: "FIFO" as const, reason: `FIFO · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j · ${Math.round(item.remaining_minutes ?? 0)} min`, rank: 0 }));
  const used = new Set(selected.map((item) => `${item.registration}|${item.work_order ?? ""}`));
  const slots = gap - selected.length;
  if (slots > 0) {
    const runs = normalized.filter((item) => !used.has(`${item.registration}|${item.work_order ?? ""}`)).filter((item) => item.remaining_minutes != null && item.remaining_minutes > 0 && item.remaining_minutes <= Number(setting.run_max_minutes || 60)).sort((a, b) => (a.remaining_minutes ?? Infinity) - (b.remaining_minutes ?? Infinity) || (b.age_days ?? 0) - (a.age_days ?? 0)).slice(0, slots).map((item) => ({ ...item, strategy: "RUN" as const, reason: `RUN · ${Math.round(item.remaining_minutes ?? 0)} min · sécurise le volume`, rank: 0 }));
    selected.push(...runs); runs.forEach((item) => used.add(`${item.registration}|${item.work_order ?? ""}`));
  }
  if (selected.length < gap) selected.push(...oldest.filter((item) => !used.has(`${item.registration}|${item.work_order ?? ""}`)).slice(0, gap - selected.length).map((item) => ({ ...item, strategy: "FIFO" as const, reason: "FIFO complémentaire · aucun RUN court disponible", rank: 0 })));
  return selected.map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function GET() {
  const cfg = config();
  let snapshot = fallbackSnapshot;
  let objectives = fallbackObjectives();
  let workload: Workload[] = [];
  let settings: Setting[] = [];
  let invoiceToday = { revenue: 0, invoices: 0 };
  let workloadSnapshot: string | null = null;
  let dataConnected = false;

  if (cfg) {
    try { const latestRows = await rest<SnapshotRow[]>(cfg.url, cfg.key, "kpi_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.desc&limit=1"); if (latestRows[0]) { snapshot = formatSnapshot(latestRows[0]); dataConnected = true; } } catch (error) { console.error(JSON.stringify({ event: "pilotage_snapshot_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try { const month = `${snapshot.date.slice(0, 7)}-01`; const rows = await rest<ObjectiveRow[]>(cfg.url, cfg.key, `kpi_monthly_objectives?select=sector_key,sector_label,daily_target,min_threshold,max_threshold&month=eq.${month}&order=sector_key.asc`); if (rows.length) objectives = rows.map((row) => ({ sectorKey: row.sector_key, sectorLabel: row.sector_label, dailyTarget: numeric(row.daily_target) ?? 0, minThreshold: numeric(row.min_threshold), maxThreshold: numeric(row.max_threshold) })); } catch (error) { console.error(JSON.stringify({ event: "pilotage_objectives_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try { const dates = await rest<Array<{ snapshot_at: string }>>(cfg.url, cfg.key, `kpi_vehicle_workload?select=snapshot_at&source_name=eq.${encodeURIComponent("SQL OR encours CRVO")}&order=snapshot_at.desc&limit=1`); workloadSnapshot = dates[0]?.snapshot_at ?? null; if (workloadSnapshot) workload = await rest<Workload[]>(cfg.url, cfg.key, `kpi_vehicle_workload?select=registration,work_order,client,vin,sector_key,sector_label,status,primary_activity,age_days,remaining_minutes,estimated_total_minutes,potential_revenue_total,potential_labor_revenue,potential_parts_revenue,potential_other_revenue&source_name=eq.${encodeURIComponent("SQL OR encours CRVO")}&snapshot_at=eq.${encodeURIComponent(workloadSnapshot)}&limit=10000`); } catch (error) { console.error(JSON.stringify({ event: "pilotage_workload_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try { settings = await rest<Setting[]>(cfg.url, cfg.key, "kpi_pilotage_settings?select=sector_key,fifo_share,run_max_minutes,critical_age_days"); } catch (error) { console.error(JSON.stringify({ event: "pilotage_settings_failed", message: error instanceof Error ? error.message : "unknown" })); }
    try { const invoices = await rest<Array<{ revenue_total: number | null }>>(cfg.url, cfg.key, `kpi_invoice_facts?select=revenue_total&source_name=eq.${encodeURIComponent("SQL Reporting factures CRVO")}&invoice_date=eq.${snapshot.date}&limit=5000`); invoiceToday = { revenue: invoices.reduce((sum, item) => sum + (numeric(item.revenue_total) ?? 0), 0), invoices: invoices.length }; } catch (error) { console.error(JSON.stringify({ event: "pilotage_invoices_failed", message: error instanceof Error ? error.message : "unknown" })); }
  }

  const settingsMap = new Map(settings.map((item) => [item.sector_key, item]));
  const objectiveMap = new Map(objectives.map((item) => [item.sectorKey, item]));
  const plans = Object.entries(productionNames).map(([sectorKey, label]) => {
    const actual = snapshot.production.find((item) => item.name === label)?.value ?? (sectorKey === "sortie_usine" ? snapshot.exits : 0);
    const target = Math.max(0, Number(objectiveMap.get(sectorKey)?.dailyTarget ?? fallbackTargets[sectorKey] ?? 0));
    const gap = Math.max(target - actual, 0);
    const candidates = workload.filter((item) => item.sector_key === sectorKey);
    const setting = settingsMap.get(sectorKey) ?? { sector_key: sectorKey, fifo_share: .7, run_max_minutes: 60, critical_age_days: 20 };
    const recommendation = choosePlan(candidates, gap, setting);
    const oldest = [...candidates].sort((a, b) => (numeric(b.age_days) ?? 0) - (numeric(a.age_days) ?? 0)).slice(0, 10);
    const highTimeOld = oldest.filter((item) => numeric(item.remaining_minutes) != null && (numeric(item.remaining_minutes) ?? 0) > Number(setting.run_max_minutes || 60)).length;
    const runPool = candidates.filter((item) => (numeric(item.remaining_minutes) ?? 0) > 0 && (numeric(item.remaining_minutes) ?? Infinity) <= Number(setting.run_max_minutes || 60)).length;
    const remainingMinutes = candidates.reduce((sum, item) => sum + (numeric(item.remaining_minutes) ?? 0), 0);
    const potentialRevenue = candidates.reduce((sum, item) => sum + (numeric(item.potential_revenue_total) ?? 0), 0);
    return { sectorKey, label, actual, target, gap, attainment: target > 0 ? Math.round(actual / target * 100) : 0, queue: candidates.length, workloadReady: candidates.some((item) => numeric(item.remaining_minutes) != null), runMaxMinutes: Number(setting.run_max_minutes || 60), fifoShare: Number(setting.fifo_share || .7), highTimeOld, runPool, remainingHours: remainingMinutes / 60, potentialRevenue, oldest, recommendation };
  });

  const major = plans.filter((item) => item.target > 0 && item.gap > 0).sort((a, b) => (a.attainment - b.attainment) || (b.gap - a.gap)).slice(0, 5);
  const uniqueOrders = new Set(workload.map((item) => item.work_order).filter(Boolean));
  const workloadSummary = { workOrders: uniqueOrders.size, remainingHours: workload.reduce((sum, item) => sum + (numeric(item.remaining_minutes) ?? 0), 0) / 60, potentialRevenue: workload.reduce((sum, item) => sum + (numeric(item.potential_revenue_total) ?? 0), 0) };

  return NextResponse.json({ snapshot, dataConnected, workloadSnapshot, sources: { sftp: dataConnected, workloadSql: workload.length > 0, workloadTime: workload.some((item) => numeric(item.remaining_minutes) != null), invoicesSql: invoiceToday.invoices > 0 }, invoiceToday, workloadSummary, major, plans, methodology: { fifo: "Les dossiers les plus anciens restent prioritaires.", run: "Une part de dossiers courts est injectée lorsque le FIFO seul met en risque le volume du jour.", defaultFifoShare: .7, defaultRunMaxMinutes: 60 } }, { headers: { "Cache-Control": "no-store" } });
}
