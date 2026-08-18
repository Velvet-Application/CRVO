import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";
// Read-only digital twin: refreshed from the latest certified EtatduParc FTP snapshot.
// Large FTP mirrors are deliberately paged: no request serialises the whole park in PostgreSQL.

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

type MetaRpc = {
  connected: boolean;
  snapshotAt: string | null;
  sourceModifiedAt: string | null;
  locationSourceModifiedAt: string | null;
  totalRows: number;
  locationRows: number;
  excludedBcaVom: number;
};

type LocationInfo = {
  location: string | null;
  sourceModifiedAt: string | null;
  site: string | null;
  manufacturer: string | null;
  folderNumber: string | null;
};

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function textMeta(row: VehicleRow, key: string) {
  const value = row.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    site: row.site ?? textMeta(row, "site"),
    manufacturer: row.manufacturer ?? textMeta(row, "manufacturer"),
    folderNumber: row.folder_number ?? textMeta(row, "folder_number"),
    sourceType,
    processProfile: processProfile(row),
    inFactory,
  };
}

async function fetchPaged<T>(
  rpcName: string,
  tokenHash: string,
  total: number,
  pageSize: number,
  concurrency = 2,
) {
  const rows: T[] = [];
  const safeTotal = Math.max(0, Number(total) || 0);
  for (let base = 0; base < safeTotal; base += pageSize * concurrency) {
    const calls: Array<Promise<T[]>> = [];
    for (let slot = 0; slot < concurrency; slot += 1) {
      const offset = base + slot * pageSize;
      if (offset >= safeTotal) break;
      calls.push(authRpc<T[]>(rpcName, {
        p_token_hash: tokenHash,
        p_offset: offset,
        p_limit: pageSize,
      }));
    }
    const pages = await Promise.all(calls);
    for (const page of pages) rows.push(...(Array.isArray(page) ? page : []));
  }
  return rows;
}

function locationIndexes(rows: VehicleRow[]) {
  const vin = new Map<string, LocationInfo>();
  const registration = new Map<string, LocationInfo>();
  const workOrder = new Map<string, LocationInfo>();

  for (const row of rows) {
    const location = textMeta(row, "position");
    if (!location) continue;
    const info: LocationInfo = {
      location,
      sourceModifiedAt: row.source_modified_at,
      site: textMeta(row, "site"),
      manufacturer: textMeta(row, "manufacturer"),
      folderNumber: textMeta(row, "folder_number"),
    };
    const vinKey = row.vin?.trim().toUpperCase();
    const registrationKey = row.registration?.trim().toUpperCase();
    const workOrderKey = row.work_order?.trim();
    if (vinKey && !vin.has(vinKey)) vin.set(vinKey, info);
    if (registrationKey && !registration.has(registrationKey)) registration.set(registrationKey, info);
    if (workOrderKey && !workOrder.has(workOrderKey)) workOrder.set(workOrderKey, info);
  }

  return { vin, registration, workOrder };
}

function findLocation(row: VehicleRow, indexes: ReturnType<typeof locationIndexes>) {
  const vinKey = row.vin?.trim().toUpperCase();
  if (vinKey && indexes.vin.has(vinKey)) return indexes.vin.get(vinKey) ?? null;
  const registrationKey = row.registration?.trim().toUpperCase();
  if (registrationKey && indexes.registration.has(registrationKey)) return indexes.registration.get(registrationKey) ?? null;
  const workOrderKey = row.work_order?.trim();
  if (workOrderKey && indexes.workOrder.has(workOrderKey)) return indexes.workOrder.get(workOrderKey) ?? null;
  return null;
}

function withLocation(row: VehicleRow, location: LocationInfo | null): VehicleRow {
  return {
    ...row,
    location: location?.location ?? null,
    location_source_modified_at: location?.sourceModifiedAt ?? null,
    site: textMeta(row, "site") ?? location?.site ?? null,
    manufacturer: textMeta(row, "manufacturer") ?? location?.manufacturer ?? null,
    folder_number: textMeta(row, "folder_number") ?? location?.folderNumber ?? null,
  };
}

function emptyStats() {
  return { totalMirror: 0, inFactory: 0, inbound: 0, partBlocked: 0, urgent: 0, stale: 0 };
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  if (current.session.role !== "admin") return NextResponse.json({ error: "SAS de développement réservé aux administrateurs." }, { status: 403 });

  const url = new URL(request.url);
  const requestedVehicle = url.searchParams.get("vehicle")?.trim() || null;
  const includeFifo = url.searchParams.get("fifo") !== "0";

  try {
    if (requestedVehicle) {
      const found = await authRpc<VehicleRow[]>("kpi_production_dev_vehicle_find", {
        p_token_hash: current.tokenHash,
        p_vehicle: requestedVehicle,
      });
      const sourceVehicle = Array.isArray(found) ? found[0] : undefined;

      if (!sourceVehicle) {
        return NextResponse.json({
          connected: true,
          mode: "development-sandbox-read-only",
          sourceModifiedAt: null,
          locationSourceModifiedAt: null,
          snapshotAt: null,
          excludedBcaVom: 0,
          stats: emptyStats(),
          vehicles: [], fifo: [], detail: null,
        }, { headers: { "Cache-Control": "no-store" } });
      }

      const [locationRows, events] = await Promise.all([
        authRpc<VehicleRow[]>("kpi_production_dev_location_find", {
          p_token_hash: current.tokenHash,
          p_vin: sourceVehicle.vin,
          p_registration: sourceVehicle.registration,
          p_work_order: sourceVehicle.work_order,
        }).catch(() => [] as VehicleRow[]),
        authRpc<EventRow[]>("kpi_production_dev_events", {
          p_token_hash: current.tokenHash,
          p_vin: sourceVehicle.vin,
          p_registration: sourceVehicle.registration,
          p_work_order: sourceVehicle.work_order,
        }).catch(() => [] as EventRow[]),
      ]);

      const locationRow = Array.isArray(locationRows) ? locationRows[0] : undefined;
      const detailRow = withLocation(sourceVehicle, locationRow ? {
        location: textMeta(locationRow, "position"),
        sourceModifiedAt: locationRow.source_modified_at,
        site: textMeta(locationRow, "site"),
        manufacturer: textMeta(locationRow, "manufacturer"),
        folderNumber: textMeta(locationRow, "folder_number"),
      } : null);
      const vehicle = normalizeVehicle(detailRow);

      return NextResponse.json({
        connected: true,
        mode: "development-sandbox-read-only",
        sourceModifiedAt: sourceVehicle.source_modified_at,
        locationSourceModifiedAt: detailRow.location_source_modified_at ?? null,
        snapshotAt: sourceVehicle.snapshot_at,
        excludedBcaVom: 0,
        stats: { ...emptyStats(), totalMirror: 1, inFactory: vehicle.inFactory ? 1 : 0 },
        vehicles: [vehicle],
        fifo: [],
        detail: { vehicle, events: Array.isArray(events) ? events : [] },
      }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
    }

    const meta = await authRpc<MetaRpc>("kpi_production_dev_meta", {
      p_token_hash: current.tokenHash,
    });
    if (!meta?.connected) {
      return NextResponse.json({ connected: false, error: "Aucun reflet FTP véhicule disponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    const vehicleRows = await fetchPaged<VehicleRow>(
      "kpi_production_dev_vehicle_page",
      current.tokenHash,
      Number(meta.totalRows ?? 0),
      450,
      2,
    );

    const [locationRows, fifoRows] = await Promise.all([
      fetchPaged<VehicleRow>(
        "kpi_production_dev_location_page",
        current.tokenHash,
        Number(meta.locationRows ?? 0),
        500,
        2,
      ).catch(() => [] as VehicleRow[]),
      includeFifo
        ? authRpc<FifoRow[]>("kpi_production_dev_fifo", {
            p_token_hash: current.tokenHash,
          }).catch(() => [] as FifoRow[])
        : Promise.resolve([] as FifoRow[]),
    ]);

    const locations = locationIndexes(locationRows);
    const vehicles = vehicleRows
      .map((row) => normalizeVehicle(withLocation(row, findLocation(row, locations))))
      .sort((a, b) => b.factoryAgeDays - a.factoryAgeDays || b.statusAgeDays - a.statusAgeDays);

    const inFactory = vehicles.filter((vehicle) => vehicle.inFactory);
    const inbound = vehicles.filter((vehicle) => !vehicle.inFactory && vehicle.status.toLowerCase().includes("transport aller"));
    const partBlocked = inFactory.filter((vehicle) => /COMMANDEE|A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT|DOIT S'ENGAGER|BACK ORDER/i.test(vehicle.partAvailable ?? ""));
    const urgent = inFactory.filter((vehicle) => /oui|urgence/i.test(`${vehicle.urgency ?? ""} ${vehicle.alert ?? ""}`));
    const stale = inFactory.filter((vehicle) => vehicle.statusAgeDays >= 2);
    const fifo = (Array.isArray(fifoRows) ? fifoRows : []).map((row) => ({
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
      mode: "development-sandbox-read-only-paged",
      sourceModifiedAt: meta.sourceModifiedAt,
      locationSourceModifiedAt: meta.locationSourceModifiedAt ?? null,
      snapshotAt: meta.snapshotAt,
      excludedBcaVom: Number(meta.excludedBcaVom ?? 0),
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
      detail: null,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("development_production_sandbox_failed", error);
    return NextResponse.json({ connected: false, error: "Reflet FTP indisponible pour le SAS de développement." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
