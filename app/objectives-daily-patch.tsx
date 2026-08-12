"use client";

import { useEffect } from "react";

type Objective = {
  sectorKey: string;
  sectorLabel: string;
  dailyTarget: number;
  minThreshold: number | null;
  maxThreshold: number | null;
};

type ObjectivePayload = {
  objectives?: Objective[];
  sortieDailyTargets?: Record<string, number>;
  storage?: string;
};

const sectorKeys = [
  "expertise", "chiffrage", "controle_technique", "dsp", "jantes", "mecanique",
  "carrosserie", "parc_travaux", "preparation", "qualite", "sortie_usine",
];

const monthNames: Record<string, string> = {
  janvier: "01", fevrier: "02", février: "02", mars: "03", avril: "04", mai: "05", juin: "06",
  juillet: "07", aout: "08", août: "08", septembre: "09", octobre: "10", novembre: "11", decembre: "12", décembre: "12",
};

const cache = new Map<string, ObjectivePayload>();
let renderingMonth = "";

function parseFrenchDate(value: string) {
  const match = value.toLowerCase().trim().match(/(\d{1,2})\s+([a-zéûôîàèùç]+)\s+(20\d{2})/i);
  if (!match) return null;
  const month = monthNames[match[2]];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon, 0).getDate();
}

function datesOfMonth(month: string) {
  return Array.from({ length: daysInMonth(month) }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function formatDay(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return {
    day: new Intl.DateTimeFormat("fr-FR", { day: "2-digit" }).format(parsed),
    weekday: new Intl.DateTimeFormat("fr-FR", { weekday: "short" }).format(parsed).replace(".", ""),
    weekend: [0, 6].includes(parsed.getDay()),
  };
}

async function loadMonth(month: string) {
  if (cache.has(month)) return cache.get(month)!;
  try {
    const response = await fetch(`/api/objectives?month=${month}`, { cache: "no-store" });
    const payload = response.ok ? await response.json() as ObjectivePayload : {};
    cache.set(month, payload);
    return payload;
  } catch {
    const empty: ObjectivePayload = {};
    cache.set(month, empty);
    return empty;
  }
}

function currentMonth() {
  const picker = document.querySelector<HTMLInputElement>(".month-picker input[type='month']");
  return picker?.value || document.querySelector<HTMLInputElement>("input[type='month']")?.value || "2026-08";
}

function sortieMonthlyTarget() {
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>(".objective-table tbody tr"));
  const row = rows.find((item) => item.querySelector("strong")?.textContent?.trim() === "Sortie usine");
  const input = row?.querySelector<HTMLInputElement>("input[type='number']");
  return Math.max(0, Number(input?.value) || 92);
}

function updateTotal(panel: HTMLElement) {
  const total = Array.from(panel.querySelectorAll<HTMLInputElement>("input[data-date]"))
    .reduce((sum, input) => sum + (Number(input.value) || 0), 0);
  const totalNode = panel.querySelector<HTMLElement>("[data-total]");
  if (totalNode) totalNode.textContent = total.toLocaleString("fr-FR");
}

async function ensureDailyPanel() {
  const table = document.querySelector<HTMLTableElement>(".objective-table");
  const host = document.querySelector<HTMLElement>(".objectives-panel");
  if (!table || !host) return;
  const month = currentMonth();
  const existing = document.getElementById("sortie-daily-targets");
  if (existing && existing.dataset.month === month) return;
  existing?.remove();
  if (renderingMonth === month) return;
  renderingMonth = month;

  const payload = await loadMonth(month);
  if (!document.querySelector(".objective-table")) { renderingMonth = ""; return; }
  const saved = payload.sortieDailyTargets ?? {};
  const fallback = sortieMonthlyTarget();
  const panel = document.createElement("section");
  panel.id = "sortie-daily-targets";
  panel.dataset.month = month;
  panel.className = "daily-output-targets";
  panel.innerHTML = `
    <div class="daily-output-heading">
      <div><span>OBJECTIF SORTIE USINE · JOUR PAR JOUR</span><h3>Attendu quotidien du mois</h3><p>Chaque date peut avoir son propre objectif. L'objectif mensuel se recalcule automatiquement.</p></div>
      <div class="daily-output-total"><span>OBJECTIF MOIS</span><strong data-total>0</strong><small>sorties usine</small></div>
    </div>
    <div class="daily-output-tools">
      <button type="button" data-fill-month>Appliquer l'objectif journalier à tous</button>
      <button type="button" data-zero-weekends>Mettre les week-ends à 0</button>
    </div>
    <div class="daily-output-grid"></div>
  `;
  const grid = panel.querySelector<HTMLElement>(".daily-output-grid")!;
  for (const date of datesOfMonth(month)) {
    const info = formatDay(date);
    const value = Object.prototype.hasOwnProperty.call(saved, date) ? Number(saved[date]) : fallback;
    const cell = document.createElement("label");
    cell.className = `daily-output-day${info.weekend ? " weekend" : ""}`;
    cell.innerHTML = `<span>${info.weekday}</span><strong>${info.day}</strong><input type="number" min="0" step="1" data-date="${date}" value="${Math.max(0, value)}" aria-label="Objectif sorties usine ${date}">`;
    grid.appendChild(cell);
  }
  host.appendChild(panel);
  updateTotal(panel);

  panel.addEventListener("input", () => { updateTotal(panel); void patchAll(); });
  panel.querySelector("[data-fill-month]")?.addEventListener("click", () => {
    const value = sortieMonthlyTarget();
    panel.querySelectorAll<HTMLInputElement>("input[data-date]").forEach((input) => { input.value = String(value); });
    updateTotal(panel); void patchAll();
  });
  panel.querySelector("[data-zero-weekends]")?.addEventListener("click", () => {
    panel.querySelectorAll<HTMLInputElement>(".weekend input[data-date]").forEach((input) => { input.value = "0"; });
    updateTotal(panel); void patchAll();
  });
  renderingMonth = "";
}

function gatherObjectives() {
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>(".objective-table tbody tr"));
  return rows.map((row, index) => {
    const inputs = Array.from(row.querySelectorAll<HTMLInputElement>("input[type='number']"));
    const numeric = (input: HTMLInputElement | undefined) => input && input.value !== "" ? Math.max(0, Number(input.value) || 0) : null;
    return {
      sectorKey: sectorKeys[index] ?? `sector_${index}`,
      sectorLabel: row.querySelector("strong")?.textContent?.trim() || `Secteur ${index + 1}`,
      dailyTarget: numeric(inputs[0]) ?? 0,
      minThreshold: numeric(inputs[1]),
      maxThreshold: numeric(inputs[2]),
    } satisfies Objective;
  });
}

function gatherDailyTargets() {
  const panel = document.getElementById("sortie-daily-targets");
  if (!panel) return {};
  return Object.fromEntries(Array.from(panel.querySelectorAll<HTMLInputElement>("input[data-date]"))
    .map((input) => [input.dataset.date!, Math.max(0, Number(input.value) || 0)]));
}

async function saveObjectives() {
  const month = currentMonth();
  const objectives = gatherObjectives();
  const sortieDailyTargets = gatherDailyTargets();
  let feedback = document.querySelector<HTMLElement>(".objectives-panel .settings-feedback");
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.className = "settings-feedback";
    document.querySelector(".objectives-panel")?.appendChild(feedback);
  }
  feedback.textContent = "Enregistrement des objectifs…";
  try {
    const response = await fetch("/api/objectives", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, objectives, sortieDailyTargets }),
    });
    const payload = await response.json() as { saved?: number; error?: string; storage?: string; warning?: string };
    if (!response.ok) throw new Error(payload.error || "Enregistrement impossible.");
    cache.set(month, { objectives, sortieDailyTargets, storage: payload.storage });
    feedback.textContent = `${payload.saved ?? objectives.length} objectifs enregistrés · planning Sortie usine sauvegardé pour ${Object.keys(sortieDailyTargets).length} jours.`;
    window.dispatchEvent(new CustomEvent("crvo-objectives-saved"));
    await patchAll();
  } catch (error) {
    feedback.textContent = error instanceof Error ? error.message : "Erreur d’enregistrement.";
  }
}

function targetForDate(payload: ObjectivePayload, date: string, fallback = 92) {
  const value = payload.sortieDailyTargets?.[date];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sumTargets(payload: ObjectivePayload, start: string, end: string, fallback = 92) {
  if (!start || !end) return 0;
  let cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  let total = 0;
  while (cursor <= last) {
    const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    total += targetForDate(payload, date, fallback);
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function patchColumn(column: HTMLElement, target: number, gapLabel = "Écart") {
  const actual = Number(column.querySelector<HTMLElement>(".performance-main strong")?.textContent?.replace(/\s/g, ""));
  const small = column.querySelector<HTMLElement>(".performance-main small");
  if (small) small.textContent = `objectif ${target.toLocaleString("fr-FR")}`;
  const gap = column.querySelector<HTMLElement>(".performance-gap strong");
  if (gap && Number.isFinite(actual)) {
    const delta = actual - target;
    gap.textContent = `${delta > 0 ? "+" : ""}${delta.toLocaleString("fr-FR")}`;
    gap.parentElement?.classList.toggle("positive", delta >= 0);
    gap.parentElement?.classList.toggle("negative", delta < 0);
    const label = gap.parentElement?.querySelector("span");
    if (label) label.textContent = gapLabel;
  }
}

async function patchAll() {
  const latestLabel = document.querySelector<HTMLElement>(".topbar-date strong")?.textContent || "";
  const latestDate = parseFrenchDate(latestLabel);
  if (!latestDate) return;
  const month = latestDate.slice(0, 7);
  const payload = await loadMonth(month);
  const fallback = payload.objectives?.find((item) => item.sectorKey === "sortie_usine")?.dailyTarget ?? 92;
  const dayTarget = targetForDate(payload, latestDate, fallback);

  const heroExit = document.querySelector<HTMLElement>(".day-hero-stats > div:nth-child(2) small");
  if (heroExit) heroExit.textContent = `objectif ${dayTarget.toLocaleString("fr-FR")}`;

  const dayBoard = document.querySelector<HTMLElement>(".performance-board:not(.cumulative-board)");
  const dayColumn = dayBoard ? Array.from(dayBoard.querySelectorAll<HTMLElement>(".performance-column")).find((column) => column.querySelector("h3")?.textContent?.trim() === "Sortie usine") : undefined;
  if (dayColumn) patchColumn(dayColumn, dayTarget);

  const cumulative = document.querySelector<HTMLElement>(".cumulative-board");
  if (cumulative && Object.keys(payload.sortieDailyTargets ?? {}).length) {
    const dates = Array.from(cumulative.querySelectorAll<HTMLInputElement>("input[type='date']"));
    if (dates[0]?.value && dates[1]?.value) {
      const total = sumTargets(payload, dates[0].value, dates[1].value, fallback);
      const column = Array.from(cumulative.querySelectorAll<HTMLElement>(".performance-column")).find((item) => item.querySelector("h3")?.textContent?.trim() === "Sortie usine");
      if (column) patchColumn(column, total, "Écart période");
    }
  }

  const summaryFilter = document.querySelector<HTMLElement>(".section-title .period-filter");
  if (summaryFilter && Object.keys(payload.sortieDailyTargets ?? {}).length) {
    const dates = Array.from(summaryFilter.querySelectorAll<HTMLInputElement>("input[type='date']"));
    if (dates[0]?.value && dates[1]?.value) {
      const total = sumTargets(payload, dates[0].value, dates[1].value, fallback);
      const exitsCard = document.querySelector<HTMLElement>(".headline-kpis .headline-kpi:nth-child(2) small");
      if (exitsCard) exitsCard.textContent = `objectif période ${total.toLocaleString("fr-FR")}`;
      const flowText = document.querySelector<HTMLElement>(".flow-summary p");
      if (flowText) flowText.innerHTML = `Objectif de sorties sur la période : <strong>${total.toLocaleString("fr-FR")}</strong>.`;
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".production-list > div"));
      const sortie = rows.find((row) => row.querySelector("span")?.textContent?.trim() === "Sortie usine");
      const targetSmall = sortie?.querySelector<HTMLElement>("strong small");
      if (targetSmall) targetSmall.textContent = `/ ${total.toLocaleString("fr-FR")}`;
    }
  }
}

export default function ObjectivesDailyPatch() {
  useEffect(() => {
    let scheduled = false;
    const run = () => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        void ensureDailyPanel();
        void patchAll();
      }, 60);
    };

    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });

    const captureSave = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>(".primary-action");
      if (!button || !/enregistrer les objectifs/i.test(button.textContent || "")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveObjectives();
    };
    document.addEventListener("click", captureSave, true);
    document.addEventListener("change", run, true);
    window.addEventListener("crvo-objectives-saved", run);
    run();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", captureSave, true);
      document.removeEventListener("change", run, true);
      window.removeEventListener("crvo-objectives-saved", run);
    };
  }, []);

  return <style>{`
    .daily-output-targets{margin:18px 18px 20px;padding:20px;border:1px solid #cfe2ee;border-radius:16px;background:linear-gradient(145deg,#f8fbfd,#fff);box-shadow:0 10px 28px rgba(0,79,159,.06)}
    .daily-output-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:14px}.daily-output-heading span{display:block;color:#009edb;font-size:9px;font-weight:800;font-style:italic;letter-spacing:.1em}.daily-output-heading h3{margin:4px 0;color:#004f9f;font-size:20px;font-style:italic}.daily-output-heading p{margin:5px 0 0;color:#718797;font-size:10px}.daily-output-total{min-width:150px;padding:13px 16px;border-left:4px solid #009edb;background:#eef7fb}.daily-output-total span,.daily-output-total small{display:block;color:#718797;font-size:8px;font-weight:800}.daily-output-total strong{display:block;margin:3px 0;color:#004f9f;font-size:29px;font-style:italic}
    .daily-output-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.daily-output-tools button{padding:8px 11px;border:1px solid #c7dce9;border-radius:9px;background:#fff;color:#004f9f;font-size:9px;font-weight:800}.daily-output-tools button:hover{border-color:#009edb;background:#f2f9fc}
    .daily-output-grid{display:grid;grid-template-columns:repeat(7,minmax(80px,1fr));gap:8px}.daily-output-day{min-height:92px;padding:9px;display:grid;grid-template-columns:1fr auto;align-items:center;gap:4px;border:1px solid #d8e6ee;border-radius:11px;background:#fff}.daily-output-day.weekend{background:#f5f7f8}.daily-output-day>span{color:#7e919d;font-size:8px;font-weight:800;text-transform:uppercase}.daily-output-day>strong{color:#004f9f;font-size:13px}.daily-output-day input{grid-column:1/-1;width:100%;padding:8px;border:1px solid #c7dce9;border-radius:8px;background:white;color:#17364d;font-weight:800;outline:none}.daily-output-day input:focus{border-color:#009edb;box-shadow:0 0 0 3px rgba(0,158,219,.1)}
    @media(max-width:900px){.daily-output-grid{grid-template-columns:repeat(4,1fr)}}@media(max-width:560px){.daily-output-heading{align-items:flex-start;flex-direction:column}.daily-output-total{width:100%}.daily-output-grid{grid-template-columns:repeat(2,1fr)}.daily-output-targets{margin:14px 8px;padding:14px}}
  `}</style>;
}
