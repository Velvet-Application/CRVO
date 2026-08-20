export type ProrationMode = "inherit" | "ignore" | "prorate" | "suppress";

export type ProrationRule = {
  reasonCode: string;
  label: string;
  sourceTimeCodes?: string[];
  individualMode: ProrationMode;
  individualThresholdDays: number;
  collectiveMode: ProrationMode;
  collectiveThresholdDays: number;
  active: boolean;
  sourceRevision?: number;
  updatedByName?: string | null;
  updatedAt?: string | null;
};

export type ProrationSourceEvent = {
  id: string;
  employeeKey: string;
  employeeName?: string;
  kind?: string;
  reason: string;
  startDate: string;
  endDate: string;
  durationHours?: number | null;
  justification?: string | null;
  comment?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  source?: string | null;
};

export type ProrationRulesPayload = {
  workflowId: string;
  month: string;
  status: string;
  legacy?: boolean;
  canConfigure: boolean;
  rules: ProrationRule[];
  events: ProrationSourceEvent[];
  audit?: Array<Record<string, unknown>>;
  sources?: Record<string, string>;
};

export type BonusComponentForProration = {
  id?: string;
  employeeKey: string | null;
  employeeName: string;
  presenceHours: number | null;
  absenceHours: number | null;
  individualAmountEur: number | null;
  collectiveAmountEur: number | null;
  collectiveProration: number | null;
  totalAmountEur: number | null;
};

export type BonusDetailForProration = {
  workflow: { id: string; month: string; status: string };
  components: BonusComponentForProration[];
  manualInputs?: Array<{ scopeType: string; scopeKey: string; inputKey: string; numericValue: number | null }>;
};

export type ProrationEventImpact = {
  reasonCode: string;
  label: string;
  sourceTimeCodes: string[];
  from: string;
  to: string;
  dates: string[];
  hours: number;
  days: number;
  source: string;
  sourceLabel: string;
  individualMode: ProrationMode;
  individualEffectiveMode: Exclude<ProrationMode, "inherit">;
  individualThresholdDays: number;
  individualTriggered: boolean;
  individualImpactDays: number;
  individualImpactPct: number;
  collectiveMode: ProrationMode;
  collectiveEffectiveMode: Exclude<ProrationMode, "inherit">;
  collectiveThresholdDays: number;
  collectiveTriggered: boolean;
  collectiveImpactDays: number;
  collectiveImpactPct: number;
};

export type EmployeeProration = {
  employeeKey: string;
  employeeName: string;
  workingDays: number;
  workingDaysSource: string;
  referenceHoursPerDay: number;
  referenceHoursSource: string;
  events: ProrationEventImpact[];
  individualFactor: number;
  collectiveFactor: number;
  individualBeforeEur: number | null;
  individualAfterEur: number | null;
  individualImpactEur: number;
  collectiveBeforeEur: number | null;
  collectiveAfterEur: number | null;
  collectiveImpactEur: number;
  totalBeforeEur: number | null;
  totalAfterEur: number | null;
  totalImpactEur: number;
  granularIndividual: boolean;
  granularCollective: boolean;
  sourceSummary: string;
};

export type ProrationContext = ProrationRulesPayload & {
  calculatedAt: string;
  workingDays: number;
  workingDaysSource: string;
  components: EmployeeProration[];
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const safe = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const from = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const to = `${year}-${String(monthNumber).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

function weekdaysBetween(from: string, to: string, month: string) {
  const bounds = monthBounds(month);
  const start = new Date(`${from > bounds.from ? from : bounds.from}T12:00:00Z`);
  const end = new Date(`${to < bounds.to ? to : bounds.to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let days = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

function defaultWorkingDays(month: string) {
  const { from, to } = monthBounds(month);
  return weekdaysBetween(from, to, month);
}

function resolveWorkingDays(detail: BonusDetailForProration) {
  const explicit = detail.manualInputs?.find(item => item.scopeType === "global" && item.scopeKey === "*" && item.inputKey === "working_days")?.numericValue;
  if (explicit != null && Number(explicit) > 0) return { value: Number(explicit), source: "Donnée fin de mois · jours ouvrés saisis dans le workflow" };
  return { value: defaultWorkingDays(detail.workflow.month), source: "Calendrier ouvré du mois · secours car la saisie workflow est absente" };
}

function datesForEvent(event: ProrationSourceEvent, month: string) {
  const bounds = monthBounds(month);
  const from = event.startDate > bounds.from ? event.startDate : bounds.from;
  const to = event.endDate < bounds.to ? event.endDate : bounds.to;
  const dates: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return dates;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

function sourceLabel(source: string) {
  if (source === "data_rh") return "Data RH · événement normalisé";
  if (source === "manual") return "Temps de travail · saisie manuelle tracée";
  return source ? `Source ${source}` : "Source RH";
}

export function buildProrationContext(detail: BonusDetailForProration, payload: ProrationRulesPayload): ProrationContext {
  const working = resolveWorkingDays(detail);
  const rules = new Map(payload.rules.filter(rule => rule.active).map(rule => [rule.reasonCode, rule]));
  const components: EmployeeProration[] = [];

  for (const component of detail.components) {
    if (!component.employeeKey) continue;
    const personEvents = payload.events.filter(event => event.employeeKey === component.employeeKey);
    const referenceHours = working.value > 0
      ? (safe(component.presenceHours) + safe(component.absenceHours)) / working.value
      : 0;
    const referenceHoursPerDay = referenceHours > 0.25 ? referenceHours : 7;
    const referenceHoursSource = referenceHours > 0.25
      ? "Data RH · (heures achetées + absences) / jours ouvrés du workflow"
      : "Référence de secours 7 h/j · base mensuelle insuffisante";

    const grouped = new Map<string, { rule: ProrationRule; events: ProrationSourceEvent[]; hours: number; days: number; dates: Set<string>; sources: Set<string>; kinds: Set<string> }>();
    for (const event of personEvents) {
      const rule = rules.get(event.reason) ?? ({
        reasonCode: event.reason,
        label: event.reason,
        sourceTimeCodes: [],
        individualMode: "inherit",
        individualThresholdDays: 0,
        collectiveMode: "inherit",
        collectiveThresholdDays: 0,
        active: true,
      } satisfies ProrationRule);
      const current = grouped.get(event.reason) ?? { rule, events: [], hours: 0, days: 0, dates: new Set<string>(), sources: new Set<string>(), kinds: new Set<string>() };
      current.events.push(event);
      const hours = Math.max(0, safe(event.durationHours));
      const dates = datesForEvent(event, detail.workflow.month);
      dates.forEach(date => current.dates.add(date));
      current.hours += hours;
      current.days += hours > 0 ? hours / referenceHoursPerDay : event.kind === "absence" ? dates.length : 0;
      current.sources.add(event.source ?? "data_rh");
      current.kinds.add(event.kind ?? "absence");
      grouped.set(event.reason, current);
    }

    const granularIndividual = [...grouped.values()].some(group => group.rule.individualMode !== "inherit");
    const granularCollective = [...grouped.values()].some(group => group.rule.collectiveMode !== "inherit");
    let individualProratedDays = 0;
    let collectiveProratedDays = 0;
    let individualSuppressed = false;
    let collectiveSuppressed = false;
    const eventImpacts: ProrationEventImpact[] = [];

    for (const group of grouped.values()) {
      const days = Math.max(0, group.days);
      const individualTriggered = days > safe(group.rule.individualThresholdDays);
      const collectiveTriggered = days > safe(group.rule.collectiveThresholdDays);
      const individualEffectiveMode: Exclude<ProrationMode, "inherit"> = group.rule.individualMode === "inherit" ? "ignore" : group.rule.individualMode;
      const collectiveEffectiveMode: Exclude<ProrationMode, "inherit"> = group.rule.collectiveMode === "inherit"
        ? (granularCollective && group.kinds.has("absence") ? "prorate" : "ignore")
        : group.rule.collectiveMode;
      const individualImpactDays = individualTriggered && individualEffectiveMode === "prorate" ? days : 0;
      const collectiveImpactDays = collectiveTriggered && collectiveEffectiveMode === "prorate" ? days : 0;
      individualProratedDays += individualImpactDays;
      collectiveProratedDays += collectiveImpactDays;
      if (individualTriggered && individualEffectiveMode === "suppress") individualSuppressed = true;
      if (collectiveTriggered && collectiveEffectiveMode === "suppress") collectiveSuppressed = true;
      const sortedDates = [...group.dates].sort();
      const sources = [...group.sources];
      eventImpacts.push({
        reasonCode: group.rule.reasonCode,
        label: group.rule.label,
        sourceTimeCodes: group.rule.sourceTimeCodes ?? [],
        from: sortedDates[0] ?? group.events[0]?.startDate ?? "",
        to: sortedDates[sortedDates.length - 1] ?? group.events[group.events.length - 1]?.endDate ?? "",
        dates: sortedDates,
        hours: group.hours,
        days,
        source: sources.join(","),
        sourceLabel: sources.map(sourceLabel).join(" + "),
        individualMode: group.rule.individualMode,
        individualEffectiveMode,
        individualThresholdDays: safe(group.rule.individualThresholdDays),
        individualTriggered,
        individualImpactDays,
        individualImpactPct: individualTriggered && individualEffectiveMode === "suppress" ? 1 : working.value > 0 ? individualImpactDays / working.value : 0,
        collectiveMode: group.rule.collectiveMode,
        collectiveEffectiveMode,
        collectiveThresholdDays: safe(group.rule.collectiveThresholdDays),
        collectiveTriggered,
        collectiveImpactDays,
        collectiveImpactPct: collectiveTriggered && collectiveEffectiveMode === "suppress" ? 1 : working.value > 0 ? collectiveImpactDays / working.value : 0,
      });
    }

    const legacyCollectiveFactor = clamp01(component.collectiveProration == null ? 1 : safe(component.collectiveProration, 1));
    const individualFactor = individualSuppressed ? 0 : granularIndividual && working.value > 0 ? clamp01(1 - individualProratedDays / working.value) : 1;
    const collectiveFactor = collectiveSuppressed ? 0 : granularCollective && working.value > 0 ? clamp01(1 - collectiveProratedDays / working.value) : legacyCollectiveFactor;
    const individualBeforeEur = component.individualAmountEur == null ? null : safe(component.individualAmountEur);
    const collectiveBaseEur = component.collectiveAmountEur == null ? null : safe(component.collectiveAmountEur);
    const collectiveBeforeEur = collectiveBaseEur == null ? null : collectiveBaseEur * legacyCollectiveFactor;
    const individualAfterEur = individualBeforeEur == null ? null : individualBeforeEur * individualFactor;
    const collectiveAfterEur = collectiveBaseEur == null ? null : collectiveBaseEur * collectiveFactor;
    const totalBeforeEur = component.totalAmountEur == null ? null : safe(component.totalAmountEur);
    const totalAfterEur = totalBeforeEur == null
      ? (individualAfterEur ?? 0) + (collectiveAfterEur ?? 0)
      : totalBeforeEur - (individualBeforeEur ?? 0) - (collectiveBeforeEur ?? 0) + (individualAfterEur ?? 0) + (collectiveAfterEur ?? 0);

    components.push({
      employeeKey: component.employeeKey,
      employeeName: component.employeeName,
      workingDays: working.value,
      workingDaysSource: working.source,
      referenceHoursPerDay,
      referenceHoursSource,
      events: eventImpacts.sort((a, b) => a.from.localeCompare(b.from) || a.label.localeCompare(b.label, "fr")),
      individualFactor,
      collectiveFactor,
      individualBeforeEur,
      individualAfterEur,
      individualImpactEur: (individualAfterEur ?? 0) - (individualBeforeEur ?? 0),
      collectiveBeforeEur,
      collectiveAfterEur,
      collectiveImpactEur: (collectiveAfterEur ?? 0) - (collectiveBeforeEur ?? 0),
      totalBeforeEur,
      totalAfterEur,
      totalImpactEur: totalAfterEur - (totalBeforeEur ?? totalAfterEur),
      granularIndividual,
      granularCollective,
      sourceSummary: "Payplan mensuel figé + performance KPI CRVO + événements Data RH + règles de proratisation du workflow",
    });
  }

  return {
    ...payload,
    calculatedAt: new Date().toISOString(),
    workingDays: working.value,
    workingDaysSource: working.source,
    components,
  };
}
