import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

const SECTOR_LABELS: Record<string, string> = {
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
  photo: "Photo",
  sortie_usine: "Sortie usine",
  anomalie: "Parc anomalie",
};

type Vehicle = {
  registration: string | null;
  work_order: string | null;
  client: string | null;
  status: string | null;
  effective_factory_age_days: number | string | null;
  received_date: string | null;
  alert: string | null;
  urgency: string | null;
  part_available: string | null;
  pending_sector_keys: string[] | null;
  current_sector_key: string | null;
  blocking_cause: string | null;
  priority_score: number | string | null;
  data_anomaly: boolean | null;
  is_bmw_france: boolean | null;
  piece_ready: boolean | null;
  latest_source_modified_at: string | null;
};

type Bottleneck = {
  snapshot_date: string;
  sector_key: string;
  sector_label: string;
  vehicle_count: number | string;
  source_modified_at: string | null;
  frozen_at: string | null;
};

type Flow = {
  sector_key: string;
  entries_24h: number | string;
  outputs_24h: number | string;
  net_24h: number | string;
};

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isUrgent(vehicle: Vehicle) {
  return String(vehicle.urgency ?? "").trim().toLowerCase() === "oui" || /urgence/i.test(String(vehicle.alert ?? ""));
}

function hasPending(vehicle: Vehicle, sector: string) {
  return (vehicle.pending_sector_keys ?? []).includes(sector);
}

function isActionableFor(vehicle: Vehicle, sector: string) {
  if (vehicle.current_sector_key === "anomalie") return false;
  if (sector === "mecanique") return vehicle.piece_ready === true;
  return true;
}

function businessPriority(vehicle: Vehicle) {
  const age = n(vehicle.effective_factory_age_days);
  const tier = isUrgent(vehicle) ? 1 : vehicle.is_bmw_france ? 2 : 3;
  return { tier, age };
}

function compareBusinessPriority(a: Vehicle, b: Vehicle) {
  const pa = businessPriority(a);
  const pb = businessPriority(b);
  if (pa.tier !== pb.tier) return pa.tier - pb.tier;
  return pb.age - pa.age;
}

async function rest<T>(path: string): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json() as Promise<T>;
}

async function restAll<T>(path: string, max = 5000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const separator = path.includes("?") ? "&" : "?";
    const chunk = await rest<T[]>(`${path}${separator}limit=1000&offset=${offset}`);
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return rows;
}

function latestAndPrevious(rows: Bottleneck[]) {
  const dates = [...new Set(rows.map((row) => row.snapshot_date))].sort().reverse();
  const latestDate = dates[0] ?? null;
  const previousDate = dates[1] ?? null;
  const latest = new Map(rows.filter((row) => row.snapshot_date === latestDate).map((row) => [row.sector_key, n(row.vehicle_count)]));
  const previous = new Map(rows.filter((row) => row.snapshot_date === previousDate).map((row) => [row.sector_key, n(row.vehicle_count)]));
  return { latestDate, previousDate, latest, previous };
}

export async function GET() {
  try {
    const vehicleSelect = [
      "registration",
      "work_order",
      "client",
      "status",
      "effective_factory_age_days",
      "received_date",
      "alert",
      "urgency",
      "part_available",
      "pending_sector_keys",
      "current_sector_key",
      "blocking_cause",
      "priority_score",
      "data_anomaly",
      "is_bmw_france",
      "piece_ready",
      "latest_source_modified_at",
    ].join(",");

    const [vehicles, bottlenecks, flows, dashboard] = await Promise.all([
      restAll<Vehicle>(`kpi_intelligence_vehicle_public?select=${vehicleSelect}`, 5000),
      rest<Bottleneck[]>("kpi_bottleneck_daily_public?select=snapshot_date,sector_key,sector_label,vehicle_count,source_modified_at,frozen_at&order=snapshot_date.desc&limit=200"),
      rest<Flow[]>("kpi_intelligence_sector_flow_public?select=sector_key,entries_24h,outputs_24h,net_24h"),
      rest<Array<{ snapshot_at: string; metrics: Record<string, number>; source_modified_at: string | null }>>("kpi_ftp_live_dashboard?select=snapshot_at,metrics,source_modified_at&limit=1"),
    ]);

    const { latestDate, previousDate, latest, previous } = latestAndPrevious(bottlenecks);
    const flowMap = new Map(flows.map((row) => [row.sector_key, row]));
    const metrics = dashboard[0]?.metrics ?? {};
    const sourceModifiedAt = vehicles.map((vehicle) => vehicle.latest_source_modified_at).filter(Boolean).sort().at(-1) ?? dashboard[0]?.source_modified_at ?? null;

    const sectorEvolution = [...latest.entries()].map(([key, current]) => {
      const before = previous.get(key) ?? current;
      const delta = current - before;
      const pct = before > 0 ? Math.round((delta / before) * 100) : delta > 0 ? 100 : 0;
      return { key, label: SECTOR_LABELS[key] ?? key, current, previous: before, delta, pct };
    }).sort((a, b) => b.delta - a.delta);

    const prepVehicles = vehicles.filter((vehicle) => hasPending(vehicle, "preparation"));
    const prepCurrent = vehicles.filter((vehicle) => vehicle.current_sector_key === "preparation");
    const prepFlow = flowMap.get("preparation");
    const prepEvolution = sectorEvolution.find((row) => row.key === "preparation");

    const bodyVehicles = vehicles.filter((vehicle) => hasPending(vehicle, "carrosserie"));
    const bodyActionable = bodyVehicles.filter((vehicle) => isActionableFor(vehicle, "carrosserie"));
    const bodyAges = bodyVehicles.map((vehicle) => n(vehicle.effective_factory_age_days)).filter((value) => value >= 0);
    const bodyFlow = flowMap.get("carrosserie");
    const bodyEvolution = sectorEvolution.find((row) => row.key === "carrosserie");

    const bmwVehicles = vehicles.filter((vehicle) => vehicle.is_bmw_france === true);
    const bmwAges = bmwVehicles.map((vehicle) => n(vehicle.effective_factory_age_days)).filter((value) => value >= 0);
    const bmwOldest = [...bmwVehicles].sort((a, b) => n(b.effective_factory_age_days) - n(a.effective_factory_age_days)).slice(0, 10).map((vehicle) => ({
      registration: vehicle.registration,
      workOrder: vehicle.work_order,
      ageDays: round(n(vehicle.effective_factory_age_days)),
      status: vehicle.status,
      pending: vehicle.pending_sector_keys ?? [],
      alert: vehicle.alert,
      breach: n(vehicle.effective_factory_age_days) >= 20,
      nearBreach: n(vehicle.effective_factory_age_days) >= 16 && n(vehicle.effective_factory_age_days) < 20,
    }));

    const anomalyVehicles = vehicles.filter((vehicle) => vehicle.current_sector_key === "anomalie" || /anomal/i.test(String(vehicle.alert ?? "")));
    const missingEntryDate = vehicles.filter((vehicle) => vehicle.data_anomaly === true).length;
    const over10 = vehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) > 10).length;
    const over20 = vehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) >= 20).length;

    const rankedVehicles = [...vehicles].sort(compareBusinessPriority).slice(0, 20).map((vehicle) => ({
      registration: vehicle.registration,
      workOrder: vehicle.work_order,
      client: vehicle.client,
      ageDays: round(n(vehicle.effective_factory_age_days)),
      status: vehicle.status,
      currentSector: vehicle.current_sector_key,
      pending: vehicle.pending_sector_keys ?? [],
      alert: vehicle.alert,
      urgent: isUrgent(vehicle),
      bmw: vehicle.is_bmw_france === true,
      priorityReason: isUrgent(vehicle) ? "Urgence" : vehicle.is_bmw_france ? "BMW France" : n(vehicle.effective_factory_age_days) > 10 ? "FIFO · >10 jours" : "FIFO réception usine",
    }));

    const alertCandidates: Array<{ key: string; level: "critique" | "tension" | "info"; score: number; title: string; detail: string }> = [];

    for (const evolution of sectorEvolution.filter((row) => row.delta > 0).slice(0, 6)) {
      const strategic = evolution.key === "preparation" || evolution.key === "controle_technique" || evolution.key === "carrosserie" || evolution.key === "parc_travaux";
      const level = evolution.pct >= 15 || evolution.delta >= 20 ? "critique" : "tension";
      alertCandidates.push({
        key: `growth-${evolution.key}`,
        level,
        score: (strategic ? 250 : 150) + Math.max(0, evolution.delta) * 4 + Math.max(0, evolution.pct),
        title: `${evolution.label} augmente`,
        detail: `${evolution.current} véhicules · ${evolution.delta > 0 ? "+" : ""}${evolution.delta} vs dernière photo (${evolution.pct > 0 ? "+" : ""}${evolution.pct} %).`,
      });
    }

    const prepTarget = 90;
    const prepCoverage = prepCurrent.length / prepTarget;
    if (prepCoverage < 0.65) {
      alertCandidates.push({
        key: "prep-buffer",
        level: prepCoverage < 0.35 ? "critique" : "tension",
        score: prepCoverage < 0.35 ? 950 : 700,
        title: "Préparation à sécuriser",
        detail: `${prepCurrent.length} véhicules actuellement en préparation pour un repère de ${prepTarget} sorties de secteur / jour. Une prépa vide met directement les sorties usine en risque.`,
      });
    }

    if (anomalyVehicles.length > 0) {
      alertCandidates.push({
        key: "anomaly-pool",
        level: anomalyVehicles.length >= 20 ? "critique" : "tension",
        score: 650 + anomalyVehicles.length * 6,
        title: "Parc anomalie à traiter",
        detail: `${anomalyVehicles.length} véhicule(s) actuellement identifiés avec une anomalie ou une information anomalie.`,
      });
    }

    const bmwBreach = bmwVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) >= 20).length;
    const bmwNear = bmwVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) >= 16 && n(vehicle.effective_factory_age_days) < 20).length;
    if (bmwBreach || bmwNear) {
      alertCandidates.push({
        key: "bmw-sla",
        level: bmwBreach ? "critique" : "tension",
        score: 850 + bmwBreach * 100 + bmwNear * 30,
        title: "BMW France · LT <20 j à sécuriser",
        detail: `${bmwBreach} dossier(s) à 20 j ou plus · ${bmwNear} dossier(s) entre 16 et 19 j.`,
      });
    }

    const bodyOver10 = bodyVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) > 10).length;
    if (bodyOver10 > 0) {
      alertCandidates.push({
        key: "bodywork-pressure",
        level: bodyOver10 >= 50 ? "critique" : "tension",
        score: 800 + bodyOver10 * 3,
        title: "Carrosserie · pression prioritaire",
        detail: `${bodyVehicles.length} dossiers concernés · ${bodyOver10} au-delà de 10 j · ${bodyActionable.length} actionnables hors contrainte pièces.`,
      });
    }

    const managerialAlerts = alertCandidates.sort((a, b) => b.score - a.score).slice(0, 5).map((item, index) => ({ ...item, rank: index + 1 }));

    return NextResponse.json({
      connected: true,
      generatedAt: new Date().toISOString(),
      sourceModifiedAt,
      businessRulesVersion: "2026-08-14-v1",
      scope: {
        start: "Réception usine / attente expertise dynamique",
        end: "Sortie usine",
        fifo: "Réception usine",
        fifoExceptions: ["Urgence", "BMW France"],
        concernAgeDays: 10,
      },
      summary: {
        activeVehicles: vehicles.length,
        over10,
        over20,
        anomalyVehicles: anomalyVehicles.length,
        missingEntryDate,
      },
      managerialAlerts,
      bottlenecks: {
        latestDate,
        previousDate,
        evolution: sectorEvolution,
      },
      preparation: {
        current: prepCurrent.length,
        pipeline: prepVehicles.length,
        over10: prepVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) > 10).length,
        over20: prepVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) >= 20).length,
        entries24h: n(prepFlow?.entries_24h),
        outputs24h: n(prepFlow?.outputs_24h),
        net24h: n(prepFlow?.net_24h),
        deltaVsPrevious: prepEvolution?.delta ?? 0,
        outputReference: prepTarget,
        bufferCoveragePct: Math.round(prepCoverage * 100),
      },
      bodywork: {
        current: latest.get("carrosserie") ?? vehicles.filter((vehicle) => vehicle.current_sector_key === "carrosserie").length,
        pending: bodyVehicles.length,
        actionable: bodyActionable.length,
        over10: bodyOver10,
        over20: bodyVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) >= 20).length,
        averageAge: round(avg(bodyAges)),
        medianAge: round(median(bodyAges)),
        entries24h: n(bodyFlow?.entries_24h),
        outputs24h: n(bodyFlow?.outputs_24h),
        net24h: n(bodyFlow?.net_24h),
        deltaVsPrevious: bodyEvolution?.delta ?? 0,
        cadenceReference: 50,
        productionTarget: 63,
        topFifo: [...bodyActionable].sort(compareBusinessPriority).slice(0, 10).map((vehicle) => ({
          registration: vehicle.registration,
          workOrder: vehicle.work_order,
          client: vehicle.client,
          ageDays: round(n(vehicle.effective_factory_age_days)),
          status: vehicle.status,
          alert: vehicle.alert,
          urgent: isUrgent(vehicle),
          bmw: vehicle.is_bmw_france === true,
        })),
      },
      bmw: {
        targetLeadTimeDays: 20,
        vehicles: bmwVehicles.length,
        averageAge: round(avg(bmwAges)),
        medianAge: round(median(bmwAges)),
        age0_9: bmwVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) < 10).length,
        age10_15: bmwVehicles.filter((vehicle) => n(vehicle.effective_factory_age_days) >= 10 && n(vehicle.effective_factory_age_days) < 16).length,
        age16_19: bmwNear,
        age20Plus: bmwBreach,
        missingEntryDate: bmwVehicles.filter((vehicle) => vehicle.data_anomaly === true).length,
        oldest: bmwOldest,
      },
      priorities: rankedVehicles,
      dataQuality: {
        missingEntryDate,
        message: "Une date de réception usine absente est considérée comme une anomalie de donnée. Le temps sans mouvement n'est pas utilisé comme signal métier de blocage.",
      },
      liveMetrics: {
        stock: n(metrics.factory_stock),
        entries: n(metrics.entries_vop),
        exits: n(metrics.exits_vop),
        preparation: n(metrics.production_preparation),
        factoryExit: n(metrics.production_factory_exit),
      },
    }, { headers: { "Cache-Control": "public, max-age=45, stale-while-revalidate=60" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "cockpit_v2_managerial_failed", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ connected: false, error: "Analyse managériale temporairement indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
