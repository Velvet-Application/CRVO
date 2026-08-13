"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type AuthPayload = { authenticated?: boolean; error?: string };
type AnyRow = Array<unknown>;

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function excelDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function headerIndex(headers: AnyRow, wanted: string) {
  const target = normalize(wanted);
  return headers.findIndex((value) => normalize(value) === target);
}

function mapSector(sectionValue: unknown, interventionValue: unknown) {
  const section = normalize(sectionValue);
  const intervention = normalize(interventionValue);
  if (intervention.includes("controle technique")) return { key: "controle_technique", label: "Contrôle technique" };
  if (section === "expertise") return { key: "expertise", label: "Expertise" };
  if (section === "mecanique") return { key: "mecanique", label: "Mécanique" };
  if (section === "debosselage") return { key: "dsp", label: "DSP" };
  if (section === "jantes") return { key: "jantes", label: "Jantes" };
  if (section === "qualite") return { key: "qualite", label: "Qualité" };
  if (section === "peinture" || section === "carrosserie") return { key: "carrosserie", label: "Carrosserie" };
  if (["centre de preparation", "station de lavage", "labo photo"].includes(section)) return { key: "preparation", label: "Préparation" };
  if (section === "transport") return { key: "transport", label: "Transport" };
  return { key: section.replace(/ /g, "_") || "autre", label: String(sectionValue || "Autre") };
}

async function rowsFromFile(file: File) {
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as AnyRow[];
}

async function parseInvoices(file: File) {
  const rows = await rowsFromFile(file);
  const headers = rows[0] ?? [];
  const idx = {
    or: headerIndex(headers, "No OR"), invoice: headerIndex(headers, "No Facture"), date: headerIndex(headers, "Date Facture"),
    hours: headerIndex(headers, "Heures MO"), labor: headerIndex(headers, "Mt Net L. MO"), total: headerIndex(headers, "Total Net"), vin: headerIndex(headers, "VIN"),
  };
  if (Object.values(idx).some((value) => value < 0)) throw new Error("Le format du reporting factures ne correspond pas au modèle attendu.");
  const groups = new Map<string, { invoice_date: string; invoice_number: string; work_order: string; vin: string | null; revenue_total: number; labor_revenue: number; labor_hours: number; line_count: number }>();
  rows.slice(1).forEach((row) => {
    const invoice = String(row[idx.invoice] ?? "").trim();
    const workOrder = String(row[idx.or] ?? "").trim();
    const date = excelDate(row[idx.date]);
    if (!invoice || !date) return;
    const current = groups.get(invoice) ?? { invoice_date: date, invoice_number: invoice, work_order: workOrder, vin: String(row[idx.vin] ?? "").trim() || null, revenue_total: numeric(row[idx.total]), labor_revenue: 0, labor_hours: 0, line_count: 0 };
    current.labor_revenue += numeric(row[idx.labor]);
    current.labor_hours += numeric(row[idx.hours]);
    current.line_count += 1;
    groups.set(invoice, current);
  });
  return [...groups.values()].map((row) => ({ ...row, other_revenue: row.revenue_total - row.labor_revenue, parts_revenue: null, registration: null, client: null, metadata: { line_count: row.line_count, credit_or_adjustment: row.revenue_total < 0 } }));
}

async function parseWorkload(file: File) {
  const rows = await rowsFromFile(file);
  const headers = rows[0] ?? [];
  const idx = {
    or: headerIndex(headers, "No OR"), immat: headerIndex(headers, "IMMAT"), opened: headerIndex(headers, "Date Ouverture OR"), client: headerIndex(headers, "Client Facturé (code)"),
    hours: headerIndex(headers, "Heures MO"), labor: headerIndex(headers, "Mt Net L. MO"), divers: headerIndex(headers, "Mt Net L. Divers"), parts: headerIndex(headers, "Mt Net L. Pièce"), paint: headerIndex(headers, "Mt Net L. Peinture"), forfait: headerIndex(headers, "Mt Net L. Forfait"), intervention: headerIndex(headers, "Intervention"), section: headerIndex(headers, "Section Intervention"),
  };
  if ([idx.or, idx.immat, idx.opened, idx.hours, idx.labor, idx.divers, idx.parts, idx.intervention, idx.section].some((value) => value < 0)) throw new Error("Le format OR en cours ne correspond pas au modèle attendu.");
  const snapshotAt = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, any>();
  rows.slice(1).forEach((row) => {
    const workOrder = String(row[idx.or] ?? "").trim();
    if (!workOrder) return;
    const sector = mapSector(row[idx.section], row[idx.intervention]);
    const key = `${workOrder}|${sector.key}`;
    const openedAt = excelDate(row[idx.opened]);
    const current = groups.get(key) ?? { snapshot_at: snapshotAt, registration: String(row[idx.immat] ?? "").trim() || null, work_order: workOrder, client: String(row[idx.client] ?? "").trim() || null, sector_key: sector.key, sector_label: sector.label, opened_at: openedAt, hours: 0, labor: 0, parts: 0, other: 0, activities: new Map<string, { hours: number; potential_revenue: number }>() };
    const hours = numeric(row[idx.hours]);
    const labor = numeric(row[idx.labor]);
    const parts = numeric(row[idx.parts]);
    const other = numeric(row[idx.divers]) + numeric(row[idx.paint]) + numeric(row[idx.forfait]);
    current.hours += hours; current.labor += labor; current.parts += parts; current.other += other;
    const activity = String(row[idx.intervention] ?? "Activité non renseignée").trim();
    const act = current.activities.get(activity) ?? { hours: 0, potential_revenue: 0 };
    act.hours += hours; act.potential_revenue += labor + parts + other; current.activities.set(activity, act);
    groups.set(key, current);
  });
  return { snapshotAt, rows: [...groups.values()].filter((row) => row.hours > 0 || Math.abs(row.labor + row.parts + row.other) > .001).map((row) => {
    const activities = [...row.activities.entries()].map(([name, value]: any) => ({ name, hours: value.hours, potential_revenue: value.potential_revenue })).sort((a, b) => b.hours - a.hours || b.potential_revenue - a.potential_revenue);
    const age = row.opened_at ? Math.max(0, Math.floor((new Date(`${snapshotAt}T12:00:00Z`).getTime() - new Date(`${row.opened_at}T12:00:00Z`).getTime()) / 86400000)) : null;
    const potential = row.labor + row.parts + row.other;
    return { snapshot_at: snapshotAt, registration: row.registration, work_order: row.work_order, client: row.client, sector_key: row.sector_key, sector_label: row.sector_label, status: activities[0]?.name || row.sector_label, age_days: age, remaining_minutes: row.hours > 0 ? row.hours * 60 : null, booked_minutes: row.hours > 0 ? row.hours * 60 : null, estimated_total_minutes: row.hours > 0 ? row.hours * 60 : null, vin: null, opened_at: row.opened_at, potential_revenue_total: potential, potential_labor_revenue: row.labor, potential_parts_revenue: row.parts, potential_other_revenue: row.other, primary_activity: activities[0]?.name || null, metadata: { activities: activities.slice(0, 12) } };
  }) };
}

async function sendBatches(url: string, rows: any[], snapshotAt?: string) {
  const size = url.includes("workload") ? 500 : 900;
  let saved = 0;
  for (let offset = 0; offset < rows.length; offset += size) {
    const batch = rows.slice(offset, offset + size);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ snapshotAt, replace: offset === 0, rows: batch }) });
    const payload = await response.json() as { error?: string; saved?: number };
    if (!response.ok) throw new Error(payload.error || "Import SQL impossible.");
    saved += payload.saved ?? batch.length;
  }
  return saved;
}

export default function SqlSourcePortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [workloadFile, setWorkloadFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const locate = () => {
      const cards = document.querySelector(".source-cards");
      if (!cards?.parentElement) return setHost(null);
      let root = document.getElementById("sql-source-portal-root");
      if (!root) { root = document.createElement("div"); root.id = "sql-source-portal-root"; cards.parentElement.insertBefore(root, cards); }
      setHost(root);
    };
    locate(); const observer = new MutationObserver(locate); observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect();
  }, []);
  useEffect(() => { fetch("/api/import-book/auth", { cache: "no-store" }).then((r) => r.json() as Promise<AuthPayload>).then((p) => setAuthorized(Boolean(p.authenticated))).catch(() => setAuthorized(false)); }, []);

  async function importInvoices() {
    if (!invoiceFile || !authorized) return setStatus("Déverrouille l’accès puis sélectionne le reporting factures.");
    setBusy(true); setStatus("Analyse des factures SQL…");
    try { const rows = await parseInvoices(invoiceFile); const saved = await sendBatches("/api/sql-feed/invoices", rows); setStatus(`${saved.toLocaleString("fr-FR")} factures/avoirs enregistrés. Chiffre d’affaires utilise maintenant le reporting SQL.`); setInvoiceFile(null); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Erreur import factures."); } finally { setBusy(false); }
  }

  async function importWorkload() {
    if (!workloadFile || !authorized) return setStatus("Déverrouille l’accès puis sélectionne OR en cours.");
    setBusy(true); setStatus("Analyse des OR, activités, temps MO et potentiel CA…");
    try { const parsed = await parseWorkload(workloadFile); const saved = await sendBatches("/api/sql-feed/workload", parsed.rows, parsed.snapshotAt); setStatus(`${saved.toLocaleString("fr-FR")} lignes OR/secteur enregistrées. Pilotage peut maintenant calculer FIFO, RUN, heures et potentiel CA.`); setWorkloadFile(null); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Erreur import encours."); } finally { setBusy(false); }
  }

  if (!host || !host.isConnected) return null;
  return createPortal(<section className="sql-source-hub">
    <div className="sql-source-head"><span>PASSERELLE SQL · MODE DE SECOURS</span><h3>Tester les deux exports réels avant connexion VPN</h3><p>Ces imports utilisent exactement la structure attendue de la future passerelle : reporting factures pour le CA, OR en cours pour le moteur de pilotage.</p></div>
    <div className="sql-source-grid">
      <article><span>SQL FACTURES</span><strong>Reporting CRVO Lens factures</strong><small>No OR · No Facture · Date · Heures MO · CA · VIN</small><label><input type="file" accept=".xlsx,.xls" onChange={(e) => { setInvoiceFile(e.target.files?.[0] ?? null); setStatus(""); }} /><b>{invoiceFile?.name || "Choisir le reporting factures"}</b></label><button disabled={!invoiceFile || authorized !== true || busy} onClick={() => void importInvoices()}>Importer les factures SQL</button></article>
      <article><span>SQL ENCOURS</span><strong>OR en cours</strong><small>OR · Immat · activité · secteur · heures MO · potentiel CA</small><label><input type="file" accept=".xlsx,.xls" onChange={(e) => { setWorkloadFile(e.target.files?.[0] ?? null); setStatus(""); }} /><b>{workloadFile?.name || "Choisir OR en cours"}</b></label><button disabled={!workloadFile || authorized !== true || busy} onClick={() => void importWorkload()}>Importer l’encours SQL</button></article>
    </div>
    {authorized === false && <p className="sql-source-note">Déverrouille d’abord l’accès sécurisé dans le bloc d’import financier ci-dessus.</p>}
    {status && <p className="sql-source-status">{status}</p>}
  </section>, host);
}
