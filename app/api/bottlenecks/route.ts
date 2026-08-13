import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type SnapshotRow = { snapshot_at: string; source_name: string; metrics: Record<string, number | string> };
type Point = { date: string; value: number; source: string };
type Sector = {
  key: string;
  label: string;
  color: string;
  fallbackMax: number;
  fallbackCadence: number;
  points: Point[];
  actual: number;
  max: number;
  cadence: number;
  workDays: number;
  evolution: number;
  aboveMax: number;
};

const dates = ["2026-07-13","2026-07-15","2026-07-16","2026-07-17","2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31","2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07","2026-08-10","2026-08-11","2026-08-12"];

const embedded: Record<string, number[]> = {
  expertise: [83,86,93,132,140,133,143,131,133,150,181,177,245,260,233,205,203,190,194,179,148,160],
  chiffrage: [16,19,13,16,17,17,18,18,15,13,11,12,9,9,15,24,19,23,32,37,41,45],
  controle_technique: [163,164,133,131,111,112,125,115,120,104,107,106,110,123,125,132,145,132,140,132,117,122],
  dsp: [70,73,76,89,84,95,125,133,149,167,192,207,204,188,170,159,134,141,162,144,121,103],
  jantes: [95,101,110,113,103,103,111,109,112,119,121,125,108,114,111,122,129,141,159,159,152,150],
  mecanique: [236,224,260,260,247,274,285,287,295,299,307,314,307,305,284,262,251,266,262,256,236,227],
  carrosserie: [270,269,281,281,258,256,249,255,249,268,269,272,255,259,251,264,236,259,280,263,191,185],
  parc_travaux: [364,348,372,374,365,392,397,407,416,437,458,464,440,443,418,393,366,389,394,385,332,324],
};

const preparationPoints: Point[] = [
  ["2026-07-13",3],["2026-07-16",1],["2026-07-20",3],["2026-07-21",10],["2026-07-22",8],["2026-07-23",15],["2026-07-24",8],["2026-07-27",2],["2026-07-30",3],["2026-07-31",4],["2026-08-03",2],["2026-08-04",2],["2026-08-05",2],["2026-08-06",3],["2026-08-07",11],["2026-08-10",2],["2026-08-11",10],["2026-08-12",9],
].map(([date,value]) => ({ date: String(date), value: Number(value), source: "Book CRVO · historique vérifié" }));

const configs = [
  { key:"expertise", label:"Expertise", color:"#eb5b56", fallbackMax:160, fallbackCadence:80 },
  { key:"chiffrage", label:"Chiffrage", color:"#ee7a70", fallbackMax:25, fallbackCadence:50 },
  { key:"controle_technique", label:"Contrôle technique", color:"#b12d36", fallbackMax:70, fallbackCadence:50 },
  { key:"dsp", label:"DSP", color:"#009edb", fallbackMax:80, fallbackCadence:30 },
  { key:"jantes", label:"Jantes", color:"#47b9b4", fallbackMax:80, fallbackCadence:35 },
  { key:"mecanique", label:"Mécanique", color:"#278b65", fallbackMax:160, fallbackCadence:80 },
  { key:"carrosserie", label:"Carrosserie", color:"#004f9f", fallbackMax:200, fallbackCadence:50 },
  { key:"parc_travaux", label:"Parc travaux", color:"#344b62", fallbackMax:300, fallbackCadence:80 },
  { key:"preparation", label:"Préparation", color:"#8d5ec7", fallbackMax:150, fallbackCadence:80 },
] as const;

function priority(source: string) {
  const value = source.toLowerCase();
  if (value.includes("sftp")) return 30;
  if (value.includes("manuel") || value.includes("book")) return 20;
  if (value.includes("seed") || value.includes("classeur")) return 10;
  return 0;
}

function sourceMode(source: string) {
  if (source.toLowerCase().includes("sftp")) return "sftp";
  if (source.toLowerCase().includes("manuel") || source.toLowerCase().includes("book")) return "book";
  return "embedded";
}

function embeddedPoints(key: string): Point[] {
  if (key === "preparation") return preparationPoints;
  return (embedded[key] ?? []).map((value,index) => ({ date: dates[index], value, source: "Book CRVO · historique vérifié" }));
}

function mergePoints(key: string, rows: SnapshotRow[]) {
  const byDate = new Map(embeddedPoints(key).map((point) => [point.date, point]));
  const metricKey = `bottleneck_${key}`;
  const sorted = [...rows].sort((a,b) => a.snapshot_at.localeCompare(b.snapshot_at) || priority(a.source_name)-priority(b.source_name));
  for (const row of sorted) {
    const value = Number(row.metrics?.[metricKey]);
    if (!Number.isFinite(value)) continue;
    const current = byDate.get(row.snapshot_at);
    if (!current || priority(row.source_name) >= priority(current.source)) byDate.set(row.snapshot_at, { date: row.snapshot_at, value, source: row.source_name });
  }
  return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date)).slice(-30);
}

function latestOperationalDate(rows: SnapshotRow[]) {
  const live = rows.filter((row) => Number.isFinite(Number(row.metrics?.factory_stock))).map((row) => row.snapshot_at).sort();
  return live.at(-1) ?? "2026-08-12";
}

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  let rows: SnapshotRow[] = [];
  let connected = false;

  if (supabaseUrl && secretKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/kpi_dashboard_snapshots?select=snapshot_at,source_name,metrics&order=snapshot_at.asc&limit=180`, {
        headers: supabaseRestHeaders(secretKey, { Accept: "application/json" }), cache: "no-store",
      });
      if (!response.ok) throw new Error(`Supabase ${response.status}`);
      rows = await response.json() as SnapshotRow[];
      connected = true;
    } catch (error) {
      console.error(JSON.stringify({ event:"bottlenecks_fetch_failed", message:error instanceof Error ? error.message : "unknown" }));
    }
  }

  const operationalLatestDate = latestOperationalDate(rows);
  const objectiveMonth = `${operationalLatestDate.slice(0,7)}-01`;
  const maxByKey = new Map<string, number>();
  if (supabaseUrl && secretKey) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/kpi_monthly_objectives?select=sector_key,max_threshold&month=eq.${objectiveMonth}`, {
        headers: supabaseRestHeaders(secretKey, { Accept:"application/json" }), cache:"no-store",
      });
      if (response.ok) {
        const objectives = await response.json() as Array<{ sector_key:string; max_threshold:number|string|null }>;
        objectives.forEach((row) => { const value=Number(row.max_threshold); if (Number.isFinite(value)) maxByKey.set(row.sector_key,value); });
      }
    } catch {}
  }

  const sectors: Sector[] = configs.map((config) => {
    const points = mergePoints(config.key, rows);
    const latest = points.at(-1);
    const first = points[0];
    const cadenceCandidates = rows
      .filter((row) => Number.isFinite(Number(row.metrics?.[`bottleneck_${config.key}_cadence`])))
      .sort((a,b) => b.snapshot_at.localeCompare(a.snapshot_at) || priority(b.source_name)-priority(a.source_name));
    const cadence = Number(cadenceCandidates[0]?.metrics?.[`bottleneck_${config.key}_cadence`]) || config.fallbackCadence;
    const actual = latest?.value ?? 0;
    const max = maxByKey.get(config.key) ?? config.fallbackMax;
    const evolution = first?.value ? Math.round((actual-first.value)/first.value*100) : 0;
    return { ...config, points, actual, max, cadence, workDays: cadence > 0 ? actual/cadence : 0, evolution, aboveMax: Math.max(actual-max,0) };
  });

  const latestDate = sectors.map((sector) => sector.points.at(-1)?.date ?? "").sort().at(-1) || "2026-08-12";
  const latestSources = sectors.flatMap((sector) => sector.points.filter((p) => p.date===latestDate).map((p)=>p.source));
  const latestSource = [...latestSources].sort((a,b)=>priority(b)-priority(a))[0] ?? "Book CRVO · historique vérifié";
  const stale = latestDate < operationalLatestDate;

  return NextResponse.json({
    connected,
    latestDate,
    operationalLatestDate,
    stale,
    source: latestSource,
    sourceMode: sourceMode(latestSource),
    critical: sectors.filter((sector) => sector.actual > sector.max).length,
    sectors,
  }, { headers:{ "Cache-Control":"no-store" } });
}
