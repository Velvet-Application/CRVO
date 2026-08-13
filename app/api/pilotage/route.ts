import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FUNCTION_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co/functions/v1/kpi-operational-live";
const ANON_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXAiLCJyZWYiOiJ0dm1raHZmbWRzdGt1bnd3dXp1eiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg2NDU1ODY0LCJleHAiOjIxMDIwMzE4NjR9.w18MDX_dL1YarUElTeo9ID0Egivav18tVqjjbkCaOxc";

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
type OperationalPayload = {
  ok: boolean;
  snapshot: { date:string; label:string; source:string; exits:number; stock:number; production:Array<{name:string;value:number}> };
  freshness: { refreshAt:string|null; depositAt:string|null; depositFilename:string|null; vehicleStateLoadedAt:string|null };
  operationalCount: number;
  alertCount: number;
  queues: Record<string, Queue>;
  leadTime: { avg_factory_days?:number|string|null; median_factory_days?:number|string|null } | null;
};

const targets: Record<string, number> = { expertise:90, dsp:48, mecanique:85, carrosserie:63, preparation:90, qualite:90, sortie_usine:92 };
const labels: Record<string, string> = { expertise:"Expertise", dsp:"DSP", mecanique:"Mécanique", carrosserie:"Carrosserie", preparation:"Préparation", qualite:"Qualité", sortie_usine:"Sortie usine" };

function actualFor(snapshot: OperationalPayload["snapshot"], key: string) {
  const label = labels[key];
  return snapshot.production.find((item) => item.name === label)?.value ?? (key === "sortie_usine" ? snapshot.exits : 0);
}

async function live() {
  const response = await fetch(FUNCTION_URL, {
    headers: { Authorization: `Bearer ${ANON_JWT}`, apikey: ANON_JWT, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Operational live ${response.status}`);
  return response.json() as Promise<OperationalPayload>;
}

export async function GET() {
  try {
    const data = await live();
    const plans = Object.keys(labels).map((sectorKey) => {
      const label = labels[sectorKey];
      const actual = actualFor(data.snapshot, sectorKey);
      const target = targets[sectorKey];
      const gap = Math.max(target - actual, 0);
      const queue = data.queues[sectorKey] ?? { fifo: [], run: [], count: 0 };
      const fifoCandidates = queue.fifo ?? [];
      const runCandidates = queue.run ?? [];
      const timeReady = runCandidates.some((item) => item.remaining_minutes != null);
      const recommendation = fifoCandidates.slice(0, Math.max(gap, 0)).map((item, index) => ({
        ...item,
        strategy: "FIFO" as const,
        reason: `FIFO FTP · ${item.age_days?.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) ?? "?"} j${item.alert ? ` · ${item.alert}` : ""}`,
        rank: index + 1,
      }));
      return {
        sectorKey, label, actual, target, gap,
        attainment: target > 0 ? Math.round(actual / target * 100) : 0,
        queue: queue.count ?? fifoCandidates.length,
        workloadReady: (queue.count ?? 0) > 0,
        timeReady,
        runMaxMinutes: 60,
        fifoShare: .7,
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

    return NextResponse.json({
      snapshot: data.snapshot,
      dataConnected: true,
      workloadSnapshot: data.snapshot.date,
      ftpVehicleSnapshot: data.snapshot.date,
      ftpVehicleLoadedAt: data.freshness.vehicleStateLoadedAt,
      productionMode: "ftp",
      sources: {
        ftp: true,
        sftp: false,
        production: "ftp",
        workloadFtp: true,
        workloadSql: false,
        workloadTime: plans.some((item) => item.timeReady),
        alertsFtp: data.alertCount > 0,
        invoicesSql: false,
        financeBook: false,
      },
      invoiceToday: { revenue:0, invoices:0, available:false, source:"none" },
      workloadSummary: { workOrders:data.operationalCount, remainingHours:0, potentialRevenue:0 },
      major,
      plans,
      ftpRefresh: {
        lastRefreshAt: data.freshness.refreshAt,
        lastDepositAt: data.freshness.depositAt,
        lastDepositFilename: data.freshness.depositFilename,
      },
      leadTime: data.leadTime,
      methodology: {
        fifo: "FIFO calculé depuis EtatduParc sur l’ancienneté usine ; l’alerte FTP indique le prochain passage attendu.",
        run: "RUN affiché uniquement lorsqu’une durée explicite <= 60 min est présente dans l’alerte FTP ; le temps SQL complètera ce calcul.",
      },
    }, { headers: { "Cache-Control": "public, max-age=45, stale-while-revalidate=60" } });
  } catch (error) {
    console.error(JSON.stringify({ event:"pilotage_live_failed", message:error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ error:"Pilotage live indisponible." }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}
