"use client";

import { useEffect, useMemo, useState } from "react";
import { activityColor } from "../activity-colors";
import styles from "./capacitaire.module.css";
import { exportCapacityPptx } from "./pptx-export";

type StaffMember = {
  employeeKey: string;
  matricule?: string | null;
  fullName: string;
  jobTitle?: string | null;
  sectorKey: string;
  sectorLabel?: string | null;
  workcenterKey?: string | null;
  workcenterLabel?: string | null;
  teamCode?: string | null;
  included: boolean;
  boughtHours?: number;
  soldHours?: number;
  rawSoldHours?: number;
  productivity?: number | null;
  comparable?: boolean;
};

type Sector = {
  sectorKey: string;
  sectorLabel: string;
  etp: number;
  people: number;
  observedPeople?: number;
  availableEtp?: number;
  etpSource?: string;
  boughtHoursPerDay: number;
  soldHoursPerDay: number;
  productivity: number | null;
  productionDays: number;
  vehiclesPerDay: number;
  miniHoursPerVehicle: number | null;
  miniHourSource: string;
};

type BillingRatio = {
  sectorKey: string;
  billedVehicles: number;
  soldHours: number;
  avgHoursPerVehicle: number;
};

type BodyshopHistoryMonth = {
  month: string;
  fixline: number;
  box: number;
  weekendExtra: number;
  treated: number;
  observedDays: number;
  note?: string | null;
};

type BodyshopHistory = {
  source?: string;
  fullMonthCount?: number;
  averageMonthlyTreated?: number;
  averageDailyTreated?: number;
  averageFixlineMonthly?: number;
  averageBoxMonthly?: number;
  averageBacklog?: number;
  boxCurrentProductivity?: number | null;
  fixlineCurrentProductivity?: number | null;
  fixlineComparable?: boolean;
  productivityPeriodEnd?: string | null;
  productivityNote?: string | null;
  months?: BodyshopHistoryMonth[];
};

type HistoricalProductivitySector = {
  sectorKey: string;
  boughtHours: number;
  soldHours: number;
  productivity: number | null;
  monthCount: number;
  fixlineExcluded: boolean;
};

type HistoricalProductivity = {
  connected?: boolean;
  source?: string;
  sourceSheet?: string;
  method?: string;
  period?: { start?: string; end?: string; months?: number };
  sectors?: HistoricalProductivitySector[];
};

type Payload = {
  period?: { start?: string; end?: string; etpAsOf?: string; presenceDays?: number };
  inputVehiclesPerDay?: number;
  sectors?: Sector[];
  miniStandard?: { sampleVehicles?: number; bodyshopHours?: number; mechanicsHours?: number };
  roster?: StaffMember[];
  billingRatios?: BillingRatio[];
  bodyshopHistory?: BodyshopHistory;
  historicalProductivity?: HistoricalProductivity;
  error?: string;
};

type Verdict = "pass" | "tension" | "critical" | "insufficient";

type Result = Sector & {
  baseVehicles: number;
  baseBought: number;
  baseSold: number;
  miniAtPost: number;
  miniFlowRate: number;
  miniHours: number;
  points: number | null;
  targetProd: number | null;
  extraEtp: number | null;
  verdict: Verdict;
  rosterTotal: number;
  selectedEtp: number;
  comparablePeople: number;
  selectedBoughtPeriod: number;
  selectedSoldPeriod: number;
  currentProductivity: number | null;
  billingAvgHours: number | null;
  referenceBilledVehicles: number;
  bodyshopLoadPct: number | null;
  historicalBoughtHours: number;
  historicalSoldHours: number;
  historicalMonthCount: number;
  historicalSource: boolean;
};

type Matrix = {
  rowLabels: number[];
  colLabels: number[];
  values: number[][];
  currentRow: number;
  currentCol: number;
  targetRow: number;
  targetCol: number;
  currentCapacity: number;
  requiredCapacity: number;
  backlog: number;
  historicalMonthly: number;
  fullMonthCount: number;
  boxCurrentProductivity: number | null;
  fixlineCurrentProductivity: number | null;
  productivityPeriodEnd?: string | null;
};

const DEFLEET: Record<string, number> = {
  "2026-09": 65,
  "2026-10": 113,
  "2026-11": 134,
  "2026-12": 50,
};
const MONTHS = Object.keys(DEFLEET);
const HIDDEN_MINI_SECTORS = new Set(["jantes", "jante", "photo", "photos"]);
const MINI_FLOW_RATES: Record<string, number> = {
  expertise: 1,
  mecanique: 0.7,
  dsp: 0.25,
  carrosserie: 1,
  preparation: 1,
  qualite: 1,
};
const BOX_ROWS = [80, 90, 100, 110, 115, 120, 130, 140];
const FIXLINE_COLS = [50, 60, 65, 70, 80, 90, 100, 110, 120];
const BODYSHOP_REFERENCE = [
  [23.4, 25.8, 27.0, 28.2, 30.6, 33.0, 35.4, 37.7, 40.1],
  [24.3, 26.7, 27.9, 29.0, 31.4, 33.8, 36.2, 38.6, 41.0],
  [25.1, 27.5, 28.7, 29.9, 32.3, 34.7, 37.1, 39.5, 41.8],
  [26.0, 28.4, 29.6, 30.8, 33.2, 35.5, 37.9, 40.3, 42.7],
  [26.4, 28.8, 30.0, 31.2, 33.6, 36.0, 38.4, 40.7, 43.1],
  [26.8, 29.2, 30.4, 31.6, 34.0, 36.4, 38.8, 41.2, 43.6],
  [27.7, 30.1, 31.3, 32.5, 34.9, 37.3, 39.6, 42.0, 44.4],
  [28.6, 31.0, 32.1, 33.3, 35.7, 38.1, 40.5, 42.9, 45.3],
];

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function workdays(value: string) {
  const [year, month] = value.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let total = 0;
  for (let day = 1; day <= last; day += 1) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (dow !== 0 && dow !== 6) total += 1;
  }
  return total;
}

function label(value: Verdict) {
  return value === "pass" ? "PASSE" : value === "tension" ? "TENSION" : value === "critical" ? "CRITIQUE" : "DONNÉE INSUFFISANTE";
}

function normalizedSector(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function visibleMiniSector(sector: Sector) {
  const key = normalizedSector(sector.sectorKey);
  const sectorLabel = normalizedSector(sector.sectorLabel);
  return !HIDDEN_MINI_SECTORS.has(key) && ![...HIDDEN_MINI_SECTORS].some((hidden) => sectorLabel === hidden || sectorLabel.includes(`${hidden} `) || sectorLabel.includes(` ${hidden}`));
}

function configuredMiniRate(sector: Sector, historicalPass: number) {
  const key = normalizedSector(sector.sectorKey);
  const byKey = MINI_FLOW_RATES[key];
  if (byKey != null) return byKey;
  const byLabel = MINI_FLOW_RATES[normalizedSector(sector.sectorLabel)];
  return byLabel != null ? byLabel : historicalPass;
}

function makeMatrix(body: Result | undefined, days: number, history?: BodyshopHistory): Matrix | null {
  if (!body || days <= 0 || body.vehiclesPerDay <= 0) return null;
  const currentRow = 100;
  const currentCol = 100;
  const rowIndex = BOX_ROWS.indexOf(currentRow);
  const colIndex = FIXLINE_COLS.indexOf(currentCol);
  const neutralRef = BODYSHOP_REFERENCE[rowIndex]?.[colIndex] ?? 37.1;
  const scale = body.vehiclesPerDay / neutralRef;
  const values = BODYSHOP_REFERENCE.map((row) => row.map((value) => value * scale));
  const requiredCapacity = body.vehiclesPerDay + body.miniAtPost / days;
  let targetRow = currentRow;
  let targetCol = currentCol;
  let best = Number.POSITIVE_INFINITY;
  let bestCap = Number.POSITIVE_INFINITY;

  for (let i = 0; i < BOX_ROWS.length; i += 1) {
    for (let j = 0; j < FIXLINE_COLS.length; j += 1) {
      const row = BOX_ROWS[i];
      const col = FIXLINE_COLS[j];
      const capacity = values[i][j];
      if (row < currentRow || col < currentCol || capacity + 1e-9 < requiredCapacity) continue;
      const cost = Math.abs(row - currentRow) + Math.abs(col - currentCol);
      if (cost < best || (cost === best && capacity < bestCap)) {
        best = cost;
        bestCap = capacity;
        targetRow = row;
        targetCol = col;
      }
    }
  }

  return {
    rowLabels: BOX_ROWS,
    colLabels: FIXLINE_COLS,
    values,
    currentRow,
    currentCol,
    targetRow,
    targetCol,
    currentCapacity: body.vehiclesPerDay,
    requiredCapacity,
    backlog: num(history?.averageBacklog),
    historicalMonthly: num(history?.averageMonthlyTreated),
    fullMonthCount: num(history?.fullMonthCount),
    boxCurrentProductivity: history?.boxCurrentProductivity == null ? null : num(history.boxCurrentProductivity),
    fixlineCurrentProductivity: history?.fixlineCurrentProductivity == null ? null : num(history.fixlineCurrentProductivity),
    productivityPeriodEnd: history?.productivityPeriodEnd ?? null,
  };
}

export default function CapacitySimulatorHistorical() {
  const [data, setData] = useState<Payload | null>(null);
  const [month, setMonth] = useState(MONTHS[0]);
  const [mini, setMini] = useState(DEFLEET[MONTHS[0]]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openSector, setOpenSector] = useState<string | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/capacity-simple", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as Payload;
      if (!response.ok || payload.error) throw new Error(payload.error || "Calcul capacitaire indisponible.");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Calcul capacitaire indisponible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const days = useMemo(() => workdays(month), [month]);

  const rows = useMemo<Result[]>(() => {
    const inbound = num(data?.inputVehiclesPerDay);
    const roster = data?.roster ?? [];
    const billing = data?.billingRatios ?? [];
    const historical = data?.historicalProductivity?.sectors ?? [];
    const periodDays = Math.max(1, num(data?.period?.presenceDays));
    const history = data?.bodyshopHistory;
    const historicalBodyDaily = num(history?.averageDailyTreated);
    const historicalBodyMonthly = num(history?.averageMonthlyTreated);

    return (data?.sectors ?? []).filter(visibleMiniSector).map((sector) => {
      const people = roster.filter((person) => person.sectorKey === sector.sectorKey);
      const selectedPeople = people.filter((person) => person.included);
      const selected = people.length ? selectedPeople.length : num(sector.etp);
      const selectedShare = people.length ? selected / people.length : 1;
      const selectedBoughtPeriod = people.length
        ? selectedPeople.reduce((sum, person) => sum + num(person.boughtHours), 0)
        : num(sector.boughtHoursPerDay) * periodDays;
      const selectedSoldPeriod = people.length
        ? selectedPeople.reduce((sum, person) => sum + (person.comparable ? num(person.soldHours) : 0), 0)
        : num(sector.soldHoursPerDay) * periodDays;
      const comparablePeople = people.length ? selectedPeople.filter((person) => person.comparable).length : selected;
      const currentProductivity = selectedBoughtPeriod > 0 ? (selectedSoldPeriod / selectedBoughtPeriod) * 100 : null;
      const baseline = historical.find((item) => item.sectorKey === sector.sectorKey);
      const productivity = baseline?.productivity == null ? currentProductivity : num(baseline.productivity);
      const ratio = billing.find((item) => item.sectorKey === sector.sectorKey);
      const billingAvgHours = ratio && num(ratio.avgHoursPerVehicle) > 0 ? num(ratio.avgHoursPerVehicle) : null;
      const estimatedVehiclesPeriod = billingAvgHours ? selectedSoldPeriod / billingAvgHours : 0;
      const isBody = normalizedSector(sector.sectorKey) === "carrosserie";
      const calculatedVehiclesPerDay = billingAvgHours ? estimatedVehiclesPeriod / periodDays : 0;
      const vehiclesPerDay = isBody && historicalBodyDaily > 0 ? historicalBodyDaily * selectedShare : calculatedVehiclesPerDay;
      const baseVehicles = isBody && historicalBodyMonthly > 0 ? historicalBodyMonthly * selectedShare : vehiclesPerDay * days;
      const baseBought = (selectedBoughtPeriod / periodDays) * days;
      const baseSold = productivity != null && baseBought > 0 ? baseBought * (productivity / 100) : (selectedSoldPeriod / periodDays) * days;
      const referenceVehiclesPerDay = isBody && historicalBodyDaily > 0
        ? vehiclesPerDay
        : ratio && periodDays > 0
          ? num(ratio.billedVehicles) / periodDays
          : vehiclesPerDay;
      const historicalPass = inbound > 0 ? Math.min(1, Math.max(0, referenceVehiclesPerDay / inbound)) : 0;
      const miniFlowRate = configuredMiniRate(sector, historicalPass);
      const hoursPerMini = sector.miniHourSource === "standard_mini_lens"
        ? sector.miniHoursPerVehicle == null ? null : num(sector.miniHoursPerVehicle)
        : billingAvgHours;
      const miniAtPost = mini * miniFlowRate;
      const miniHours = hoursPerMini == null ? 0 : miniAtPost * hoursPerMini;
      const points = hoursPerMini != null && baseBought > 0 ? (miniHours / baseBought) * 100 : null;
      const targetProd = points != null && productivity != null ? productivity + points : null;
      const soldCapacityPerEtp = selected > 0 && baseSold > 0 ? baseSold / selected : 0;
      const fallbackPerEtp = 7.5 * days * (productivity && productivity > 0 ? productivity / 100 : 1);
      const capacityPerEtp = soldCapacityPerEtp > 0 ? soldCapacityPerEtp : fallbackPerEtp;
      const extraEtp = hoursPerMini != null && capacityPerEtp > 0 ? miniHours / capacityPerEtp : null;
      const bodyshopLoadPct = isBody && baseVehicles > 0 ? (miniAtPost / baseVehicles) * 100 : null;
      const pressure = Math.max(points ?? 0, bodyshopLoadPct ?? 0);
      const verdict: Verdict = selected <= 0 || points == null || (!isBody && billingAvgHours == null)
        ? "insufficient"
        : pressure <= 5
          ? "pass"
          : pressure <= 10
            ? "tension"
            : "critical";

      return {
        ...sector,
        etp: selected,
        productivity,
        vehiclesPerDay,
        miniHoursPerVehicle: hoursPerMini,
        baseVehicles,
        baseBought,
        baseSold,
        miniAtPost,
        miniFlowRate,
        miniHours,
        points,
        targetProd,
        extraEtp,
        verdict,
        rosterTotal: people.length || num(sector.etp),
        selectedEtp: selected,
        comparablePeople,
        selectedBoughtPeriod,
        selectedSoldPeriod,
        currentProductivity,
        billingAvgHours,
        referenceBilledVehicles: num(ratio?.billedVehicles),
        bodyshopLoadPct,
        historicalBoughtHours: num(baseline?.boughtHours),
        historicalSoldHours: num(baseline?.soldHours),
        historicalMonthCount: num(baseline?.monthCount),
        historicalSource: Boolean(baseline && baseline.productivity != null),
      };
    });
  }, [data, days, mini]);

  const productivityPressure = useMemo(
    () => rows.filter((row) => row.points != null).sort((a, b) => num(b.points) - num(a.points))[0] ?? null,
    [rows],
  );
  const mostLoaded = useMemo(() => [...rows].sort((a, b) => b.miniHours - a.miniHours)[0] ?? null, [rows]);
  const etpPressure = useMemo(
    () => rows.filter((row) => row.extraEtp != null).sort((a, b) => num(b.extraEtp) - num(a.extraEtp))[0] ?? null,
    [rows],
  );
  const overall: Verdict = rows.some((row) => row.verdict === "critical")
    ? "critical"
    : rows.some((row) => row.verdict === "tension")
      ? "tension"
      : rows.some((row) => row.verdict === "pass")
        ? "pass"
        : "insufficient";
  const body = rows.find((row) => normalizedSector(row.sectorKey) === "carrosserie");
  const matrix = useMemo(() => makeMatrix(body, days, data?.bodyshopHistory), [body, days, data?.bodyshopHistory]);
  const historicalPeriod = data?.historicalProductivity?.period;
  const historicalReady = Boolean(data?.historicalProductivity?.connected && (data?.historicalProductivity?.sectors?.length ?? 0) > 0);

  const openRoster = useMemo(() => {
    if (!openSector) return [];
    const search = rosterSearch.trim().toLowerCase();
    return (data?.roster ?? [])
      .filter((person) => person.sectorKey === openSector)
      .filter((person) => !search || `${person.fullName} ${person.matricule ?? ""} ${person.teamCode ?? ""} ${person.sectorLabel ?? ""} ${person.workcenterLabel ?? ""}`.toLowerCase().includes(search));
  }, [data, openSector, rosterSearch]);
  const openRow = rows.find((row) => row.sectorKey === openSector) ?? null;

  function setSelectedMonth(value: string) {
    setMonth(value);
    setMini(DEFLEET[value] ?? 0);
  }

  function showRoster(sectorKey: string) {
    setOpenSector(sectorKey);
    setRosterSearch("");
  }

  async function toggleStaff(member: StaffMember) {
    if (savingKey) return;
    const next = !member.included;
    setSavingKey(member.employeeKey);
    setData((previous) => previous ? {
      ...previous,
      roster: (previous.roster ?? []).map((person) => person.employeeKey === member.employeeKey ? { ...person, included: next } : person),
    } : previous);
    try {
      const response = await fetch("/api/capacity-simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeKey: member.employeeKey, included: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Enregistrement impossible.");
    } catch (cause) {
      setData((previous) => previous ? {
        ...previous,
        roster: (previous.roster ?? []).map((person) => person.employeeKey === member.employeeKey ? { ...person, included: member.included } : person),
      } : previous);
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSavingKey(null);
    }
  }

  function exportPpt() {
    if (!rows.length) return;
    setExporting(true);
    try {
      exportCapacityPptx({ month, monthLabel: monthLabel(month), mini, days, overall, rows, matrix });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export PowerPoint impossible.");
    } finally {
      window.setTimeout(() => setExporting(false), 300);
    }
  }

  return <main className={styles.page}>
    <header className={styles.hero}>
      <div className={styles.heroTop}>
        <a className={styles.back} href="/">← KPI CRVO</a>
        <div className={styles.heroActions}>
          <button onClick={exportPpt} disabled={exporting || !rows.length}>{exporting ? "Création PPT…" : "Exporter PPT"}</button>
          <button onClick={() => void load()} disabled={loading}>{loading ? "Actualisation…" : "Actualiser"}</button>
        </div>
      </div>
      <div className={styles.heroGrid}>
        <div>
          <span className={styles.eyebrow}>PLANIFICATION INDUSTRIELLE · LENS</span>
          <h1>Simulateur MINI</h1>
          <p>Le socle de productivité est désormais calculé sur les heures achetées / heures vendues des classeurs rendement Lens de mars à juin 2026. La Fixline est exclue de cette référence.</p>
        </div>
        <div className={`${styles.decision} ${styles[overall]}`}>
          <span>DÉCISION DU MOIS</span>
          <strong>{label(overall)}</strong>
          <p>{productivityPressure ? `${productivityPressure.sectorLabel} : effort relatif max +${fmt(productivityPressure.points)} pts. ${mostLoaded ? `${mostLoaded.sectorLabel} reçoit la plus forte charge (+${fmt(mostLoaded.miniHours, 0)} h).` : ""}` : "Données insuffisantes."}</p>
        </div>
      </div>
      <div className={styles.meta}>
        <span>Productivité référence : <b>{historicalReady ? `${dateLabel(historicalPeriod?.start)} → ${dateLabel(historicalPeriod?.end)}` : "indisponible"}</b></span>
        <span>Méthode : <b>Σ heures vendues ÷ Σ heures achetées · Fixline exclue</b></span>
        <span>Effectif : <b>référentiel RH actif au {dateLabel(data?.period?.etpAsOf)}</b></span>
      </div>
    </header>

    {error && <div className={styles.error}><strong>Information</strong><span>{error}</span><button onClick={() => setError("")}>Fermer</button></div>}
    {loading && !data && <div className={styles.loading}>Calcul des effectifs, heures historiques et charge MINI…</div>}

    <section className={styles.controlPanel}>
      <div>
        <span>01 · VOLUME À ABSORBER</span>
        <h2>MINI additionnelles</h2>
        <p>La charge est transformée en heures puis comparée à la capacité vendue obtenue au rendement moyen historique du métier. Les heures disponibles restent recalées sur l'effectif réellement sélectionné.</p>
      </div>
      <div className={styles.controls}>
        <label>Mois<select value={month} onChange={(event) => setSelectedMonth(event.target.value)}>{MONTHS.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label>
        <label>Volume MINI<input type="number" min={0} value={mini} onChange={(event) => setMini(Math.max(0, Number(event.target.value) || 0))}/></label>
        <button onClick={() => setMini(DEFLEET[month] ?? 0)}>Reprendre DEFLEET</button>
      </div>
    </section>

    <section className={styles.kpis}>
      <article><span>MINI ADDITIONNELLES</span><strong>{fmt(mini, 0)}</strong><small>{monthLabel(month)} · {days} jours ouvrés</small></article>
      <article><span>MÉTIER LE PLUS CHARGÉ</span><strong>{mostLoaded?.sectorLabel ?? "—"}</strong><small>{mostLoaded ? `+${fmt(mostLoaded.miniHours, 0)} h de charge MINI` : "sur la base des heures réelles"}</small></article>
      <article><span>EFFORT PROD. MAX</span><strong>{productivityPressure?.points == null ? "—" : `+${fmt(productivityPressure.points)} pts`}</strong><small>{productivityPressure?.sectorLabel ?? "référence historique"}</small></article>
      <article><span>RENFORT ETP MAX</span><strong>{etpPressure?.extraEtp == null ? "—" : `+${fmt(etpPressure.extraEtp)}`}</strong><small>{etpPressure?.sectorLabel ?? "au rendement moyen"}</small></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <span>02 · RÉFÉRENCE PRODUCTIVITÉ CERTIFIÉE</span>
          <h2>Mars → juin 2026 · hors Fixline</h2>
          <p>Les ratios ci-dessous proviennent directement des colonnes « Heures achetées » et « Heures vendues » des DASHBOARD des quatre classeurs. La moyenne est pondérée par les heures, pas par une moyenne simple des pourcentages.</p>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.capacityTable}>
          <thead><tr><th>Métier</th><th>Heures achetées</th><th>Heures vendues</th><th>Productivité référence</th><th>Période</th><th>Règle MINI</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`history-${row.sectorKey}`}>
            <td style={{ borderLeft: `5px solid ${activityColor(row.sectorLabel)}` }}><strong>{row.sectorLabel}</strong><small>{row.historicalSource ? "DASHBOARD rendement Lens" : "repli période courante"}</small></td>
            <td><b>{row.historicalSource ? `${fmt(row.historicalBoughtHours, 0)} h` : "—"}</b></td>
            <td><b>{row.historicalSource ? `${fmt(row.historicalSoldHours, 0)} h` : "—"}</b></td>
            <td><b>{row.productivity == null ? "—" : `${fmt(row.productivity)} %`}</b><small>{normalizedSector(row.sectorKey) === "carrosserie" ? "Box + Tôlerie · Fixline exclue" : "pondéré heures vendues / achetées"}</small></td>
            <td><b>{row.historicalMonthCount ? `${fmt(row.historicalMonthCount, 0)} mois` : "—"}</b><small>{dateLabel(historicalPeriod?.start)} → {dateLabel(historicalPeriod?.end)}</small></td>
            <td><b>{fmt(row.miniFlowRate * 100, 0)} % du DEFLEET</b><small>{row.miniHoursPerVehicle == null ? "ratio heures indisponible" : `${fmt(row.miniHoursPerVehicle, 2)} h / MINI`}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <span>03 · PAR MÉTIER</span>
          <h2>Est-ce que le volume passe ?</h2>
          <p>La productivité de référence est la moyenne pondérée mars–juin hors Fixline. La capacité mensuelle est recalculée avec les heures achetées de l'effectif sélectionné, puis la charge MINI est ajoutée.</p>
        </div>
        <div className={styles.legend}><span className={styles.pass}>PASSE · ≤ +5 pts</span><span className={styles.tension}>TENSION · +5 à +10 pts</span><span className={styles.critical}>CRITIQUE · &gt; +10 pts</span></div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.capacityTable}>
          <thead><tr><th>Métier</th><th>ETP RH actifs</th><th>Heures capacité / mois</th><th>MINI au poste</th><th>Heures MINI en +</th><th>Prod. moyenne</th><th>Prod. nécessaire</th><th>ETP en +</th><th>Verdict</th></tr></thead>
          <tbody>{rows.map((row) => {
            const isBody = normalizedSector(row.sectorKey) === "carrosserie";
            return <tr key={row.sectorKey}>
              <td style={{ borderLeft: `5px solid ${activityColor(row.sectorLabel)}` }}><strong>{row.sectorLabel}</strong><small>{isBody ? "Carrosserie hors Fixline + contrôle débit" : row.miniHourSource === "standard_mini_lens" ? "Standard MINI Lens" : "Moyenne facturée Lens"}</small></td>
              <td><button className={styles.rosterTrigger} onClick={() => showRoster(row.sectorKey)}>{fmt(row.selectedEtp, 0)} <span>ETP</span></button><small>{fmt(row.selectedEtp, 0)} / {fmt(row.rosterTotal, 0)} personnes comptées</small></td>
              <td><b>{fmt(row.baseSold, 0)} h vendables</b><small>{fmt(row.baseBought, 0)} h achetées · réf. {row.productivity == null ? "—" : `${fmt(row.productivity)} %`}</small></td>
              <td><b>{fmt(row.miniAtPost, 0)}</b><small>{fmt(row.miniFlowRate * 100, 0)} % du DEFLEET</small></td>
              <td><b>{row.miniHoursPerVehicle == null ? "—" : `+${fmt(row.miniHours, 0)} h`}</b><small>{row.miniHoursPerVehicle == null ? "ratio absent" : `${fmt(row.miniHoursPerVehicle, 2)} h / MINI`}</small></td>
              <td><b>{row.productivity == null ? "—" : `${fmt(row.productivity)} %`}</b><small>moyenne pondérée mars–juin{isBody ? " · Fixline exclue" : ""}</small></td>
              <td><b className={row.verdict === "critical" ? styles.negative : row.verdict === "tension" ? styles.warning : styles.positive}>{row.targetProd == null ? "—" : `${fmt(row.targetProd)} %`}</b><small>{row.points == null ? "donnée insuffisante" : `+${fmt(row.points)} points`}{isBody && row.bodyshopLoadPct != null ? ` · débit +${fmt(row.bodyshopLoadPct)} %` : ""}</small></td>
              <td><b>{row.extraEtp == null ? "—" : `+${fmt(row.extraEtp)}`}</b><small>si rendement moyen inchangé</small></td>
              <td><span className={`${styles.verdict} ${styles[row.verdict]}`}>{label(row.verdict)}</span></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>

    <section className={`${styles.panel} ${styles.scenarioPanel}`}>
      <div className={styles.panelHead}>
        <div><span>04 · SCÉNARIO MINI</span><h2>{monthLabel(month)} · scénario DEFLEET</h2><p>Le besoin est comparé à une base stabilisée sur quatre mois, ce qui évite qu'une seule période atypique surévalue ou sous-évalue la capacité du centre.</p></div>
        <div className={styles.scenarioBadge}><span>VOLUME MINI</span><strong>{fmt(mini, 0)}</strong><small>{days} jours ouvrés</small></div>
      </div>
      <div className={styles.scenarioGrid}>{rows.map((row) => {
        const color = activityColor(row.sectorLabel);
        const isBody = normalizedSector(row.sectorKey) === "carrosserie";
        return <article key={`scenario-${row.sectorKey}`} className={styles.scenarioCard} style={{ borderLeftColor: color, boxShadow: `inset 0 3px 0 ${color}22` }}>
          <div className={styles.scenarioCardHead}><div><strong style={{ color }}>{row.sectorLabel}</strong><small>{fmt(row.selectedEtp, 0)} ETP · +{fmt(row.miniAtPost, 0)} MINI ({fmt(row.miniFlowRate * 100, 0)} %)</small></div><span className={`${styles.verdict} ${styles[row.verdict]}`}>{label(row.verdict)}</span></div>
          <div className={styles.scenarioMetrics}>
            <div><span>PRODUCTIVITÉ MOYENNE</span><b>{row.productivity == null ? "—" : `${fmt(row.productivity)} %`}</b><small>{fmt(row.historicalSoldHours, 0)} h vendues / {fmt(row.historicalBoughtHours, 0)} h achetées</small></div>
            <div><span>PRODUCTIVITÉ NÉCESSAIRE</span><b>{row.targetProd == null ? "—" : `${fmt(row.targetProd)} %`}</b><small>{row.points == null ? "donnée insuffisante" : `+${fmt(row.points)} points`}</small></div>
            <div><span>ETP À AJOUTER</span><b>{row.extraEtp == null ? "—" : `+${fmt(row.extraEtp)}`}</b><small>au rendement moyen</small></div>
            <div><span>ETP CIBLE TOTAL</span><b>{row.extraEtp == null ? "—" : fmt(row.selectedEtp + row.extraEtp)}</b><small>{fmt(row.selectedEtp, 0)} actuels + renfort</small></div>
            <div><span>CHARGE MINI EN +</span><b style={{ color }}>{row.miniHoursPerVehicle == null ? "—" : `${fmt(row.miniHours, 0)} h`}</b><small>{row.miniHoursPerVehicle == null ? "ratio absent" : `${fmt(row.miniHoursPerVehicle, 2)} h / MINI`}</small></div>
          </div>
          <p className={styles.scenarioAdvice}>{row.points == null || row.extraEtp == null ? "Données comparables insuffisantes." : row.points <= 5 ? `Absorbable avec +${fmt(row.points)} points ou ${fmt(row.extraEtp)} ETP.` : row.points <= 10 ? `Tension : +${fmt(row.points)} points ou ${fmt(row.extraEtp)} ETP.` : `Critique : viser ${fmt(row.targetProd)} % ou +${fmt(row.extraEtp)} ETP.`}{isBody && row.bodyshopLoadPct != null ? ` Contrôle débit carrosserie : +${fmt(row.bodyshopLoadPct)} %.` : ""}</p>
        </article>;
      })}</div>
      <div className={styles.scenarioRule}><strong>Hypothèses de passage MINI</strong><span>Expertise 100 % · Mécanique 70 % · DSP 25 % · Carrosserie 100 % · Préparation 100 % · Qualité 100 %. Les taux de passage restent des hypothèses isolées ; les productivités viennent des heures réelles des classeurs rendement.</span></div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div><span>05 · CARROSSERIE</span><h2>Matrice de sensibilité Box × Fixline</h2><p>La productivité du simulateur est calculée hors Fixline. La matrice Box × Fixline reste volontairement un contrôle complémentaire de débit industriel et ne crée aucun pourcentage individuel Fixline.</p></div>
        {matrix && <div className={styles.scenarioBadge}><span>BESOIN CIBLE</span><strong>{fmt(matrix.requiredCapacity)} VO/j</strong><small>historique {fmt(matrix.currentCapacity)} VO/j</small></div>}
      </div>
      {matrix ? <div className={styles.tableWrap} style={{ marginTop: 18 }}><table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr><th style={{ padding: "10px 12px", background: "#5b9bd5", color: "#fff", textAlign: "left" }}>Box \\ Fixline</th>{matrix.colLabels.map((col) => <th key={col} style={{ padding: 10, background: "#5b9bd5", color: "#fff", textAlign: "center" }}>{col}%</th>)}</tr></thead>
        <tbody>{matrix.rowLabels.map((row, i) => <tr key={row}><th style={{ padding: "10px 12px", background: "#5b9bd5", color: "#fff", textAlign: "right" }}>{row}%</th>{matrix.colLabels.map((col, j) => {
          const value = matrix.values[i][j];
          const calibration = row === matrix.currentRow && col === matrix.currentCol;
          const target = row === matrix.targetRow && col === matrix.targetCol;
          const ok = value >= matrix.requiredCapacity;
          return <td key={col} style={{ padding: 10, textAlign: "center", fontWeight: 900, color: target ? "#fff" : calibration ? "#004f9f" : ok ? "#176e50" : "#004f9f", background: target ? "#009edb" : calibration ? "#ffe08a" : ok ? "#e8f7f0" : "#edf2f6", border: "1px solid #fff" }}>{fmt(value)}</td>;
        })}</tr>)}</tbody>
      </table></div> : <p className={styles.note}>Matrice indisponible.</p>}
      {matrix && <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10, marginTop: 14 }}>
        <div style={{ padding: 14, border: "1px solid #d9e6ee", borderRadius: 12, background: "#f8fbfd" }}><small>DÉBIT HISTORIQUE</small><strong style={{ display: "block", marginTop: 5, color: "#004f9f" }}>{fmt(matrix.currentCapacity)} VO/j</strong><span>{fmt(matrix.historicalMonthly, 0)} VO/mois · {fmt(matrix.fullMonthCount, 0)} mois</span></div>
        <div style={{ padding: 14, border: "1px solid #f0d276", borderRadius: 12, background: "#fff9e8" }}><small>BOX MESURÉ RÉCENT</small><strong style={{ display: "block", marginTop: 5, color: "#8a6900" }}>{matrix.boxCurrentProductivity == null ? "—" : `${fmt(matrix.boxCurrentProductivity)} %`}</strong><span>au {dateLabel(matrix.productivityPeriodEnd)}</span></div>
        <div style={{ padding: 14, border: "1px solid #d9e6ee", borderRadius: 12, background: "#f8fbfd" }}><small>PROD. HISTORIQUE HORS FIXLINE</small><strong style={{ display: "block", marginTop: 5, color: "#004f9f" }}>{body?.productivity == null ? "—" : `${fmt(body.productivity)} %`}</strong><span>Box + Tôlerie · 4 mois</span></div>
        <div style={{ padding: 14, border: "1px solid #d9e6ee", borderRadius: 12, background: "#f8fbfd" }}><small>FIXLINE</small><strong style={{ display: "block", marginTop: 5, color: "#004f9f" }}>COLLECTIF</strong><span>exclue de la moyenne productivité</span></div>
        <div style={{ padding: 14, border: "1px solid #9bd9ee", borderRadius: 12, background: "#eefaff" }}><small>CIBLE INDICATIVE MINI</small><strong style={{ display: "block", marginTop: 5, color: "#009edb" }}>{fmt(matrix.requiredCapacity)} VO/j</strong><span>Box {matrix.targetRow}% / Fixline {matrix.targetCol}%</span></div>
      </div>}
      {matrix && <p className={styles.note}>Encours structurel : {fmt(matrix.backlog, 0)} VOP. La cellule cyan reste une sensibilité de débit et non une mesure de productivité Fixline.</p>}
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>06 · STANDARD MINI LENS</span><h2>Charge par dossier</h2></div></div>
      <div className={styles.standardGrid}>
        <div><span>CARROSSERIE + PEINTURE</span><strong>{fmt(data?.miniStandard?.bodyshopHours ?? 7.92, 2)} h</strong></div>
        <div><span>MÉCANIQUE</span><strong>{fmt(data?.miniStandard?.mechanicsHours ?? 1.17, 2)} h</strong></div>
        <div><span>ÉCHANTILLON</span><strong>{fmt(data?.miniStandard?.sampleVehicles ?? 569, 0)}</strong></div>
      </div>
      <p className={styles.note}>Le temps MINI par dossier reste issu du standard / ratio Lens existant. La capacité disponible, elle, est désormais recalée sur la productivité historique pondérée mars–juin hors Fixline.</p>
    </section>

    <footer className={styles.footer}><strong>Référence historique intégrée</strong><span>{data?.historicalProductivity?.method ?? "Heures achetées / vendues des classeurs rendement Lens."}</span></footer>

    {openSector && <div className={styles.rosterOverlay} onMouseDown={(event) => { if (event.currentTarget === event.target) setOpenSector(null); }}>
      <section className={styles.rosterModal}>
        <div className={styles.rosterHead}>
          <div><span>EFFECTIF DU SIMULATEUR</span><h2>{openRow?.sectorLabel ?? openSector}</h2><p><b>{openRow?.selectedEtp ?? 0}</b> personne(s) sur <b>{openRow?.rosterTotal ?? 0}</b>. La sélection agit sur les heures achetées disponibles ; le rendement moyen historique du métier reste la référence.</p></div>
          <button className={styles.closeRoster} onClick={() => setOpenSector(null)}>×</button>
        </div>
        <input className={styles.rosterSearch} value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="Rechercher un nom, matricule, métier ou équipe…"/>
        <div className={styles.rosterList}>{openRoster.map((member) => <label key={member.employeeKey} className={`${styles.rosterPerson} ${member.included ? styles.rosterIncluded : styles.rosterExcluded}`}>
          <input type="checkbox" checked={member.included} disabled={savingKey === member.employeeKey} onChange={() => void toggleStaff(member)}/>
          <span className={styles.rosterName}><strong>{member.fullName}</strong><small>{member.workcenterLabel || member.sectorLabel || openRow?.sectorLabel}{member.teamCode ? ` · équipe ${member.teamCode}` : ""}{member.matricule ? ` · ${member.matricule}` : ""}</small><small>{member.comparable ? `${fmt(member.soldHours, 1)} h vendues / ${fmt(member.boughtHours, 1)} h achetées · période récente ${member.productivity == null ? "—" : `${fmt(member.productivity)} %`}` : (member.workcenterKey === "fixline" || normalizedSector(member.workcenterLabel ?? "").includes("fixline")) ? "Fixline : mesure collective · exclue de la moyenne MINI" : num(member.soldHours) > 0 ? `${fmt(member.soldHours, 1)} h vendues · non comparables` : "Aucune heure comparable"}</small></span>
          <span className={styles.rosterState}>{savingKey === member.employeeKey ? "Enregistrement…" : member.included ? "COMPTÉ" : "EXCLU"}</span>
        </label>)}{openRoster.length === 0 && <div className={styles.rosterEmpty}>Aucun collaborateur.</div>}</div>
        <div className={styles.rosterFoot}><span>Chaque coche recalcule la capacité achetée. La productivité de référence reste la moyenne historique du métier, hors Fixline.</span><button onClick={() => setOpenSector(null)}>Terminer</button></div>
      </section>
    </div>}
  </main>;
}
