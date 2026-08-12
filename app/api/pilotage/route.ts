import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Production = { name: string; value: number; tone: string };
type Snapshot = { date: string; label: string; entries: number; exits: number; stock: number; over15: number; over20: number; production: Production[] };
type Objective = { sectorKey: string; sectorLabel: string; dailyTarget: number; minThreshold: number | null; maxThreshold: number | null };
type Workload = {
  registration: string;
  work_order: string | null;
  client: string | null;
  sector_key: string;
  sector_label: string;
  status: string | null;
  age_days: number | null;
  remaining_minutes: number | null;
  estimated_total_minutes: number | null;
};
type Setting = { sector_key: string; fifo_share: number; run_max_minutes: number; critical_age_days: number };

type Recommendation = Workload & {
  strategy: "FIFO" | "RUN";
  reason: string;
  rank: number;
};

const productionNames: Record<string, string> = {
  expertise: "Expertise",
  chiffrage: "Chiffrage",
  controle_technique: "Contrôle technique",
  dsp: "DSP",
  jantes: "Jantes",
  mecanique: "Mécanique",
  carrosserie: "Carrosserie",
  parc_travaux: "Parc travaux",
  preparation: "Préparation",
  qualite: "Qualité",
  sortie_usine: "Sortie usine",
};

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function headers(key: string) {
  const value: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (key.startsWith("eyJ")) value.Authorization = `Bearer ${key}`;
  return value;
}

async function rest<T>(url: string, key: string, path: string): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers: headers(key), cache: "no-store" });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json() as Promise<T>;
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function choosePlan(candidates: Workload[], gap: number, setting: Setting) {
  if (gap <= 0 || !candidates.length) return [] as Recommendation[];

  const normalized = candidates.map((item) => ({
    ...item,
    age_days: numeric(item.age_days),
    remaining_minutes: numeric(item.remaining_minutes),
    estimated_total_minutes: numeric(item.estimated_total_minutes),
  }));

  const oldest = [...normalized].sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));
  const withTime = normalized.filter((item) => item.remaining_minutes != null);

  if (!withTime.length) {
    return oldest.slice(0, gap).map((item, index) => ({
      ...item,
      strategy: "FIFO" as const,
      reason: `FIFO · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j sur le statut`,
      rank: index + 1,
    }));
  }

  const fifoWanted = Math.min(gap, Math.max(1, Math.ceil(gap * Number(setting.fifo_share || .7))));
  const selected: Recommendation[] = oldest.slice(0, fifoWanted).map((item) => ({
    ...item,
    strategy: "FIFO" as const,
    reason: `FIFO · ancienneté ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j${item.remaining_minutes != null ? ` · ${Math.round(item.remaining_minutes)} min restantes` : ""}`,
    rank: 0,
  }));
  const used = new Set(selected.map((item) => `${item.registration}|${item.work_order ?? ""}`));
  const slots = gap - selected.length;

  if (slots > 0) {
    const runs = normalized
      .filter((item) => !used.has(`${item.registration}|${item.work_order ?? ""}`))
      .filter((item) => item.remaining_minutes != null && item.remaining_minutes <= Number(setting.run_max_minutes || 60))
      .sort((a, b) => (a.remaining_minutes ?? Infinity) - (b.remaining_minutes ?? Infinity) || (b.age_days ?? 0) - (a.age_days ?? 0))
      .slice(0, slots)
      .map((item) => ({
        ...item,
        strategy: "RUN" as const,
        reason: `RUN · ${Math.round(item.remaining_minutes ?? 0)} min restantes · sécurise le volume du jour`,
        rank: 0,
      }));
    selected.push(...runs);
    runs.forEach((item) => used.add(`${item.registration}|${item.work_order ?? ""}`));
  }

  if (selected.length < gap) {
    selected.push(...oldest
      .filter((item) => !used.has(`${item.registration}|${item.work_order ?? ""}`))
      .slice(0, gap - selected.length)
      .map((item) => ({ ...item, strategy: "FIFO" as const, reason: "FIFO complémentaire · aucun RUN court disponible", rank: 0 })));
  }

  return selected.map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const [dashboardResponse, objectivesResponse] = await Promise.all([
    fetch(`${origin}/api/dashboard?history=1`, { cache: "no-store" }),
    fetch(`${origin}/api/objectives`, { cache: "no-store" }),
  ]);
  const dashboard = dashboardResponse.ok ? await dashboardResponse.json() as { snapshot?: Snapshot; snapshots?: Snapshot[] } : {};
  const snapshot = dashboard.snapshots?.at(-1) ?? dashboard.snapshot;
  if (!snapshot) return NextResponse.json({ error: "Aucune donnée de production disponible." }, { status: 503 });

  const month = snapshot.date.slice(0, 7);
  const monthObjectivesResponse = await fetch(`${origin}/api/objectives?month=${month}`, { cache: "no-store" });
  const objectivePayload = monthObjectivesResponse.ok ? await monthObjectivesResponse.json() as { objectives?: Objective[] } : (objectivesResponse.ok ? await objectivesResponse.json() as { objectives?: Objective[] } : {});
  const objectives = objectivePayload.objectives ?? [];

  const cfg = config();
  let workload: Workload[] = [];
  let settings: Setting[] = [];
  let invoiceToday = { revenue: 0, invoices: 0 };
  let workloadSnapshot: string | null = null;
  let dataConnected = false;

  if (cfg) {
    try {
      const dates = await rest<Array<{ snapshot_at: string }>>(cfg.url, cfg.key, "kpi_vehicle_workload?select=snapshot_at&order=snapshot_at.desc&limit=1");
      workloadSnapshot = dates[0]?.snapshot_at ?? null;
      if (workloadSnapshot) {
        workload = await rest<Workload[]>(cfg.url, cfg.key, `kpi_vehicle_workload?select=registration,work_order,client,sector_key,sector_label,status,age_days,remaining_minutes,estimated_total_minutes&snapshot_at=eq.${encodeURIComponent(workloadSnapshot)}&limit=5000`);
      }
      settings = await rest<Setting[]>(cfg.url, cfg.key, "kpi_pilotage_settings?select=sector_key,fifo_share,run_max_minutes,critical_age_days");
      const invoices = await rest<Array<{ revenue_total: number | null }>>(cfg.url, cfg.key, `kpi_invoice_facts?select=revenue_total&invoice_date=eq.${snapshot.date}&limit=5000`);
      invoiceToday = { revenue: invoices.reduce((sum, item) => sum + (numeric(item.revenue_total) ?? 0), 0), invoices: invoices.length };
      dataConnected = true;
    } catch (error) {
      console.error(JSON.stringify({ event: "pilotage_data_failed", message: error instanceof Error ? error.message : "unknown" }));
    }
  }

  const settingsMap = new Map(settings.map((item) => [item.sector_key, item]));
  const objectiveMap = new Map(objectives.map((item) => [item.sectorKey, item]));
  const plans = Object.entries(productionNames).map(([sectorKey, label]) => {
    const actual = snapshot.production.find((item) => item.name === label)?.value ?? (sectorKey === "sortie_usine" ? snapshot.exits : 0);
    const target = Math.max(0, Number(objectiveMap.get(sectorKey)?.dailyTarget ?? 0));
    const gap = Math.max(target - actual, 0);
    const candidates = workload.filter((item) => item.sector_key === sectorKey);
    const setting = settingsMap.get(sectorKey) ?? { sector_key: sectorKey, fifo_share: .7, run_max_minutes: 60, critical_age_days: 20 };
    const recommendation = choosePlan(candidates, gap, setting);
    const highTimeOld = [...candidates]
      .sort((a, b) => (numeric(b.age_days) ?? 0) - (numeric(a.age_days) ?? 0))
      .slice(0, 10)
      .filter((item) => numeric(item.remaining_minutes) != null && (numeric(item.remaining_minutes) ?? 0) > Number(setting.run_max_minutes || 60)).length;
    const runPool = candidates.filter((item) => numeric(item.remaining_minutes) != null && (numeric(item.remaining_minutes) ?? Infinity) <= Number(setting.run_max_minutes || 60)).length;
    const oldest = [...candidates].sort((a, b) => (numeric(b.age_days) ?? 0) - (numeric(a.age_days) ?? 0)).slice(0, 10);
    return {
      sectorKey,
      label,
      actual,
      target,
      gap,
      attainment: target > 0 ? Math.round(actual / target * 100) : 0,
      queue: candidates.length,
      workloadReady: candidates.some((item) => numeric(item.remaining_minutes) != null),
      runMaxMinutes: Number(setting.run_max_minutes || 60),
      fifoShare: Number(setting.fifo_share || .7),
      highTimeOld,
      runPool,
      oldest,
      recommendation,
    };
  });

  const major = plans
    .filter((item) => item.target > 0 && item.gap > 0)
    .sort((a, b) => (a.attainment - b.attainment) || (b.gap - a.gap))
    .slice(0, 5);

  return NextResponse.json({
    snapshot,
    dataConnected,
    workloadSnapshot,
    sources: {
      sftp: true,
      workloadSql: workload.length > 0,
      workloadTime: workload.some((item) => numeric(item.remaining_minutes) != null),
      invoicesSql: invoiceToday.invoices > 0,
    },
    invoiceToday,
    major,
    plans,
    methodology: {
      fifo: "Les dossiers les plus anciens restent prioritaires.",
      run: "Une part de dossiers courts est injectée lorsque le FIFO seul met en risque le volume du jour.",
      defaultFifoShare: .7,
      defaultRunMaxMinutes: 60,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
