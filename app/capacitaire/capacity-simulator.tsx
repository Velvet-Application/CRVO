"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./capacitaire.module.css";

type StageKey = "expertise" | "mecanique" | "dsp" | "jantes" | "carrosserie" | "preparation" | "qualite" | "sortie";
type BodyKey = "fixline" | "box" | "tolerie";
type ScenarioKey = "s0" | "s1" | "s2" | "s3";

type DashboardSnapshot = {
  date: string;
  entries: number;
  exits: number;
  stock: number;
  production: Array<{ name: string; value: number }>;
};
type DashboardPayload = { snapshots?: DashboardSnapshot[]; snapshot?: DashboardSnapshot; latestSource?: string; error?: string };
type BodyshopDaily = { date: string; boxHeavy: number; fixline1: number; fixline2: number; fixline3: number; total: number };
type BodyshopPayload = {
  production?: { daily: BodyshopDaily[]; latest?: BodyshopDaily | null };
  staffMapping?: Array<{ active: boolean; workcenter: string; team_code?: string }>;
  operationalModel?: { shifts?: Array<{ code: string; label: string }> };
  generatedAt?: string;
  error?: string;
};
type ProductivityRow = {
  sectorKey: string;
  sectorLabel: string;
  workcenterKey: string;
  workcenterLabel: string;
  mechanicName?: string;
  boughtHours: number;
  soldHours: number | null;
  productivity: number | null;
};
type ProductivityPayload = {
  sectors?: ProductivityRow[];
  collaborators?: ProductivityRow[];
  month?: string;
  period?: { valid?: boolean; start?: string | null; end?: string | null };
  error?: string;
};
type SettingsApiPayload = { settings?: unknown; updatedAt?: string | null; updatedBy?: string | null; error?: string };

type StageSetting = {
  capacityManual: number | null;
  etpManual: number | null;
  targetProductivityPct: number;
  hires: number;
  hireStartMonth: string;
  currentShifts: number;
  targetShifts: number;
  equipmentGainPct: number;
  bmwTouchPct: number | null;
  miniTouchPct: number | null;
  otherTouchPct: number | null;
};
type BodySetting = {
  capacityManual: number | null;
  etpManual: number | null;
  targetProductivityPct: number;
  hires: number;
  hireStartMonth: string;
  currentShifts: number;
  targetShifts: number;
  equipmentGainPct: number;
  routeSharePct: number | null;
};
type ForecastRow = { month: string; bmw: number; mini: number; other: number };
type SimulatorSettings = {
  version: number;
  baselineWindowDays: number;
  workdaysPerMonth: number;
  availabilityCurrentPct: number;
  availabilityTargetPct: number;
  rampUpPct: number[];
  forecast: ForecastRow[];
  stages: Record<StageKey, StageSetting>;
  bodyshop: Record<BodyKey, BodySetting>;
};
type AutoMetric = { avgDaily: number; p90Daily: number; peakDaily: number; touchPct: number; etp: number; productivityPct: number | null; boughtHoursPerDay: number; source: string };
type AutoBodyMetric = { avgDaily: number; p90Daily: number; peakDaily: number; routeSharePct: number; etp: number; productivityPct: number | null; boughtHoursPerDay: number; source: string };
type MonthResult = { month: string; worstLoad: number; bottleneck: string; stageLoads: Record<string, number>; stageDemands: Record<string, number>; stageCapacities: Record<string, number> };
type ScenarioResult = { key: ScenarioKey; label: string; subtitle: string; months: MonthResult[]; worstLoad: number; bottleneck: string; firstSaturation: string | null };

const STAGES: Array<{ key: StageKey; label: string; aliases: string[] }> = [
  { key: "expertise", label: "Expertise", aliases: ["expert"] },
  { key: "mecanique", label: "Mécanique", aliases: ["mecan", "méca"] },
  { key: "dsp", label: "DSP", aliases: ["dsp", "deboss", "déboss"] },
  { key: "jantes", label: "Jantes", aliases: ["jante"] },
  { key: "carrosserie", label: "Carrosserie", aliases: ["carross", "fixline", "box", "toler"] },
  { key: "preparation", label: "Préparation", aliases: ["prepa", "prépa", "preparation", "préparation"] },
  { key: "qualite", label: "Qualité", aliases: ["qualit"] },
  { key: "sortie", label: "Sortie usine", aliases: ["sortie"] },
];
const BODY: Array<{ key: BodyKey; label: string }> = [
  { key: "fixline", label: "Fixline" },
  { key: "box", label: "BOX / lourde" },
  { key: "tolerie", label: "Tôlerie dédiée" },
];
const SCENARIOS: Array<{ key: ScenarioKey; label: string; subtitle: string }> = [
  { key: "s0", label: "S0 · Sans action", subtitle: "Organisation, effectif et performance actuels" },
  { key: "s1", label: "S1 · Performance", subtitle: "Amélioration de productivité uniquement" },
  { key: "s2", label: "S2 · Ressources", subtitle: "Renforts ETP avec ramp-up" },
  { key: "s3", label: "S3 · Cible", subtitle: "Performance + ETP + shifts + disponibilité + équipements" },
];

const MINI_LENS_STANDARD = {
  sampleVehicles: 569,
  bodyHours: 4.61,
  paintHours: 3.31,
  mechanicsHours: 1.17,
  damageCount: 9.9,
};
const MINI_BODYSHOP_HOURS = MINI_LENS_STANDARD.bodyHours + MINI_LENS_STANDARD.paintHours;
const MINI_DEFLEET_LENS: Record<string, number> = {
  "2026-08": 29,
  "2026-09": 65,
  "2026-10": 113,
  "2026-11": 134,
  "2026-12": 50,
};
const MINI_DEFLEET_LENS_TOTAL = 393;

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)); }
function n(value: unknown) { const out = Number(value); return Number.isFinite(out) ? out : 0; }
function avg(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}
function norm(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function fmt(value: number, digits = 1) { return Number(value || 0).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function pct(value: number) { return `${fmt(value, 0)} %`; }
function currentMonth() { return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date()); }
function nextMonths(count = 6) {
  const [year, month] = currentMonth().split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}
function monthLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, value - 1, 1)));
}
function monthDiff(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number); const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
function businessDaysInclusive(start?: string | null, end?: string | null) {
  if (!start || !end) return 0;
  const from = new Date(`${start}T12:00:00Z`); const to = new Date(`${end}T12:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
  let count = 0;
  for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay(); if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}
function stageMatch(row: Pick<ProductivityRow, "sectorLabel" | "workcenterLabel">, key: StageKey) {
  const text = norm(`${row.sectorLabel} ${row.workcenterLabel}`);
  const def = STAGES.find((item) => item.key === key)!;
  return def.aliases.some((alias) => text.includes(norm(alias)));
}
function bodyMatch(row: Pick<ProductivityRow, "sectorLabel" | "workcenterLabel">, key: BodyKey) {
  const text = norm(`${row.sectorLabel} ${row.workcenterLabel}`);
  if (key === "fixline") return text.includes("fixline");
  if (key === "tolerie") return text.includes("toler") || text.includes("lourde");
  return text.includes("box");
}
function productionValue(snapshot: DashboardSnapshot, key: StageKey) {
  if (key === "jantes") return 0;
  const def = STAGES.find((item) => item.key === key)!;
  const item = snapshot.production?.find((row) => def.aliases.some((alias) => norm(row.name).includes(norm(alias))));
  return n(item?.value);
}
function weightedProductivity(rows: ProductivityRow[]) {
  const bought = rows.reduce((sum, row) => sum + n(row.boughtHours), 0);
  const sold = rows.reduce((sum, row) => sum + n(row.soldHours), 0);
  return bought > 0 && rows.some((row) => row.soldHours != null) ? sold / bought * 100 : null;
}

function defaultStage(key: StageKey, firstMonth: string): StageSetting {
  const shifts = key === "carrosserie" ? 3 : 1;
  return { capacityManual: null, etpManual: null, targetProductivityPct: 100, hires: 0, hireStartMonth: firstMonth, currentShifts: shifts, targetShifts: shifts, equipmentGainPct: 0, bmwTouchPct: null, miniTouchPct: null, otherTouchPct: null };
}
function defaultBody(firstMonth: string): BodySetting {
  return { capacityManual: null, etpManual: null, targetProductivityPct: 100, hires: 0, hireStartMonth: firstMonth, currentShifts: 3, targetShifts: 3, equipmentGainPct: 0, routeSharePct: null };
}
function defaultSettings(): SimulatorSettings {
  const months = nextMonths(6); const firstMonth = months[0];
  return {
    version: 2,
    baselineWindowDays: 30,
    workdaysPerMonth: 22,
    availabilityCurrentPct: 100,
    availabilityTargetPct: 100,
    rampUpPct: [40, 60, 75, 90, 100],
    forecast: months.map((month) => ({ month, bmw: 0, mini: MINI_DEFLEET_LENS[month] ?? 0, other: 0 })),
    stages: Object.fromEntries(STAGES.map(({ key }) => [key, defaultStage(key, firstMonth)])) as Record<StageKey, StageSetting>,
    bodyshop: Object.fromEntries(BODY.map(({ key }) => [key, defaultBody(firstMonth)])) as Record<BodyKey, BodySetting>,
  };
}
function normalizeSettings(raw: unknown): SimulatorSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const source = raw as Partial<SimulatorSettings>;
  const forecast = Array.isArray(source.forecast) && source.forecast.length ? source.forecast.filter((row): row is ForecastRow => Boolean(row && /^20\d{2}-\d{2}$/.test(String(row.month)))).map((row) => ({ month: row.month, bmw: n(row.bmw), mini: n(row.mini), other: n(row.other) })) : base.forecast;
  const firstMonth = forecast[0]?.month ?? base.forecast[0].month;
  const stages = Object.fromEntries(STAGES.map(({ key }) => [key, { ...defaultStage(key, firstMonth), ...(source.stages?.[key] ?? {}) }])) as Record<StageKey, StageSetting>;
  const bodyshop = Object.fromEntries(BODY.map(({ key }) => [key, { ...defaultBody(firstMonth), ...(source.bodyshop?.[key] ?? {}) }])) as Record<BodyKey, BodySetting>;
  return {
    ...base,
    ...source,
    version: 2,
    baselineWindowDays: clamp(n(source.baselineWindowDays ?? base.baselineWindowDays), 5, 120),
    workdaysPerMonth: clamp(n(source.workdaysPerMonth ?? base.workdaysPerMonth), 15, 31),
    availabilityCurrentPct: clamp(n(source.availabilityCurrentPct ?? base.availabilityCurrentPct), 50, 110),
    availabilityTargetPct: clamp(n(source.availabilityTargetPct ?? base.availabilityTargetPct), 50, 110),
    rampUpPct: Array.isArray(source.rampUpPct) && source.rampUpPct.length ? source.rampUpPct.slice(0, 12).map((value) => clamp(n(value), 0, 150)) : base.rampUpPct,
    forecast,
    stages,
    bodyshop,
  };
}

function autoMetrics(dashboard: DashboardPayload | null, productivity: ProductivityPayload | null, windowDays: number) {
  const snapshots = (dashboard?.snapshots?.length ? dashboard.snapshots : dashboard?.snapshot ? [dashboard.snapshot] : []).slice(-windowDays);
  const entries = snapshots.map((row) => n(row.entries));
  const entriesAvg = avg(entries);
  const collaborators = productivity?.collaborators ?? [];
  const sectors = productivity?.sectors ?? [];
  const periodWorkdays = productivity?.period?.valid ? businessDaysInclusive(productivity.period.start, productivity.period.end) : 0;
  const result = {} as Record<StageKey, AutoMetric>;
  for (const stage of STAGES) {
    const values = snapshots.map((row) => productionValue(row, stage.key));
    const selectedSectors = sectors.filter((row) => stageMatch(row, stage.key));
    const selectedCollaborators = collaborators.filter((row) => stageMatch(row, stage.key));
    const people = new Set(selectedCollaborators.map((row) => row.mechanicName).filter(Boolean));
    const boughtHours = selectedCollaborators.reduce((sum, row) => sum + n(row.boughtHours), 0);
    const average = avg(values);
    result[stage.key] = {
      avgDaily: average,
      p90Daily: percentile(values, 90),
      peakDaily: values.length ? Math.max(...values) : 0,
      touchPct: entriesAvg > 0 ? clamp(average / entriesAvg * 100, 0, 180) : 0,
      etp: people.size,
      productivityPct: weightedProductivity(selectedSectors),
      boughtHoursPerDay: periodWorkdays > 0 ? boughtHours / periodWorkdays : 0,
      source: stage.key === "jantes" ? "À renseigner" : "KPI réel · historique",
    };
  }
  return { stages: result, entriesAvg, snapshots, periodWorkdays };
}
function autoBodyMetrics(bodyshop: BodyshopPayload | null, productivity: ProductivityPayload | null, windowDays: number) {
  const rows = (bodyshop?.production?.daily ?? []).slice(-windowDays);
  const collaborators = productivity?.collaborators ?? [];
  const sectors = productivity?.sectors ?? [];
  const periodWorkdays = productivity?.period?.valid ? businessDaysInclusive(productivity.period.start, productivity.period.end) : 0;
  const totalAvg = avg(rows.map((row) => n(row.total)));
  const fixValues = rows.map((row) => n(row.fixline1) + n(row.fixline2) + n(row.fixline3));
  const boxValues = rows.map((row) => n(row.boxHeavy));
  const byKey: Record<BodyKey, number[]> = { fixline: fixValues, box: boxValues, tolerie: rows.map(() => 0) };
  const staff = bodyshop?.staffMapping?.filter((row) => row.active) ?? [];
  const result = {} as Record<BodyKey, AutoBodyMetric>;
  for (const item of BODY) {
    const values = byKey[item.key];
    const average = avg(values);
    const sectorRows = sectors.filter((row) => bodyMatch(row, item.key));
    const collaboratorRows = collaborators.filter((row) => bodyMatch(row, item.key));
    const boughtHours = collaboratorRows.reduce((sum, row) => sum + n(row.boughtHours), 0);
    let etp = 0;
    if (item.key === "fixline") etp = staff.filter((row) => row.workcenter?.startsWith("fixline")).length;
    if (item.key === "box") etp = staff.filter((row) => row.workcenter === "box" || row.workcenter === "mixed").length;
    if (item.key === "tolerie") etp = staff.filter((row) => row.workcenter === "heavy").length;
    if (!etp) etp = new Set(collaboratorRows.map((row) => row.mechanicName).filter(Boolean)).size;
    result[item.key] = {
      avgDaily: average,
      p90Daily: percentile(values, 90),
      peakDaily: values.length ? Math.max(...values) : 0,
      routeSharePct: totalAvg > 0 ? clamp(average / totalAvg * 100, 0, 100) : 0,
      etp,
      productivityPct: weightedProductivity(sectorRows),
      boughtHoursPerDay: periodWorkdays > 0 ? boughtHours / periodWorkdays : 0,
      source: item.key === "tolerie" ? "Capacité à renseigner si flux dédié" : "KPI carrosserie réel",
    };
  }
  return { bodyshop: result, totalAvg, rows, periodWorkdays };
}

function inputNumber(value: number | null, onChange: (value: number | null) => void, placeholder?: string, step = 1, min = 0, max = 9999) {
  return <input type="number" value={value == null ? "" : value} placeholder={placeholder} step={step} min={min} max={max} onChange={(event) => onChange(event.target.value === "" ? null : clamp(Number(event.target.value), min, max))} />;
}

export default function CapacitySimulator() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [bodyshop, setBodyshop] = useState<BodyshopPayload | null>(null);
  const [productivity, setProductivity] = useState<ProductivityPayload | null>(null);
  const [settings, setSettings] = useState<SimulatorSettings>(() => defaultSettings());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMeta, setSavedMeta] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });

  async function load() {
    setLoading(true); setError("");
    const month = currentMonth();
    try {
      const [dashResponse, bodyResponse, productivityResponse, settingsResponse] = await Promise.all([
        fetch("/api/dashboard?history=1", { cache: "no-store" }),
        fetch("/api/bodyshop", { cache: "no-store" }),
        fetch(`/api/productivity?month=${encodeURIComponent(month)}`, { cache: "no-store" }),
        fetch("/api/capacity-simulator", { cache: "no-store" }),
      ]);
      const [dashPayload, bodyPayload, productivityPayload, settingsPayload] = await Promise.all([
        dashResponse.json() as Promise<DashboardPayload>,
        bodyResponse.json() as Promise<BodyshopPayload>,
        productivityResponse.json() as Promise<ProductivityPayload>,
        settingsResponse.json() as Promise<SettingsApiPayload>,
      ]);
      if (!dashResponse.ok) throw new Error(dashPayload.error || "Historique KPI indisponible.");
      if (!bodyResponse.ok) throw new Error(bodyPayload.error || "Données carrosserie indisponibles.");
      if (!productivityResponse.ok) throw new Error(productivityPayload.error || "Productivité indisponible.");
      if (!settingsResponse.ok) throw new Error(settingsPayload.error || "Paramétrage capacitaire indisponible.");
      setDashboard(dashPayload); setBodyshop(bodyPayload); setProductivity(productivityPayload);
      setSettings(normalizeSettings(settingsPayload.settings));
      setSavedMeta({ at: settingsPayload.updatedAt ?? null, by: settingsPayload.updatedBy ?? null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const auto = useMemo(() => autoMetrics(dashboard, productivity, settings.baselineWindowDays), [dashboard, productivity, settings.baselineWindowDays]);
  const autoBody = useMemo(() => autoBodyMetrics(bodyshop, productivity, settings.baselineWindowDays), [bodyshop, productivity, settings.baselineWindowDays]);

  const updateStage = (key: StageKey, patch: Partial<StageSetting>) => setSettings((current) => ({ ...current, stages: { ...current.stages, [key]: { ...current.stages[key], ...patch } } }));
  const updateBody = (key: BodyKey, patch: Partial<BodySetting>) => setSettings((current) => ({ ...current, bodyshop: { ...current.bodyshop, [key]: { ...current.bodyshop[key], ...patch } } }));
  const updateForecast = (index: number, patch: Partial<ForecastRow>) => setSettings((current) => ({ ...current, forecast: current.forecast.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) }));
  const effectiveStage = (key: StageKey) => {
    const cfg = settings.stages[key]; const metric = auto.stages[key];
    return { capacity: cfg.capacityManual ?? metric.p90Daily, etp: cfg.etpManual ?? metric.etp, productivity: metric.productivityPct, touch: metric.touchPct };
  };
  const effectiveBody = (key: BodyKey) => {
    const cfg = settings.bodyshop[key]; const metric = autoBody.bodyshop[key];
    return { capacity: cfg.capacityManual ?? metric.p90Daily, etp: cfg.etpManual ?? metric.etp, productivity: metric.productivityPct, share: cfg.routeSharePct ?? metric.routeSharePct };
  };
  const rampFor = (startMonth: string, month: string) => {
    const index = monthDiff(startMonth, month);
    if (index < 0) return 0;
    return (settings.rampUpPct[Math.min(index, settings.rampUpPct.length - 1)] ?? settings.rampUpPct.at(-1) ?? 100) / 100;
  };
  const scenarioStageFactor = (key: StageKey, scenario: ScenarioKey, month: string) => {
    const cfg = settings.stages[key]; const current = effectiveStage(key);
    const currentProd = current.productivity && current.productivity > 0 ? current.productivity : cfg.targetProductivityPct;
    const productivityFactor = scenario === "s1" || scenario === "s3" ? Math.max(1, cfg.targetProductivityPct / Math.max(1, currentProd)) : 1;
    const effectiveHires = (scenario === "s2" || scenario === "s3") ? cfg.hires * rampFor(cfg.hireStartMonth, month) : 0;
    const etpFactor = current.etp > 0 ? (current.etp + effectiveHires) / current.etp : 1;
    const shiftFactor = scenario === "s3" ? Math.max(1, cfg.targetShifts / Math.max(.25, cfg.currentShifts)) : 1;
    const availabilityFactor = scenario === "s3" ? Math.max(1, settings.availabilityTargetPct / Math.max(1, settings.availabilityCurrentPct)) : 1;
    const equipmentFactor = scenario === "s3" ? 1 + Math.max(0, cfg.equipmentGainPct) / 100 : 1;
    return productivityFactor * etpFactor * shiftFactor * availabilityFactor * equipmentFactor;
  };
  const scenarioBodyFactor = (key: BodyKey, scenario: ScenarioKey, month: string) => {
    const cfg = settings.bodyshop[key]; const current = effectiveBody(key);
    const currentProd = current.productivity && current.productivity > 0 ? current.productivity : cfg.targetProductivityPct;
    const productivityFactor = scenario === "s1" || scenario === "s3" ? Math.max(1, cfg.targetProductivityPct / Math.max(1, currentProd)) : 1;
    const effectiveHires = (scenario === "s2" || scenario === "s3") ? cfg.hires * rampFor(cfg.hireStartMonth, month) : 0;
    const etpFactor = current.etp > 0 ? (current.etp + effectiveHires) / current.etp : 1;
    const shiftFactor = scenario === "s3" ? Math.max(1, cfg.targetShifts / Math.max(.25, cfg.currentShifts)) : 1;
    const availabilityFactor = scenario === "s3" ? Math.max(1, settings.availabilityTargetPct / Math.max(1, settings.availabilityCurrentPct)) : 1;
    const equipmentFactor = scenario === "s3" ? 1 + Math.max(0, cfg.equipmentGainPct) / 100 : 1;
    return productivityFactor * etpFactor * shiftFactor * availabilityFactor * equipmentFactor;
  };
  const scenarioStageCapacity = (key: StageKey, scenario: ScenarioKey, month: string) => {
    const base = effectiveStage(key).capacity;
    return base > 0 ? base * scenarioStageFactor(key, scenario, month) : 0;
  };
  const scenarioBodyCapacity = (key: BodyKey, scenario: ScenarioKey, month: string) => {
    const base = effectiveBody(key).capacity;
    return base > 0 ? base * scenarioBodyFactor(key, scenario, month) : 0;
  };
  const scenarioStageHourCapacity = (key: StageKey, scenario: ScenarioKey, month: string) => auto.stages[key].boughtHoursPerDay * scenarioStageFactor(key, scenario, month);
  const scenarioBodyHourCapacity = (key: BodyKey, scenario: ScenarioKey, month: string) => autoBody.bodyshop[key].boughtHoursPerDay * scenarioBodyFactor(key, scenario, month);
  const brandTouch = (key: StageKey, brand: "bmw" | "mini" | "other") => {
    const cfg = settings.stages[key];
    const manual = brand === "bmw" ? cfg.bmwTouchPct : brand === "mini" ? cfg.miniTouchPct : cfg.otherTouchPct;
    return manual == null ? auto.stages[key].touchPct : manual;
  };
  const miniHoursForStage = (key: StageKey) => key === "mecanique" ? MINI_LENS_STANDARD.mechanicsHours : key === "carrosserie" ? MINI_BODYSHOP_HOURS : 0;

  const scenarioResults = useMemo(() => {
    const results = {} as Record<ScenarioKey, ScenarioResult>;
    for (const def of SCENARIOS) {
      const months: MonthResult[] = settings.forecast.map((forecast) => {
        const loads: Record<string, number> = {}; const demands: Record<string, number> = {}; const capacities: Record<string, number> = {};
        for (const stage of STAGES) {
          const baseDemand = auto.stages[stage.key].avgDaily;
          const miniUsesHours = stage.key === "mecanique" || stage.key === "carrosserie";
          const regularExtra = (forecast.bmw * brandTouch(stage.key, "bmw") / 100 + forecast.other * brandTouch(stage.key, "other") / 100 + (miniUsesHours ? 0 : forecast.mini * brandTouch(stage.key, "mini") / 100)) / settings.workdaysPerMonth;
          const capacity = scenarioStageCapacity(stage.key, def.key, forecast.month);
          let demand = baseDemand + regularExtra;
          let load = demand <= .01 ? 0 : capacity > 0 ? demand / capacity * 100 : 999;
          if (miniUsesHours && forecast.mini > 0) {
            const miniHoursDaily = forecast.mini * miniHoursForStage(stage.key) / settings.workdaysPerMonth;
            const hourCapacity = scenarioStageHourCapacity(stage.key, def.key, forecast.month);
            if (hourCapacity > .01 && capacity > 0) {
              const miniLoad = miniHoursDaily / hourCapacity * 100;
              load += miniLoad;
              demand += capacity * miniLoad / 100;
            } else {
              const fallbackMini = forecast.mini * brandTouch(stage.key, "mini") / 100 / settings.workdaysPerMonth;
              demand += fallbackMini;
              load = demand <= .01 ? 0 : capacity > 0 ? demand / capacity * 100 : 999;
            }
          }
          loads[stage.label] = load; demands[stage.label] = demand; capacities[stage.label] = capacity;
        }
        const carrossTouch = { bmw: brandTouch("carrosserie", "bmw"), mini: brandTouch("carrosserie", "mini"), other: brandTouch("carrosserie", "other") };
        for (const bodyDef of BODY) {
          const share = effectiveBody(bodyDef.key).share / 100;
          if (share <= 0 && autoBody.bodyshop[bodyDef.key].avgDaily <= .01) continue;
          const capacity = scenarioBodyCapacity(bodyDef.key, def.key, forecast.month);
          const regularExtraBody = (forecast.bmw * carrossTouch.bmw / 100 + forecast.other * carrossTouch.other / 100) / settings.workdaysPerMonth * share;
          let demand = autoBody.bodyshop[bodyDef.key].avgDaily + regularExtraBody;
          let load = demand <= .01 ? 0 : capacity > 0 ? demand / capacity * 100 : 999;
          if (forecast.mini > 0 && share > 0) {
            const miniHoursDaily = forecast.mini * MINI_BODYSHOP_HOURS / settings.workdaysPerMonth * share;
            const hourCapacity = scenarioBodyHourCapacity(bodyDef.key, def.key, forecast.month);
            if (hourCapacity > .01 && capacity > 0) {
              const miniLoad = miniHoursDaily / hourCapacity * 100;
              load += miniLoad;
              demand += capacity * miniLoad / 100;
            } else {
              const fallbackMiniBody = forecast.mini * carrossTouch.mini / 100 / settings.workdaysPerMonth * share;
              demand += fallbackMiniBody;
              load = demand <= .01 ? 0 : capacity > 0 ? demand / capacity * 100 : 999;
            }
          }
          const label = `Carrosserie · ${bodyDef.label}`;
          loads[label] = load; demands[label] = demand; capacities[label] = capacity;
        }
        const ordered = Object.entries(loads).sort((a, b) => b[1] - a[1]);
        return { month: forecast.month, worstLoad: ordered[0]?.[1] ?? 0, bottleneck: ordered[0]?.[0] ?? "—", stageLoads: loads, stageDemands: demands, stageCapacities: capacities };
      });
      const worst = months.reduce((best, row) => row.worstLoad > best.worstLoad ? row : best, months[0] ?? { month: "", worstLoad: 0, bottleneck: "—", stageLoads: {}, stageDemands: {}, stageCapacities: {} });
      const saturated = months.find((row) => row.worstLoad > 100);
      results[def.key] = { ...def, months, worstLoad: worst.worstLoad, bottleneck: worst.bottleneck, firstSaturation: saturated?.month ?? null };
    }
    return results;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, auto, autoBody]);

  const decision = useMemo(() => {
    const s0 = scenarioResults.s0.worstLoad; const s3 = scenarioResults.s3.worstLoad;
    if (s0 <= 100) return { tone: "good", title: "OUI · capacité actuelle", text: "Le volume saisi reste absorbable sans dépasser 100 % de charge sur l'horizon." };
    if (s3 <= 100) return { tone: "watch", title: "OUI · sous conditions", text: `Le scénario cible sécurise le volume. Le goulot sans action est ${scenarioResults.s0.bottleneck}.` };
    return { tone: "bad", title: "NON · capacité cible insuffisante", text: `Même avec les leviers configurés, ${scenarioResults.s3.bottleneck} dépasse la capacité cible.` };
  }, [scenarioResults]);

  const actions = useMemo(() => {
    const rows: Array<{ priority: "Critique" | "Haute" | "Normale"; action: string; pilot: string; impact: string }> = [];
    for (const def of STAGES) {
      const cfg = settings.stages[def.key]; const metric = effectiveStage(def.key);
      const currentProd = metric.productivity ?? cfg.targetProductivityPct;
      const miniHoursDriven = (def.key === "mecanique" || def.key === "carrosserie") && settings.forecast.some((row) => row.mini > 0);
      const futureDemanded = miniHoursDriven || settings.forecast.some((row) => row.bmw + row.mini + row.other > 0 && (brandTouch(def.key, "bmw") + brandTouch(def.key, "mini") + brandTouch(def.key, "other")) > 0);
      if (futureDemanded && metric.capacity <= 0) rows.push({ priority: "Critique", action: `Renseigner / créer la capacité ${def.label}`, pilot: "Direction / CDS", impact: "Simulation bloquée" });
      if (cfg.targetProductivityPct > currentProd + 1) rows.push({ priority: "Haute", action: `${def.label} · atteindre ${fmt(cfg.targetProductivityPct, 0)} % de productivité`, pilot: "CDS / CE", impact: `+${fmt((cfg.targetProductivityPct / Math.max(1, currentProd) - 1) * 100, 0)} % capacité` });
      if (cfg.hires > 0) rows.push({ priority: "Haute", action: `${def.label} · recruter ${fmt(cfg.hires, cfg.hires % 1 ? 1 : 0)} ETP dès ${monthLabel(cfg.hireStartMonth)}`, pilot: "Direction / RH", impact: `Ramp-up ${settings.rampUpPct.join(" → ")} %` });
      if (cfg.targetShifts > cfg.currentShifts) rows.push({ priority: "Haute", action: `${def.label} · passer de ${fmt(cfg.currentShifts, 0)} à ${fmt(cfg.targetShifts, 0)} shifts`, pilot: "Direction / Production", impact: "Capacité physique" });
      if (cfg.equipmentGainPct > 0) rows.push({ priority: "Normale", action: `${def.label} · sécuriser équipements / maintenance`, pilot: "Maintenance", impact: `+${fmt(cfg.equipmentGainPct, 0)} % capacité` });
    }
    for (const def of BODY) {
      const cfg = settings.bodyshop[def.key]; const metric = effectiveBody(def.key); const currentProd = metric.productivity ?? cfg.targetProductivityPct;
      if (cfg.targetProductivityPct > currentProd + 1) rows.push({ priority: "Haute", action: `${def.label} · cible productivité ${fmt(cfg.targetProductivityPct, 0)} %`, pilot: "CDS Carrosserie", impact: "Débit carrosserie" });
      if (cfg.hires > 0) rows.push({ priority: "Haute", action: `${def.label} · +${fmt(cfg.hires, cfg.hires % 1 ? 1 : 0)} ETP à partir de ${monthLabel(cfg.hireStartMonth)}`, pilot: "Direction / RH", impact: "Capacitaire carrosserie" });
    }
    return rows.slice(0, 16);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, auto, autoBody]);

  const matrix = useMemo(() => {
    const fixPcts = [70, 80, 90, 100, 110, 120]; const boxPcts = [90, 100, 110, 120, 130, 140];
    const fix = effectiveBody("fixline"); const box = effectiveBody("box"); const tol = effectiveBody("tolerie");
    const sharesRaw = { fixline: fix.share, box: box.share, tolerie: tol.share };
    const sum = Object.values(sharesRaw).reduce((a, b) => a + Math.max(0, b), 0) || 100;
    const shares = { fixline: Math.max(0, sharesRaw.fixline) / sum, box: Math.max(0, sharesRaw.box) / sum, tolerie: Math.max(0, sharesRaw.tolerie) / sum };
    const fixCurrentProd = fix.productivity && fix.productivity > 0 ? fix.productivity : 100;
    const boxCurrentProd = box.productivity && box.productivity > 0 ? box.productivity : 100;
    const tolCurrentProd = tol.productivity && tol.productivity > 0 ? tol.productivity : 100;
    const tolTarget = settings.bodyshop.tolerie.targetProductivityPct;
    const capacity = (fixPct: number, boxPct: number) => {
      const candidates: number[] = [];
      const fixCap = fix.capacity * Math.max(1, fixPct / fixCurrentProd); if (shares.fixline > 0 && fixCap > 0) candidates.push(fixCap / shares.fixline);
      const boxCap = box.capacity * Math.max(1, boxPct / boxCurrentProd); if (shares.box > 0 && boxCap > 0) candidates.push(boxCap / shares.box);
      const tolCap = tol.capacity * Math.max(1, tolTarget / tolCurrentProd); if (shares.tolerie > 0 && tolCap > 0) candidates.push(tolCap / shares.tolerie);
      return candidates.length ? Math.min(...candidates) : 0;
    };
    const cells = boxPcts.map((boxPct) => fixPcts.map((fixPct) => capacity(fixPct, boxPct)));
    return { fixPcts, boxPcts, cells, max: Math.max(0, ...cells.flat()) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bodyshop, autoBody]);

  const latestS3 = scenarioResults.s3.months.at(-1);
  const latestS0 = scenarioResults.s0.months.at(-1);
  const monthlyBase = auto.entriesAvg * settings.workdaysPerMonth;

  async function save() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/capacity-simulator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
      const payload = await response.json() as { saved?: boolean; updatedAt?: string; updatedBy?: string; error?: string };
      if (!response.ok || !payload.saved) throw new Error(payload.error || "Sauvegarde impossible.");
      setSavedMeta({ at: payload.updatedAt ?? null, by: payload.updatedBy ?? null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sauvegarde impossible."); }
    finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div className={styles.heroTop}><a href="/" className={styles.back}>← KPI CRVO</a><div className={styles.heroActions}><button onClick={() => window.print()}>Exporter PDF</button><button onClick={() => void load()} disabled={loading}>Actualiser KPI</button><button className={styles.primary} onClick={() => void save()} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer l'étude"}</button></div></div>
      <div className={styles.heroGrid}><div><span className={styles.eyebrow}>PLANIFICATION INDUSTRIELLE · LENS</span><h1>Simulateur capacitaire</h1><p>Projection des volumes BMW / MINI, charge par métier, goulots, ramp-up, scénarios et plan d'action. Les cadences démontrées sont recalculées depuis les données KPI réelles et la charge MINI utilise désormais le standard temps réel observé à Lens.</p></div><div className={`${styles.decision} ${styles[decision.tone]}`}><span>DÉCISION VOLUME</span><strong>{decision.title}</strong><p>{decision.text}</p></div></div>
      <div className={styles.meta}><span>Source opérationnelle : <b>{dashboard?.latestSource ?? "—"}</b></span><span>MINI : <b>DEFLEET + standard Lens 569 dossiers</b></span><span>Fenêtre : <b>{settings.baselineWindowDays} jours</b></span><span>Dernière sauvegarde : <b>{savedMeta.at ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(savedMeta.at)) : "jamais"}</b>{savedMeta.by ? ` · ${savedMeta.by}` : ""}</span></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {loading && <div className={styles.loading}>Chargement des données réelles et recalcul du modèle capacitaire…</div>}

    <section className={styles.kpis}>
      <article><span>CADENCE ENTRÉES ACTUELLE</span><strong>{fmt(auto.entriesAvg)} VO/j</strong><small>≈ {fmt(monthlyBase, 0)} VO/mois sur {settings.workdaysPerMonth} jours</small></article>
      <article><span>CARROSSERIE ACTUELLE</span><strong>{fmt(auto.stages.carrosserie.avgDaily)} VO/j</strong><small>P90 démontré : {fmt(auto.stages.carrosserie.p90Daily)} VO/j</small></article>
      <article><span>CHARGE SANS ACTION</span><strong className={scenarioResults.s0.worstLoad > 100 ? styles.dangerText : scenarioResults.s0.worstLoad > 90 ? styles.warnText : styles.goodText}>{fmt(scenarioResults.s0.worstLoad, 0)} %</strong><small>Goulot : {scenarioResults.s0.bottleneck}</small></article>
      <article><span>CHARGE SCÉNARIO CIBLE</span><strong className={scenarioResults.s3.worstLoad > 100 ? styles.dangerText : scenarioResults.s3.worstLoad > 90 ? styles.warnText : styles.goodText}>{fmt(scenarioResults.s3.worstLoad, 0)} %</strong><small>{scenarioResults.s3.firstSaturation ? `Saturation : ${monthLabel(scenarioResults.s3.firstSaturation)}` : "Horizon sécurisé"}</small></article>
      <article><span>CAPACITAIRE CARROSSERIE</span><strong>{fmt(matrix.max)} VO/j</strong><small>Maximum théorique de la matrice Fixline × BOX</small></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>01 · VOLUMES</span><h2>Projection BMW / MINI</h2><p>Les volumes saisis sont additionnels au run-rate actuel. Le plan MINI est préchargé depuis le DEFLEET Lens : septembre 65, octobre 113, novembre 134 et décembre 50. Les valeurs restent modifiables si le plan évolue.</p></div><div className={styles.inlineSettings}><label>Jours ouvrés / mois<input type="number" value={settings.workdaysPerMonth} min={15} max={31} onChange={(e) => setSettings((s) => ({ ...s, workdaysPerMonth: clamp(Number(e.target.value), 15, 31) }))} /></label><label>Historique KPI<input type="number" value={settings.baselineWindowDays} min={5} max={120} onChange={(e) => setSettings((s) => ({ ...s, baselineWindowDays: clamp(Number(e.target.value), 5, 120) }))} /><small>jours</small></label></div></div>
      <div className={styles.forecastGrid}>{settings.forecast.map((row, index) => <article key={row.month}><strong>{monthLabel(row.month)}</strong><label>BMW<input type="number" min={0} value={row.bmw} onChange={(e) => updateForecast(index, { bmw: Math.max(0, Number(e.target.value) || 0) })} /></label><label>MINI<input type="number" min={0} value={row.mini} onChange={(e) => updateForecast(index, { mini: Math.max(0, Number(e.target.value) || 0) })} /></label><label>Autres<input type="number" min={0} value={row.other} onChange={(e) => updateForecast(index, { other: Math.max(0, Number(e.target.value) || 0) })} /></label><small>Total additionnel : <b>{fmt(row.bmw + row.mini + row.other, 0)} VO</b>{row.mini > 0 ? ` · MINI ${fmt(row.mini * MINI_BODYSHOP_HOURS, 0)} h carro+peinture / ${fmt(row.mini * MINI_LENS_STANDARD.mechanicsHours, 0)} h méca` : ""}</small></article>)}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>01B · RÉFÉRENCE MINI LENS</span><h2>Standard de charge dossier MINI</h2><p>Base observée sur 569 MINI traitées à Lens. Ces temps ne sont pas ajoutés comme un simple taux de passage : ils alimentent directement la charge horaire mécanique et carrosserie du simulateur afin de ne pas sous-estimer les volumes MINI.</p></div></div>
      <div className={styles.forecastGrid}>
        <article><strong>{fmt(MINI_LENS_STANDARD.bodyHours, 2)} h</strong><small>Carrosserie moyenne / dossier MINI</small></article>
        <article><strong>{fmt(MINI_LENS_STANDARD.paintHours, 2)} h</strong><small>Peinture moyenne / dossier MINI</small></article>
        <article><strong>{fmt(MINI_BODYSHOP_HOURS, 2)} h</strong><small>Charge carrosserie + peinture utilisée dans le modèle</small></article>
        <article><strong>{fmt(MINI_LENS_STANDARD.mechanicsHours, 2)} h</strong><small>Mécanique moyenne / dossier MINI</small></article>
        <article><strong>{fmt(MINI_LENS_STANDARD.damageCount, 1)}</strong><small>Damage count moyen · indicateur de complexité, sans double comptage des heures</small></article>
        <article><strong>{fmt(MINI_DEFLEET_LENS_TOTAL, 0)} MINI</strong><small>DEFLEET Lens total : 2 avril + 29 août + 65 sept. + 113 oct. + 134 nov. + 50 déc.</small></article>
      </div>
      <p className={styles.tableNote}>Si la période Productivité est certifiée, le modèle compare les heures MINI nécessaires aux heures achetées réelles disponibles par jour. Si la capacité horaire n'est pas exploitable, il revient automatiquement au taux de passage pour ne pas bloquer l'étude.</p>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>02 · SCÉNARIOS</span><h2>Comparaison automatique</h2><p>Le taux de charge retenu est celui du métier ou sous-process carrosserie le plus contraint sur tout l'horizon.</p></div></div>
      <div className={styles.scenarioGrid}>{SCENARIOS.map((def) => { const result = scenarioResults[def.key]; return <article key={def.key} className={result.worstLoad > 100 ? styles.scenarioBad : result.worstLoad > 90 ? styles.scenarioWatch : styles.scenarioGood}><span>{def.label}</span><strong>{fmt(result.worstLoad, 0)} %</strong><p>{def.subtitle}</p><dl><div><dt>Goulot</dt><dd>{result.bottleneck}</dd></div><div><dt>Saturation</dt><dd>{result.firstSaturation ? monthLabel(result.firstSaturation) : "Non"}</dd></div></dl></article>; })}</div>
      <div className={styles.timeline}>{settings.forecast.map((row, index) => { const s0 = scenarioResults.s0.months[index]?.worstLoad ?? 0; const s3 = scenarioResults.s3.months[index]?.worstLoad ?? 0; return <div className={styles.timelineRow} key={row.month}><span>{monthLabel(row.month)}</span><div><i className={styles.barS0} style={{ width: `${Math.min(100, s0 / 1.5)}%` }} /><b>{fmt(s0, 0)} % S0</b></div><div><i className={styles.barS3} style={{ width: `${Math.min(100, s3 / 1.5)}%` }} /><b>{fmt(s3, 0)} % S3</b></div></div>; })}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>03 · CHAÎNE DE VALEUR</span><h2>Capacité par métier</h2><p>Capacité par défaut = P90 réellement démontré sur la fenêtre sélectionnée. Pour MINI, la mécanique et la carrosserie utilisent le standard horaire Lens ; les autres métiers conservent un taux de passage modifiable.</p></div></div>
      <div className={styles.tableWrap}><table className={styles.capacityTable}><thead><tr><th>Métier</th><th>Run-rate</th><th>P90 réel</th><th>Capacité retenue</th><th>ETP</th><th>Productivité</th><th>Cible</th><th>+ ETP</th><th>Début ramp-up</th><th>Shifts act. → cible</th><th>Gain outil</th><th>Passage BMW</th><th>MINI · règle</th><th>Charge S0</th><th>Charge S3</th></tr></thead><tbody>{STAGES.map((def) => { const metric = auto.stages[def.key]; const cfg = settings.stages[def.key]; const effective = effectiveStage(def.key); const s0 = latestS0?.stageLoads[def.label] ?? 0; const s3 = latestS3?.stageLoads[def.label] ?? 0; const miniHours = miniHoursForStage(def.key); return <tr key={def.key}><td><strong>{def.label}</strong><small>{metric.source}</small></td><td>{fmt(metric.avgDaily)}<small>VO/j</small></td><td>{fmt(metric.p90Daily)}<small>pic {fmt(metric.peakDaily)}</small></td><td>{inputNumber(cfg.capacityManual, (value) => updateStage(def.key, { capacityManual: value }), metric.p90Daily ? fmt(metric.p90Daily) : "manuel", .1)}</td><td>{inputNumber(cfg.etpManual, (value) => updateStage(def.key, { etpManual: value }), effective.etp ? fmt(effective.etp, 0) : "auto", .5)}</td><td>{metric.productivityPct == null ? "—" : pct(metric.productivityPct)}</td><td>{inputNumber(cfg.targetProductivityPct, (value) => updateStage(def.key, { targetProductivityPct: value ?? 100 }), "100", 1, 50, 250)}</td><td>{inputNumber(cfg.hires, (value) => updateStage(def.key, { hires: value ?? 0 }), "0", .5, 0, 100)}</td><td><select value={cfg.hireStartMonth} onChange={(e) => updateStage(def.key, { hireStartMonth: e.target.value })}>{settings.forecast.map((row) => <option key={row.month} value={row.month}>{monthLabel(row.month)}</option>)}</select></td><td><div className={styles.dual}>{inputNumber(cfg.currentShifts, (value) => updateStage(def.key, { currentShifts: value ?? 1 }), "1", .5, .5, 4)}<span>→</span>{inputNumber(cfg.targetShifts, (value) => updateStage(def.key, { targetShifts: value ?? 1 }), "1", .5, .5, 4)}</div></td><td>{inputNumber(cfg.equipmentGainPct, (value) => updateStage(def.key, { equipmentGainPct: value ?? 0 }), "0", 1, 0, 200)}</td><td>{inputNumber(cfg.bmwTouchPct, (value) => updateStage(def.key, { bmwTouchPct: value }), fmt(metric.touchPct, 0), 1, 0, 200)}</td><td>{miniHours > 0 ? <><strong>{fmt(miniHours, 2)} h/VO</strong><small>{def.key === "carrosserie" ? "4,61 carro + 3,31 peinture" : "standard Lens"}</small></> : inputNumber(cfg.miniTouchPct, (value) => updateStage(def.key, { miniTouchPct: value }), fmt(metric.touchPct, 0), 1, 0, 200)}</td><td><span className={s0 > 100 ? styles.loadBad : s0 > 90 ? styles.loadWatch : styles.loadGood}>{fmt(s0, 0)} %</span></td><td><span className={s3 > 100 ? styles.loadBad : s3 > 90 ? styles.loadWatch : styles.loadGood}>{fmt(s3, 0)} %</span></td></tr>; })}</tbody></table></div>
      <p className={styles.tableNote}>Les champs vides utilisent automatiquement la valeur KPI. MINI : carrosserie et mécanique sont calculées en charge horaire réelle Lens ; Jantes et flux non présents dans les sources doivent rester paramétrés manuellement avant décision.</p>
    </section>

    <section className={styles.twoColumns}>
      <div className={styles.panel}>
        <div className={styles.panelHead}><div><span>04 · CARROSSERIE</span><h2>Fixline / BOX / Tôlerie</h2><p>Le sous-process le plus chargé peut devenir le vrai goulot même si le total carrosserie semble absorbable. La charge MINI de 7,92 h/dossier est répartie selon la part de flux retenue.</p></div></div>
        <div className={styles.tableWrap}><table className={styles.bodyTable}><thead><tr><th>Flux</th><th>P90</th><th>Part du flux</th><th>ETP</th><th>Prod. actuelle</th><th>Cible</th><th>+ ETP</th><th>Shifts</th><th>Gain outil</th></tr></thead><tbody>{BODY.map((def) => { const metric = autoBody.bodyshop[def.key]; const cfg = settings.bodyshop[def.key]; const effective = effectiveBody(def.key); return <tr key={def.key}><td><strong>{def.label}</strong><small>{metric.source}</small></td><td>{fmt(metric.p90Daily)}</td><td>{inputNumber(cfg.routeSharePct, (value) => updateBody(def.key, { routeSharePct: value }), fmt(metric.routeSharePct, 0), 1, 0, 100)}</td><td>{inputNumber(cfg.etpManual, (value) => updateBody(def.key, { etpManual: value }), effective.etp ? fmt(effective.etp, 0) : "auto", .5)}</td><td>{metric.productivityPct == null ? "—" : pct(metric.productivityPct)}</td><td>{inputNumber(cfg.targetProductivityPct, (value) => updateBody(def.key, { targetProductivityPct: value ?? 100 }), "100", 1, 50, 250)}</td><td>{inputNumber(cfg.hires, (value) => updateBody(def.key, { hires: value ?? 0 }), "0", .5, 0, 100)}</td><td><div className={styles.dual}>{inputNumber(cfg.currentShifts, (value) => updateBody(def.key, { currentShifts: value ?? 1 }), "3", .5, .5, 4)}<span>→</span>{inputNumber(cfg.targetShifts, (value) => updateBody(def.key, { targetShifts: value ?? 1 }), "3", .5, .5, 4)}</div></td><td>{inputNumber(cfg.equipmentGainPct, (value) => updateBody(def.key, { equipmentGainPct: value ?? 0 }), "0", 1, 0, 200)}</td></tr>; })}</tbody></table></div>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}><div><span>05 · MATRICE</span><h2>Capacitaire carrosserie</h2><p>Lecture type Ingrandes : productivité Fixline en colonnes, BOX en lignes. La cellule indique le capacitaire interne théorique en VO/j selon la répartition actuelle des flux.</p></div></div>
        <div className={styles.matrixWrap}><table className={styles.matrix}><thead><tr><th>BOX \ Fixline</th>{matrix.fixPcts.map((value) => <th key={value}>{value}%</th>)}</tr></thead><tbody>{matrix.boxPcts.map((boxPct, row) => <tr key={boxPct}><th>{boxPct}%</th>{matrix.fixPcts.map((fixPct, column) => { const value = matrix.cells[row][column]; const selected = Math.abs(fixPct - settings.bodyshop.fixline.targetProductivityPct) <= 5 && Math.abs(boxPct - settings.bodyshop.box.targetProductivityPct) <= 5; return <td key={fixPct} className={selected ? styles.matrixSelected : ""}>{value > 0 ? fmt(value, 1) : "—"}</td>; })}</tr>)}</tbody></table></div>
        <div className={styles.matrixFooter}><span>Capacitaire maximum calculé</span><strong>{fmt(matrix.max)} VO/j</strong></div>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>06 · RAMP-UP & DISPONIBILITÉ</span><h2>Vitesse de montée en capacité</h2><p>Un recrutement n'est jamais compté immédiatement à 100 %. Chaque ETP ajouté suit la courbe ci-dessous.</p></div><div className={styles.inlineSettings}><label>Disponibilité actuelle<input type="number" min={50} max={110} value={settings.availabilityCurrentPct} onChange={(e) => setSettings((s) => ({ ...s, availabilityCurrentPct: clamp(Number(e.target.value), 50, 110) }))} /><small>%</small></label><label>Disponibilité cible<input type="number" min={50} max={110} value={settings.availabilityTargetPct} onChange={(e) => setSettings((s) => ({ ...s, availabilityTargetPct: clamp(Number(e.target.value), 50, 110) }))} /><small>%</small></label></div></div>
      <div className={styles.ramp}>{settings.rampUpPct.map((value, index) => <label key={index}><span>M{index + 1}</span><input type="number" min={0} max={150} value={value} onChange={(e) => setSettings((current) => ({ ...current, rampUpPct: current.rampUpPct.map((item, itemIndex) => itemIndex === index ? clamp(Number(e.target.value), 0, 150) : item) }))} /><b>%</b></label>)}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>07 · PLAN D'ACTION</span><h2>Actions générées par le scénario cible</h2><p>La liste évolue automatiquement avec les objectifs de productivité, recrutements, shifts et besoins de capacité saisis dans le simulateur.</p></div></div>
      {actions.length ? <div className={styles.actionList}>{actions.map((action, index) => <article key={`${action.action}-${index}`}><span className={action.priority === "Critique" ? styles.priorityCritical : action.priority === "Haute" ? styles.priorityHigh : styles.priorityNormal}>{action.priority}</span><div><strong>{action.action}</strong><small>Pilote : {action.pilot}</small></div><b>{action.impact}</b></article>)}</div> : <div className={styles.empty}>Aucune action additionnelle configurée. Saisis les volumes et les leviers cibles pour générer le plan.</div>}
    </section>

    <footer className={styles.footer}><div><b>Lecture de confiance</b><span>Les valeurs « réel / P90 / pic » viennent des sources KPI. Les volumes MINI sont préchargés depuis le DEFLEET Lens et les temps MINI viennent de l'échantillon Lens de 569 dossiers. Les autres volumes futurs, objectifs, capacités manuelles et leviers restent des hypothèses de simulation et sont audités à chaque sauvegarde.</span></div><button onClick={() => setSettings(defaultSettings())}>Réinitialiser les hypothèses</button></footer>
  </main>;
}
