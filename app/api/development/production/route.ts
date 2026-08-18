import { NextResponse } from "next/server";
import { CRVO_SUPABASE_PUBLISHABLE_KEY, currentSession } from "../../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../../supabase-rest";

export const dynamic = "force-dynamic";

type VehicleRow = {
  snapshot_at: string;
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
  metadata: Record<string, unknown> | null;
};

type EventRow = {
  source_first_seen_at: string | null;
  source_last_seen_at: string | null;
  source_modified_at: string | null;
  client: string | null;
  work_order: string | null;
  vin: string | null;
  flow: string | null;
  status: string | null;
  event_date: string | null;
  event_time: string | null;
  registration: string | null;
  appointment_id: string | null;
};

function config() {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return null;
  return { supabaseUrl, readKey: process.env.SUPABASE_SECRET_KEY || CRVO_SUPABASE_PUBLISHABLE_KEY };
}

async function rest<T>(supabaseUrl: string, readKey: string, path: string): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: supabaseRestHeaders(readKey, { Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function processProfile(row: VehicleRow) {
  const sourceType = String(row.metadata?.type ?? "").trim();
  if (/VOP\s*EFF/i.test(sourceType)) return "EFF";
  if (/ARVAL/i.test(sourceType) || /BMW|MINI/i.test(row.client ?? "")) return "BMW";
  if (/BCA|VOM/i.test(sourceType)) return "EXCLU";
  return "AUTRE";
}

function normalizeVehicle(row: VehicleRow) {
  const sourceType = String(row.metadata?.type ?? "").trim() || "Non renseigné";
  const status = row.status?.trim() || "Statut non renseigné";
  const factoryAgeDays = num(row.factory_age_days);
  // Le miroir EtatduParc comprend aussi les véhicules avant entrée et après sortie.
  // Les deux statuts transport sont hors encours usine ; tous les autres constituent le reflet des dossiers présents.
  const inFactory = !["transport à vide", "en attente de transport aller"].includes(status.toLowerCase());
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
    factoryAgeDays,
    alert: row.alert,
    urgency: row.urgency,
    mechanics: row.mechanics,
    bodywork: row.bodywork,
    technicalControl: row.technical_control,
    dsp: row.dsp,
    wheels: row.wheels,
    partAvailable: row.part_available,
    partOrderedDays: num(row.part_ordered_days),
    sourceType,
    processProfile: processProfile(row),
    inFactory,
  };
}

function isExcluded(row: VehicleRow) {
  const sourceType = String(row.metadata?.type ?? "");
  return /BCA|VOM/i.test(sourceType);
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return NextResponse.json({ error: "Session CRVO requise." }, { status: 401 });
  if (current.session.role !== "admin") return NextResponse.json({ error: "SAS de développement réservé aux administrateurs." }, { status: 403 });

  const db = config();
  if (!db) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });

  try {
    const latestRows = await rest<Array<{ source_modified_at: string | null }>>(
      db.supabaseUrl,
      db.readKey,
      "kpi_ftp_vehicle_state?select=source_modified_at&order=source_modified_at.desc.nullslast&limit=1",
    );
    const latestSource = latestRows[0]?.source_modified_at;
    if (!latestSource) return NextResponse.json({ connected: false, error: "Aucun reflet FTP véhicule disponible." }, { status: 503 });

    const sourceFilter = encodeURIComponent(latestSource);
    const rows = await rest<VehicleRow[]>(
      db.supabaseUrl,
      db.readKey,
      `kpi_ftp_vehicle_state?select=snapshot_at,source_modified_at,registration,work_order,client,vin,model,mileage,status,status_at,status_age_days,factory_age_days,alert,urgency,mechanics,bodywork,technical_control,dsp,wheels,part_available,part_ordered_days,metadata&source_modified_at=eq.${sourceFilter}&limit=4000`,
    );

    const activeRows = rows.filter((row) => !isExcluded(row));
    const vehicles = activeRows.map(normalizeVehicle);
    const inFactory = vehicles.filter((vehicle) => vehicle.inFactory);
    const inbound = vehicles.filter((vehicle) => !vehicle.inFactory && vehicle.status.toLowerCase().includes("transport aller"));
    const partBlocked = inFactory.filter((vehicle) => /COMMANDEE|A COMMANDER|INDISPONIBLE|PAS D'ENGAGEMENT/i.test(vehicle.partAvailable ?? ""));
    const urgent = inFactory.filter((vehicle) => /oui|urgence/i.test(`${vehicle.urgency ?? ""} ${vehicle.alert ?? ""}`));
    const stale = inFactory.filter((vehicle) => vehicle.statusAgeDays >= 2);

    const requestedVehicle = new URL(request.url).searchParams.get("vehicle")?.trim() || null;
    let detail = null;
    if (requestedVehicle) {
      const selected = activeRows.find((row) => [row.vin, row.registration, row.work_order].filter(Boolean).some((value) => String(value) === requestedVehicle));
      if (selected) {
        const normalized = normalizeVehicle(selected);
        const key = selected.vin || selected.registration || selected.work_order;
        let events: EventRow[] = [];
        if (key) {
          const field = selected.vin ? "vin" : selected.registration ? "registration" : "work_order";
          events = await rest<EventRow[]>(
            db.supabaseUrl,
            db.readKey,
            `kpi_ftp_status_events?select=source_first_seen_at,source_last_seen_at,source_modified_at,client,work_order,vin,flow,status,event_date,event_time,registration,appointment_id&${field}=eq.${encodeURIComponent(String(key))}&order=event_date.desc,event_time.desc&limit=80`,
          ).catch(() => []);
        }
        detail = { vehicle: normalized, events };
      }
    }

    return NextResponse.json({
      connected: true,
      mode: "development-sandbox-read-only",
      sourceModifiedAt: latestSource,
      snapshotAt: vehicles[0]?.snapshotAt ?? null,
      excludedBcaVom: rows.length - activeRows.length,
      stats: {
        totalMirror: vehicles.length,
        inFactory: inFactory.length,
        inbound: inbound.length,
        partBlocked: partBlocked.length,
        urgent: urgent.length,
        stale: stale.length,
      },
      vehicles,
      detail,
    }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error) {
    console.error("development_production_sandbox_failed", error);
    return NextResponse.json({ connected: false, error: "Reflet FTP indisponible pour le SAS de développement." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
