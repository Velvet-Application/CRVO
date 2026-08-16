"use client";

import { ChangeEvent, useMemo, useState } from "react";
import styles from "./payroll-staff-import.module.css";

type Cell = string | number | boolean | Date | null | undefined;
type PayrollRow = {
  matricule: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  service: string | null;
  teamCode: string | null;
  jobTitle: string | null;
  entryDate: string | null;
  exitDate: string | null;
  status: string | null;
};
type Parsed = { rows: PayrollRow[]; sha256: string; filename: string; headers: string[]; warnings: string[] };
type Result = { ok?: boolean; rows?: number; active?: number; exits?: number; bonusConfigured?: number; bonusPending?: number; historyPreserved?: boolean; error?: string };

function key(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function text(value: unknown) { const out = String(value ?? "").trim(); return out || null; }
function pick(row: Record<string, Cell>, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[key(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}
function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function dateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === "number" && Number.isFinite(value) && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n > 20000 && n < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
      return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
  }
  let match = raw.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (match) return isoDate(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}
function team(value: unknown) {
  const raw = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if (["A", "B", "C"].includes(raw)) return raw;
  const match = raw.match(/(?:EQUIPE|TEAM|SHIFT|GROUPE)\s*[-_:]?\s*([ABC])\b/);
  return match?.[1] ?? null;
}
function isExit(row: PayrollRow) {
  const status = String(row.status ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const explicit = /(sorti|sortie|quitte|inactif|inactive|terminated|exit|radie)/.test(status);
  const pastExit = row.exitDate ? new Date(`${row.exitDate}T12:00:00`).getTime() <= Date.now() : false;
  return explicit || pastExit;
}
function gridToRecords(grid: Cell[][]) {
  const hints = new Set(["matricule", "nom", "prenom", "nom_prenom", "collaborateur", "salarie", "service", "equipe", "poste", "emploi", "metier", "fonction", "date_entree", "date_embauche", "date_sortie", "statut"]);
  const headerIndex = grid.slice(0, 35).map((row, index) => {
    const keys = row.map(key).filter(Boolean);
    return { index, score: keys.filter(item => hints.has(item)).length * 30 + Math.min(keys.length, 15) };
  }).sort((a, b) => b.score - a.score)[0]?.index ?? 0;
  const seen = new Map<string, number>();
  const headers = (grid[headerIndex] ?? []).map((value, index) => key(value) || `col_${index + 1}`).map(name => {
    const count = (seen.get(name) ?? 0) + 1; seen.set(name, count); return count === 1 ? name : `${name}_${count}`;
  });
  const rows = grid.slice(headerIndex + 1).filter(row => row.some(value => String(value ?? "").trim())).map(row => {
    const out: Record<string, Cell> = {}; headers.forEach((name, index) => out[name] = row[index] ?? null); return out;
  });
  return { headers, rows };
}
function parseCsv(source: string) {
  const first = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].map(item => ({ item, count: first.split(item).length })).sort((a, b) => b.count - a.count)[0]?.item ?? ";";
  const grid: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && source[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(value => value.trim())) grid.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(value => value.trim())) grid.push(row);
  return gridToRecords(grid);
}
async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function parseFile(file: File): Promise<Parsed> {
  if (file.size <= 0 || file.size > 15 * 1024 * 1024) throw new Error("Le fichier est vide ou dépasse 15 Mo.");
  let parsed: { headers: string[]; rows: Record<string, Cell>[] };
  if (/\.csv$/i.test(file.name)) parsed = parseCsv(await file.text());
  else if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import("@e965/xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    let best: Cell[][] = [], score = -1;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]; if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null }) as Cell[][];
      const count = grid.filter(row => row.some(value => String(value ?? "").trim())).length;
      if (count > score) { score = count; best = grid; }
    }
    parsed = gridToRecords(best);
  } else throw new Error("Format refusé. Utilise CSV, XLSX ou XLS.");

  const warnings: string[] = [];
  const rows: PayrollRow[] = [];
  parsed.rows.forEach((raw, index) => {
    const firstName = text(pick(raw, ["prenom", "first_name", "firstname"]));
    const lastName = text(pick(raw, ["nom", "last_name", "lastname"]));
    const explicitName = text(pick(raw, ["nom_prenom", "nom_complet", "full_name", "collaborateur", "salarie", "employee"]));
    const fullName = (explicitName ?? [firstName, lastName].filter(Boolean).join(" ")).trim();
    if (!fullName) { warnings.push(`Ligne ${index + 2} ignorée : nom absent.`); return; }
    const matricule = text(pick(raw, ["matricule", "matricule_salarie", "employee_id", "id_salarie", "code_salarie", "code_collaborateur", "mat"]));
    const service = text(pick(raw, ["service", "secteur", "atelier", "departement", "department", "activite"]));
    const jobTitle = text(pick(raw, ["poste", "emploi", "metier", "fonction", "job_title", "libelle_emploi", "intitule_poste", "intitule_emploi"]));
    const entryRaw = pick(raw, ["date_entree", "date_d_entree", "entree", "date_embauche", "date_debut_contrat", "debut_contrat"]);
    const exitRaw = pick(raw, ["date_sortie", "sortie", "date_fin_contrat", "date_depart", "fin_contrat"]);
    const status = text(pick(raw, ["statut", "situation", "etat", "status", "mouvement", "type_mouvement"]));
    const entryDate = dateValue(entryRaw), exitDate = dateValue(exitRaw);
    if (entryRaw && !entryDate) warnings.push(`${fullName} : date d'entrée non reconnue.`);
    if (exitRaw && !exitDate) warnings.push(`${fullName} : date de sortie non reconnue.`);
    rows.push({ matricule, firstName, lastName, fullName, service, teamCode: team(pick(raw, ["equipe", "equipe_travail", "team", "shift", "groupe"])), jobTitle, entryDate, exitDate, status });
  });
  if (!rows.length) throw new Error("Aucun collaborateur exploitable trouvé dans le fichier.");
  if (rows.length > 2000) throw new Error("Le fichier contient plus de 2 000 collaborateurs.");
  return { rows, sha256: await sha256File(file), filename: file.name, headers: parsed.headers, warnings: warnings.slice(0, 12) };
}

export default function PayrollStaffImport() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const counts = useMemo(() => {
    const rows = parsed?.rows ?? [];
    return { total: rows.length, exits: rows.filter(isExit).length, active: rows.filter(row => !isExit(row)).length };
  }, [parsed]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setLoading(true); setError(""); setResult(null);
    try { setParsed(await parseFile(file)); }
    catch (reason) { setParsed(null); setError(reason instanceof Error ? reason.message : "Lecture du fichier impossible."); }
    finally { setLoading(false); event.target.value = ""; }
  }

  async function importRows() {
    if (!parsed) return;
    setSending(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/data-import/payroll-staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: parsed.filename, sha256: parsed.sha256, rows: parsed.rows }) });
      const payload = await response.json().catch(() => ({})) as Result;
      if (!response.ok) throw new Error(payload.error || "Import refusé.");
      setResult(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import impossible."); }
    finally { setSending(false); }
  }

  return <section className={styles.panel}>
    <div className={styles.head}>
      <div><span>PAIE · CYCLE DE VIE COLLABORATEUR</span><h2>Entrées & sorties</h2><p>Le fichier de paie devient la source de référence pour activer ou sortir un collaborateur des listes opérationnelles et des futurs workflows de prime, sans supprimer son historique.</p></div>
      <label className={styles.upload}>{loading ? "LECTURE…" : "CHOISIR LE FICHIER"}<input type="file" accept=".csv,.xlsx,.xls" onChange={choose} disabled={loading || sending}/></label>
    </div>

    <div className={styles.rules}>
      <article><strong>ENTRÉE</strong><p>Création / réactivation du collaborateur dans le référentiel RH, les affectations de productivité et la configuration Variable lorsque le métier est reconnu.</p></article>
      <article><strong>SORTIE</strong><p>Désactivation immédiate des référentiels actifs. Aucun fait historique, workflow clôturé, validation ou résultat passé n'est supprimé.</p></article>
      <article><strong>SÉCURITÉ</strong><p>Une sortie n'est jamais déduite parce qu'un nom manque dans le fichier : elle exige un statut de sortie ou une date de sortie explicite.</p></article>
    </div>

    {error && <div className={styles.error}>{error}</div>}
    {parsed && <>
      <div className={styles.summary}>
        <div><span>FICHIER</span><strong>{parsed.filename}</strong></div><div><span>COLLABORATEURS</span><strong>{counts.total}</strong></div><div><span>ACTIFS / ENTRÉES</span><strong>{counts.active}</strong></div><div><span>SORTIES</span><strong>{counts.exits}</strong></div>
      </div>
      {parsed.warnings.length > 0 && <div className={styles.warning}><strong>Points à contrôler</strong>{parsed.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      <div className={styles.tableWrap}><table><thead><tr><th>Collaborateur</th><th>Matricule</th><th>Service</th><th>Équipe</th><th>Poste / métier</th><th>Entrée</th><th>Sortie</th><th>Action</th></tr></thead><tbody>{parsed.rows.slice(0, 12).map((row, index) => <tr key={`${row.matricule}-${row.fullName}-${index}`}><td><strong>{row.fullName}</strong></td><td>{row.matricule ?? "—"}</td><td>{row.service ?? "—"}</td><td>{row.teamCode ?? "—"}</td><td>{row.jobTitle ?? "—"}</td><td>{row.entryDate ?? "—"}</td><td>{row.exitDate ?? "—"}</td><td><span className={isExit(row) ? styles.exit : styles.entry}>{isExit(row) ? "SORTIE" : "ACTIF"}</span></td></tr>)}</tbody></table></div>
      {parsed.rows.length > 12 && <small className={styles.more}>Aperçu des 12 premières lignes sur {parsed.rows.length}.</small>}
      <div className={styles.actions}><button type="button" onClick={() => setParsed(null)} disabled={sending}>ANNULER</button><button type="button" className={styles.primary} onClick={importRows} disabled={sending}>{sending ? "INTÉGRATION…" : "INTÉGRER LES MOUVEMENTS"}</button></div>
    </>}

    {result?.ok && <div className={styles.success}><strong>Import terminé.</strong><span>{result.active ?? 0} actifs / entrées · {result.exits ?? 0} sorties · {result.bonusConfigured ?? 0} configurations Variable reconnues.</span>{Boolean(result.bonusPending) && <span>{result.bonusPending} collaborateur(s) créé(s) mais en attente de rattachement Payplan : ils ne seront pas intégrés à un workflow tant que leur métier n'est pas identifié.</span>}<span>Historique conservé : {result.historyPreserved ? "OUI" : "—"}</span></div>}
  </section>;
}
