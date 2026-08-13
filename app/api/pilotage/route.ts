import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FUNCTION_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-operational-live";
const FIFO_FUNCTION_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-fifo-live";
const ANON_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2bWtodmZtZHN0a3Vud3d1enV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTU4NjQsImV4cCI6MjEwMjAzMTg2NH0.w18MDX_dL1YarUElTeo9ID0Egivav18tVqjjbkCaOxc";

type Vehicle = {
  registration: string;
  work_order: string | null;
  client: null;
  vin: null;
  status: string | null;
  primary_activity: string | null;
  alert: string | null;
  urgency: string | null;
  factory_age_days: number | null;
  age_days: number | null;
  remaining_minutes: number | null;
  estimated_total_minutes: null;
  potential_revenue_total: null;
};
type Queue = { fifo: Vehicle[]; run: Vehicle[]; count: number };
type FifoRow = {
  sector_key: string;
  sector_label: string;
  registration: string | null;
  work_order: string | null;
  status: string | null;
  alert: string | null;
  urgency: string | null;
  status_age_days: number | string | null;
  factory_age_days: number | string | null;
  fifo_age_days: number | string | null;
};
type FifoPayload = { ok: boolean; rows: number; queues: Record<string,{count:number;fifo:FifoRow[]}> };
type OperationalPayload = {
  ok: boolean;
  snapshot: { date:string; label:string; source:string; exits:number; stock:number; production:Array<{name:string;value:number}> };
  freshness: { refreshAt:string|null; depositAt:string|null; depositFilename:string|null; vehicleStateLoadedAt:string|null };
  operationalCount: number;
  alertCount: number;
  queues: Record<string, Queue>;
  leadTime: { source_modified_at?:string|null; vehicle_count?:number|string|null; avg_factory_days?:number|string|null; median_factory_days?:number|string|null; avg_storage_days?:number|string|null; avg_parts_days?:number|string|null; vop_eff_count?:number|string|null; vop_ext_count?:number|string|null } | null;
};

const targets: Record<string, number> = { expertise:90, dsp:48, mecanique:85, carrosserie:63, preparation:90, qualite:90, sortie_usine:92 };
const labels: Record<string, string> = { expertise:"Expertise", dsp:"DSP", mecanique:"Mécanique", carrosserie:"Carrosserie", preparation:"Préparation", qualite:"Qualité", sortie_usine:"Sortie usine" };

function actualFor(snapshot: OperationalPayload["snapshot"], key: string) {
  const label = labels[key];
  return snapshot.production.find((item) => item.name === label)?.value ?? (key === "sortie_usine" ? snapshot.exits : 0);
}
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function vehicleFromFifo(row:FifoRow):Vehicle {
  const age = num(row.fifo_age_days) ?? num(row.factory_age_days) ?? num(row.status_age_days);
  const alert = row.alert ? String(row.alert) : null;
  return {
    registration: String(row.registration ?? ""),
    work_order: row.work_order ? String(row.work_order) : null,
    client:null,
    vin:null,
    status:row.status ? String(row.status) : null,
    primary_activity:alert ? `À faire : ${alert}` : row.status ? String(row.status) : null,
    alert,
    urgency:row.urgency ? String(row.urgency) : null,
    factory_age_days:num(row.factory_age_days),
    age_days:age,
    remaining_minutes:null,
    estimated_total_minutes:null,
    potential_revenue_total:null,
  };
}
async function edge<T>(url:string):Promise<T>{
  const response = await fetch(url,{headers:{Authorization:`Bearer ${ANON_JWT}`,apikey:ANON_JWT,Accept:"application/json"},cache:"no-store"});
  if(!response.ok) throw new Error(`Edge ${response.status}`);
  return response.json() as Promise<T>;
}

export async function GET() {
  try {
    const [data,fifoData] = await Promise.all([
      edge<OperationalPayload>(FUNCTION_URL),
      edge<FifoPayload>(FIFO_FUNCTION_URL),
    ]);
    const plans = Object.keys(labels).map((sectorKey) => {
      const label = labels[sectorKey];
      const actual = actualFor(data.snapshot, sectorKey);
      const target = targets[sectorKey];
      const gap = Math.max(target - actual, 0);
      const liveFifo = fifoData.queues?.[sectorKey];
      const edgeQueue = data.queues[sectorKey] ?? { fifo: [], run: [], count: 0 };
      const fifoCandidates = liveFifo?.fifo?.length ? liveFifo.fifo.map(vehicleFromFifo) : (edgeQueue.fifo ?? []);
      const queueCount = liveFifo?.count ?? edgeQueue.count ?? fifoCandidates.length;
      const runCandidates = edgeQueue.run ?? [];
      const timeReady = runCandidates.some((item) => item.remaining_minutes != null);
      const recommendation = fifoCandidates.slice(0, Math.max(gap, 0)).map((item, index) => ({
        ...item,
        strategy: "FIFO" as const,
        reason: `FIFO EtatduParc · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j${item.alert ? ` · ${item.alert}` : ""}`,
        rank: index + 1,
      }));
      return {
        sectorKey, label, actual, target, gap,
        attainment: target > 0 ? Math.round(actual / target * 100) : 0,
        queue: queueCount,
        workloadReady: queueCount > 0,
        timeReady,
        runMaxMinutes: 60,
        fifoShare: 1,
        highTimeOld: 0,
        runPool: runCandidates.length,
        remainingHours: runCandidates.reduce((sum, item) => sum + (item.remaining_minutes ?? 0), 0) / 60,
        potentialRevenue: 0,
        oldest: fifoCandidates,
        fifoCandidates,
        runCandidates,
        recommendation,
      };
    });
    const major = plans.filter((item) => item.gap > 0).sort((a,b) => a.attainment - b.attainment || b.gap - a.gap).slice(0,5);
    const lead = data.leadTime;

    return NextResponse.json({
      snapshot: data.snapshot,
      dataConnected: true,
      workloadSnapshot: data.snapshot.date,
      ftpVehicleSnapshot: data.snapshot.date,
      ftpVehicleLoadedAt: data.freshness.vehicleStateLoadedAt,
      productionMode: "ftp",
      sources: { ftp:true,sftp:false,production:"ftp",workloadFtp:fifoData.rows>0,workloadSql:false,workloadTime:plans.some((item)=>item.timeReady),alertsFtp:data.alertCount>0,invoicesSql:false,financeBook:false },
      invoiceToday: { revenue:0, invoices:0, available:false, source:"none" },
      workloadSummary: { workOrders:data.operationalCount, remainingHours:0, potentialRevenue:0 },
      major,
      plans,
      fifoRowsLoaded: fifoData.rows,
      ftpRefresh: { lastRefreshAt:data.freshness.refreshAt,lastDepositAt:data.freshness.depositAt,lastDepositFilename:data.freshness.depositFilename },
      leadTime: lead ? { available:true,sourceModifiedAt:lead.source_modified_at??null,vehicleCount:num(lead.vehicle_count)??0,avgFactoryDays:num(lead.avg_factory_days),medianFactoryDays:num(lead.median_factory_days),avgStorageDays:num(lead.avg_storage_days),avgPartsDays:num(lead.avg_parts_days),vopEffCount:num(lead.vop_eff_count)??0,vopExtCount:num(lead.vop_ext_count)??0,historyReady:true,latestHistoryEventDate:data.snapshot.date,latestHistoryEventTime:null } : null,
      methodology: { fifo:"FIFO par secteur issu d'EtatduParc, trié sur l'ancienneté usine ; Alerte alimente chaque secteur restant à réaliser.",run:"RUN reste en attente d'un temps fiable par dossier ; aucune durée n'est inventée." },
    }, { headers: { "Cache-Control": "public, max-age=45, stale-while-revalidate=60" } });
  } catch (error) {
    console.error(JSON.stringify({ event:"pilotage_live_failed", message:error instanceof Error?error.message:"unknown" }));
    return NextResponse.json({ error:"Pilotage live indisponible." }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}
