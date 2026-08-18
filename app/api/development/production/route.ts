import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";
// Read-only digital twin: refreshed from the latest certified EtatduParc FTP snapshot.

type VehicleRow = {
  snapshot_at: string | null;
  source_modified_at: string | null;
  registration: string | null;
  work_order: string | null;
  client: string | null;
  vin: string | null;
  model: string | null;
  mileage: number | string | null;
  status: string | null;
  status_at: string | null;
  status_age_days: number | string | null;
  factory_age_days: number | string | null;
  alert: string | null;
  urgency: string | null;
  mechanics: string | null;
  bodywork: string | null;
  technical_control: string | null;
  dsp: string | null;
  wheels: string | null;
  part_available: string | null;
  part_ordered_days: number | string | null;
  location?: string | null;
  location_source_modified_at?: string | null;
  site?: string | null;
  manufacturer?: string | null;
  folder_number?: string | null;
  metadata: Record<string, unknown> | null;
};

type EventRow = {
  source_modified_at: string | null;
  status: string | null;
  event_date: string | null;
  event_time: string | null;
};

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

type SnapshotRpc = {
  connected: boolean;
  snapshotAt: string | null;
  sourceModifiedAt: string | null;
  locationSourceModifiedAt?: string | null;
  excludedBcaVom: number;
  vehicles: VehicleRow[];
  fifo?: FifoRow[];
  detail?: { vehicle: VehicleRow; events: EventRow[] } | null;
};

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function processProfile(row: VehicleRow) {
  const sourceType = String(row.metadata?.type ?? "").trim();
  if (/VOP\s*EFF/i.test(sourceType)) return "EFF" as const;
  if (/BMW|MINI/i.test(row.client ?? "")) return "BMW" as const;
  if (/BCA|VOM/i.test(sourceType)) return "EXCLU" as const;
  return "AUTRE" as const;
}

function normalizeVehicle(row: VehicleRow) {
  const sourceType = String(row.metadata?.type ?? "").trim() || "Non renseigné";
  const status = row.status?.trim() || "Statut non renseigné";
  const inFactory = ![
    "transport à vide",
    "en attente de transport aller",
    "sortie usine",
    "en attente de transport retour",
    "transport retour planifié",
    "transport retour effectué",
  ].includes(status.toLowerCase());

  return {
    snapshotAt: row.snapshot_at,
    sourceModifiedAt: row.source_modified_at,
    registration: row.registration,
    workOrder: row.work_order,
    client: row.client,
    vin: row.vin,
    model: row.model,
    mileage: num(row.mileage),
    status,
    statusAt: row.status_at,
    statusAgeDays: num(row.status_age_days),
    factoryAgeDays: num(row.factory_age_days),
    alert: row.alert,
    urgency: row.urgency,
    mechanics: row.mechanics,
    bodywork: row.bodywork,
    technicalControl: row.technical_control,
    dsp: row.dsp,
    wheels: row.wheels,
    partAvailable: row.part_available,
    partOrderedDays: num(row.part_ordered_days),
    location: row.location ?? null,
    locationSourceModifiedAt: row.location_source_modified_at ?? null,
    site: row.site ?? null,
    manufacturer: row.manufacturer ?? null,
    folderNumber: row.folder_number ?? null,
    sourceType,
    processProfile: processProfile(row),
    inFactory,
  };
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  if (current.session.role !== "admin") return NextResponse.json({ error: "SAS de développement réservé aux administrateurs." }, { status: 403 });

  const requestedVehicle = new URL(request.url).searchParams.get("vehicle")?.trim() || null;

  try {
    // The former all-in-one RPC occasionally hit the PostgREST statement timeout while
    // serialising vehicles + locations + FIFO in one response. Keep the vehicle mirror
    // lightweight and fetch FIFO independently so the SAS remains available even if FIFO
    // is temporarily slower. Detail requests do not need the full FIFO at all.
    const snapshotPromise = authRpc<SnapshotRpc>("kpi_production_dev_snapshot_light", {
      p_token_hash: current.tokenHash,
      p_vehicle: requestedVehicle,
    });
    const fifoPromise = requestedVehicle
      ? Promise.resolve([] as FifoRow[])
      : authRpc<FifoRow[]>("kpi_production_dev_fifo", {
          p_token_hash: current.tokenHash,
        }).catch(() => [] as FifoRow[]);

    const [snapshot, fifoRows] = await Promise.all([snapshotPromise, fifoPromise]);

    if (!snapshot?.connected) {
      return NextResponse.json({ connected: false, error: "Aucun reflet FTP véhicule disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    const vehicles = (snapshot.vehicles ?? []).map(normalizeVehicle);
    const inFactory = vehicles.filter((vehicle) => vehicle.inFactory);
    const inbound = vehicles.filter((vehicle) => !vehicle.inFactory && vehicle.status.toLowerCase().includes("transport aller"));
    const partBlocked = inFactory.filter((vehicle) => /COMMANDEE|A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT|DOIT S'ENGAGER|BACK ORDER/i.test(vehicle.partAvailable ?? ""));
    const urgent = inFactory.filter((vehicle) => /oui|urgence/i.test(`${vehicle.urgency ?? ""} ${vehicle.alert ?? ""}`));
    const stale = inFactory.filter((vehicle) => vehicle.statusAgeDays >= 2);
    const detail = snapshot.detail
      ? { vehicle: normalizeVehicle(snapshot.detail.vehicle), events: snapshot.detail.events ?? [] }
      : null;
    const fifo = fifoRows.map((row) => ({
      sectorKey: row.sector_key,
      sectorLabel: row.sector_label,
      registration: row.registration,
      workOrder: row.work_order,
      status: row.status,
      alert: row.alert,
      urgency: row.urgency,
      statusAgeDays: num(row.status_age_days),
      factoryAgeDays: num(row.factory_age_days),
      fifoAgeDays: num(row.fifo_age_days),
    }));

    return NextResponse.json({
      connected: true,
      mode: "development-sandbox-read-only",
      sourceModifiedAt: snapshot.sourceModifiedAt,
      locationSourceModifiedAt: snapshot.locationSourceModifiedAt ?? null,
      snapshotAt: snapshot.snapshotAt,
      excludedBcaVom: Number(snapshot.excludedBcaVom ?? 0),
      stats: {
        totalMirror: vehicles.length,
        inFactory: inFactory.length,
        inbound: inbound.length,
        partBlocked: partBlocked.length,
        urgent: urgent.length,
        stale: stale.length,
      },
      vehicles,
      fifo,
      detail,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("development_production_sandbox_failed", error);
    return NextResponse.json({ connected: false, error: "Reflet FTP indisponible pour le SAS de développement." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
