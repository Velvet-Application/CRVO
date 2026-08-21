"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./transport-decision-matrix.module.css";

type Crvo = "LENS" | "INGRANDES" | "LYON" | "ISTRES";
type Direction = "BOTH" | "PDV_TO_CRVO" | "CRVO_TO_PDV";
type Scenario = "STANDARD" | "OPTIMIZED" | "EMPTY";
type CarrierType = "INTERNAL" | "PARTNER";

type Tariff = {
  id: number;
  crvo: Crvo;
  pdvName: string;
  address?: string | null;
  postalCode?: string | null;
  country?: string | null;
  carrier: string;
  carrierType: CarrierType;
  direction: Direction;
  scenario: Scenario;
  costPerVehicle: number;
  leadTimeDays?: number | null;
  sourceLabel?: string | null;
  sourceKind?: "CONTRACT" | "EMAIL" | "MANUAL";
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
  updatedAt?: string | null;
};

type MatrixPayload = {
  connected?: boolean;
  canEdit?: boolean;
  settings?: { costWeight?: number; leadTimeWeight?: number; updatedAt?: string | null };
  tariffs?: Tariff[];
  error?: string;
};

type FormState = {
  id?: number;
  crvo: Crvo;
  pdvName: string;
  address: string;
  postalCode: string;
  country: string;
  carrier: string;
  carrierType: CarrierType;
  direction: Direction;
  scenario: Scenario;
  costPerVehicle: string;
  leadTimeDays: string;
  sourceLabel: string;
  validFrom: string;
  validTo: string;
  active: boolean;
};

const CRVOS: Crvo[] = ["LENS", "INGRANDES", "LYON", "ISTRES"];
const CRVO_LABEL: Record<Crvo, string> = { LENS: "CRVO Lens", INGRANDES: "CRVO Ingrandes", LYON: "CRVO Lyon", ISTRES: "CRVO Istres" };
const DIRECTION_LABEL: Record<Direction, string> = {
  BOTH: "Aller / retour indifférencié",
  PDV_TO_CRVO: "PDV → CRVO",
  CRVO_TO_PDV: "CRVO → PDV",
};
const SCENARIO_LABEL: Record<Scenario, string> = {
  STANDARD: "Tarif standard",
  OPTIMIZED: "Rotation optimisée",
  EMPTY: "Trajet à vide / non appairé",
};

function euro(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(number) : "—";
}
function numberLabel(value: unknown, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(number) : "—";
}
function pdvKey(row: Pick<Tariff, "pdvName" | "postalCode">) { return `${row.pdvName}|||${row.postalCode ?? ""}`; }
function emptyForm(crvo: Crvo = "LENS"): FormState {
  return {
    crvo, pdvName: "", address: "", postalCode: "", country: "FR", carrier: "TRANSPHÈRE",
    carrierType: "INTERNAL", direction: "BOTH", scenario: "STANDARD", costPerVehicle: "", leadTimeDays: "",
    sourceLabel: "Tarif Transphère", validFrom: "", validTo: "", active: true,
  };
}

export default function TransportDecisionMatrix() {
  const [payload, setPayload] = useState<MatrixPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"compare" | "settings">("compare");
  const [crvo, setCrvo] = useState<Crvo>("LENS");
  const [direction, setDirection] = useState<Direction>("PDV_TO_CRVO");
  const [pdv, setPdv] = useState("");
  const [scenario, setScenario] = useState<Scenario>("STANDARD");
  const [form, setForm] = useState<FormState>(() => emptyForm("LENS"));
  const [filterCrvo, setFilterCrvo] = useState<Crvo | "ALL">("ALL");
  const [filterCarrier, setFilterCarrier] = useState("ALL");
  const [filterText, setFilterText] = useState("");
  const [costWeight, setCostWeight] = useState("100");
  const [leadWeight, setLeadWeight] = useState("0");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/transphere/transport-matrix?_=${Date.now()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as MatrixPayload;
      if (!response.ok || body.connected === false) throw new Error(body.error || "Matrice transport indisponible.");
      body.tariffs = (body.tariffs ?? []).map((row) => ({
        ...row,
        id: Number(row.id),
        costPerVehicle: Number(row.costPerVehicle),
        leadTimeDays: row.leadTimeDays === null || row.leadTimeDays === undefined ? null : Number(row.leadTimeDays),
      }));
      setPayload(body);
      setCostWeight(String(Number(body.settings?.costWeight ?? 100)));
      setLeadWeight(String(Number(body.settings?.leadTimeWeight ?? 0)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Matrice transport indisponible.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const tariffs = payload?.tariffs ?? [];
  const activeForCrvo = useMemo(() => tariffs.filter((row) => row.active && row.crvo === crvo), [tariffs, crvo]);
  const pdvs = useMemo(() => {
    const map = new Map<string, Tariff>();
    for (const row of activeForCrvo) if (!map.has(pdvKey(row))) map.set(pdvKey(row), row);
    return [...map.values()].sort((a, b) => a.pdvName.localeCompare(b.pdvName, "fr"));
  }, [activeForCrvo]);

  useEffect(() => {
    if (!pdvs.length) { setPdv(""); return; }
    if (!pdvs.some((row) => pdvKey(row) === pdv)) setPdv(pdvKey(pdvs[0]));
  }, [pdvs, pdv]);

  const selectedPdv = pdvs.find((row) => pdvKey(row) === pdv);
  const scenarios = useMemo(() => {
    const set = new Set<Scenario>();
    for (const row of activeForCrvo) if (pdvKey(row) === pdv) set.add(row.scenario);
    if (!set.size) set.add("STANDARD");
    return ["STANDARD", "OPTIMIZED", "EMPTY"].filter((value) => set.has(value as Scenario)) as Scenario[];
  }, [activeForCrvo, pdv]);

  useEffect(() => {
    if (!scenarios.includes(scenario)) setScenario(scenarios[0] ?? "STANDARD");
  }, [scenario, scenarios]);

  const comparisons = useMemo(() => {
    if (!pdv) return [] as Array<Tariff & { score: number; delta: number }>;
    const candidates = activeForCrvo.filter((row) => {
      if (pdvKey(row) !== pdv) return false;
      if (!(row.direction === "BOTH" || row.direction === direction)) return false;
      if (scenario === "STANDARD") return row.scenario === "STANDARD";
      return row.scenario === scenario || row.scenario === "STANDARD";
    });
    const chosen = new Map<string, Tariff>();
    const priority = (row: Tariff) => (row.direction === direction ? 2 : 0) + (row.scenario === scenario ? 2 : row.scenario === "STANDARD" ? 1 : 0);
    for (const row of candidates) {
      const current = chosen.get(row.carrier);
      if (!current || priority(row) > priority(current)) chosen.set(row.carrier, row);
    }
    const rows = [...chosen.values()];
    const minCost = Math.min(...rows.map((row) => row.costPerVehicle));
    const leads = rows.map((row) => Number(row.leadTimeDays)).filter((value) => Number.isFinite(value) && value > 0);
    const minLead = leads.length ? Math.min(...leads) : null;
    const cw = Math.max(0, Number(payload?.settings?.costWeight ?? 100));
    const lw = Math.max(0, Number(payload?.settings?.leadTimeWeight ?? 0));
    return rows.map((row) => {
      const costScore = minCost > 0 && row.costPerVehicle > 0 ? minCost / row.costPerVehicle * 100 : 100;
      const lead = Number(row.leadTimeDays);
      const hasLead = minLead !== null && Number.isFinite(lead) && lead > 0;
      const leadScore = hasLead ? minLead! / lead * 100 : 0;
      const effectiveWeight = cw + (hasLead ? lw : 0);
      const score = effectiveWeight > 0 ? (costScore * cw + leadScore * (hasLead ? lw : 0)) / effectiveWeight : costScore;
      return { ...row, score: Math.round(score), delta: row.costPerVehicle - minCost };
    }).sort((a, b) => b.score - a.score || a.costPerVehicle - b.costPerVehicle);
  }, [activeForCrvo, direction, payload?.settings?.costWeight, payload?.settings?.leadTimeWeight, pdv, scenario]);

  const internalAvailable = comparisons.some((row) => row.carrierType === "INTERNAL");
  const carriers = useMemo(() => [...new Set(tariffs.map((row) => row.carrier))].sort((a, b) => a.localeCompare(b, "fr")), [tariffs]);
  const filteredTariffs = useMemo(() => tariffs.filter((row) => {
    if (filterCrvo !== "ALL" && row.crvo !== filterCrvo) return false;
    if (filterCarrier !== "ALL" && row.carrier !== filterCarrier) return false;
    if (filterText.trim()) {
      const haystack = `${row.pdvName} ${row.postalCode ?? ""} ${row.address ?? ""} ${row.carrier}`.toLowerCase();
      if (!haystack.includes(filterText.trim().toLowerCase())) return false;
    }
    return true;
  }), [filterCarrier, filterCrvo, filterText, tariffs]);

  const counts = useMemo(() => CRVOS.map((site) => ({
    site,
    rows: tariffs.filter((row) => row.crvo === site && row.active).length,
    pdvs: new Set(tariffs.filter((row) => row.crvo === site && row.active).map(pdvKey)).size,
  })), [tariffs]);

  function edit(row: Tariff) {
    setForm({
      id: row.id, crvo: row.crvo, pdvName: row.pdvName, address: row.address ?? "", postalCode: row.postalCode ?? "",
      country: row.country ?? "FR", carrier: row.carrier, carrierType: row.carrierType, direction: row.direction,
      scenario: row.scenario, costPerVehicle: String(row.costPerVehicle), leadTimeDays: row.leadTimeDays == null ? "" : String(row.leadTimeDays),
      sourceLabel: row.sourceLabel ?? "", validFrom: row.validFrom ?? "", validTo: row.validTo ?? "", active: row.active,
    });
    setTab("settings");
    setNotice("Tarif chargé dans le formulaire. Modifiez puis enregistrez.");
  }

  async function saveTariff(event: React.FormEvent) {
    event.preventDefault();
    if (!payload?.canEdit) return;
    const cost = Number(String(form.costPerVehicle).replace(",", "."));
    const lead = form.leadTimeDays.trim() ? Number(String(form.leadTimeDays).replace(",", ".")) : null;
    if (!form.pdvName.trim() || !form.carrier.trim() || !Number.isFinite(cost) || cost < 0 || (lead !== null && (!Number.isFinite(lead) || lead < 0))) {
      setError("Vérifiez le PDV, la société, le coût au véhicule et le lead-time."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/transphere/transport-matrix", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tariff", ...form, costPerVehicle: cost, leadTimeDays: lead }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Enregistrement impossible.");
      setNotice(form.id ? "Tarif mis à jour." : "Tarif ajouté à la matrice.");
      setForm(emptyForm(form.crvo));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  async function saveWeights() {
    if (!payload?.canEdit) return;
    const cw = Number(costWeight.replace(",", "."));
    const lw = Number(leadWeight.replace(",", "."));
    if (!Number.isFinite(cw) || !Number.isFinite(lw) || cw < 0 || lw < 0 || Math.abs(cw + lw - 100) > 0.01) {
      setError("La pondération coût + délai doit être égale à 100 %."); return;
    }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/transphere/transport-matrix", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", costWeight: cw, leadTimeWeight: lw }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Paramétrage impossible.");
      setNotice("Pondération de recommandation mise à jour."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Paramétrage impossible."); }
    finally { setSaving(false); }
  }

  async function remove(row: Tariff) {
    if (!payload?.canEdit || !window.confirm(`Supprimer le tarif ${row.carrier} · ${row.pdvName} ?`)) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/transphere/transport-matrix?id=${row.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Suppression impossible.");
      setNotice("Tarif supprimé."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Suppression impossible."); }
    finally { setSaving(false); }
  }

  return <section className={styles.matrix}>
    <div className={styles.topline}>
      <div>
        <small>03 · MATRICE DÉCISIONNELLE TRANSPORT</small>
        <h2>Choisir le bon transporteur, liaison par liaison</h2>
        <p>Comparaison du coût au véhicule et indice de recommandation. Les tarifs contractuels sont centralisés et restent modifiables dans Paramètres.</p>
      </div>
      <div className={styles.tabs} role="tablist" aria-label="Matrice transport">
        <button className={tab === "compare" ? styles.activeTab : ""} onClick={() => setTab("compare")}>Comparateur</button>
        <button className={tab === "settings" ? styles.activeTab : ""} onClick={() => setTab("settings")}>Paramètres</button>
      </div>
    </div>

    <div className={styles.coverage}>
      {counts.map(({ site, rows, pdvs: totalPdvs }) => <div key={site} className={rows ? styles.covered : styles.missing}>
        <span>{CRVO_LABEL[site]}</span><strong>{totalPdvs || "—"}</strong><small>{rows ? `${rows} tarifs actifs` : "à compléter"}</small>
      </div>)}
    </div>

    {loading && !payload ? <div className={styles.state}>Chargement de la matrice…</div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}

    {payload && tab === "compare" ? <>
      <div className={styles.selectorGrid}>
        <label><span>1 · CRVO</span><select value={crvo} onChange={(event) => setCrvo(event.target.value as Crvo)}>{CRVOS.map((value) => <option key={value} value={value}>{CRVO_LABEL[value]}</option>)}</select></label>
        <label><span>2 · SENS DU FLUX</span><select value={direction} onChange={(event) => setDirection(event.target.value as Direction)}><option value="PDV_TO_CRVO">PDV → CRVO</option><option value="CRVO_TO_PDV">CRVO → PDV</option></select></label>
        <label className={styles.pdvSelect}><span>3 · POINT DE VENTE</span><select value={pdv} onChange={(event) => setPdv(event.target.value)} disabled={!pdvs.length}>{pdvs.length ? pdvs.map((row) => <option key={pdvKey(row)} value={pdvKey(row)}>{row.pdvName} · {row.postalCode || "—"}</option>) : <option>Aucun PDV tarifé</option>}</select></label>
        {scenarios.length > 1 ? <label><span>4 · CONTEXTE</span><select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}>{scenarios.map((value) => <option key={value} value={value}>{SCENARIO_LABEL[value]}</option>)}</select></label> : null}
      </div>

      {selectedPdv ? <div className={styles.routeLine}><div><span>{CRVO_LABEL[crvo]}</span><b>{direction === "PDV_TO_CRVO" ? "←" : "→"}</b><span>{selectedPdv.pdvName}</span></div><small>{selectedPdv.address || selectedPdv.postalCode || "Adresse non renseignée"}</small></div> : null}

      {!pdvs.length ? <div className={styles.emptyState}><strong>{CRVO_LABEL[crvo]} n’a pas encore de grille tarifaire.</strong><p>Le CRVO est déjà prévu dans la matrice. Ajoutez ses partenaires et tarifs depuis l’onglet Paramètres.</p></div> : null}

      {comparisons.length ? <div className={styles.results}>
        <div className={styles.resultHead}><div><span>COMPARAISON DISPONIBLE</span><strong>{comparisons.length} société{comparisons.length > 1 ? "s" : ""}</strong></div><div><span>INDICE ACTUEL</span><strong>{Number(payload.settings?.costWeight ?? 100)} % coût · {Number(payload.settings?.leadTimeWeight ?? 0)} % délai</strong></div></div>
        <div className={styles.cards}>
          {comparisons.map((row, index) => <article key={row.id} className={`${styles.carrierCard} ${index === 0 ? styles.best : ""}`}>
            <div className={styles.cardTop}><div><span className={row.carrierType === "INTERNAL" ? styles.internal : styles.partner}>{row.carrierType === "INTERNAL" ? "TRANSPHÈRE" : "PARTENAIRE"}</span><h3>{row.carrier}</h3></div>{index === 0 ? <b className={styles.recommended}>RECOMMANDÉ</b> : null}</div>
            <div className={styles.price}>{euro(row.costPerVehicle)}<small>/ véhicule</small></div>
            <div className={styles.scoreRow}><div><span>INDICE</span><strong>{row.score}<small>/100</small></strong></div><div><span>LEAD-TIME</span><strong>{row.leadTimeDays == null ? "—" : `${numberLabel(row.leadTimeDays)} j`}</strong></div><div><span>ÉCART COÛT</span><strong>{row.delta <= 0.004 ? "Meilleur prix" : `+ ${euro(row.delta)}`}</strong></div></div>
            <div className={styles.scoreBar}><i style={{ width: `${Math.max(0, Math.min(100, row.score))}%` }}/></div>
            <footer><span>{SCENARIO_LABEL[row.scenario]}</span><span>{DIRECTION_LABEL[row.direction]}</span><small>{row.sourceLabel || "Source non renseignée"}</small></footer>
          </article>)}
        </div>
        {!internalAvailable ? <div className={styles.info}><strong>Tarif Transphère non renseigné pour cette liaison.</strong> Le partenaire contractuel est calculé, mais la vraie comparaison interne / sous-traitance sera complète dès que le tarif Transphère sera ajouté dans Paramètres.</div> : null}
        {comparisons.length === 1 ? <div className={styles.info}>Comparaison limitée : un seul tarif est disponible sur cette liaison et ce scénario.</div> : null}
      </div> : pdvs.length ? <div className={styles.emptyState}><strong>Aucun tarif ne correspond à ce sens / scénario.</strong><p>Vous pouvez créer la ligne manquante dans Paramètres sans modifier les autres grilles.</p></div> : null}
    </> : null}

    {payload && tab === "settings" ? <div className={styles.settings}>
      {!payload.canEdit ? <div className={styles.info}><strong>Consultation uniquement.</strong> La modification des tarifs est réservée aux administrateurs et responsables Transphère.</div> : null}
      <div className={styles.settingsGrid}>
        <article className={styles.settingsCard}>
          <div className={styles.settingsTitle}><div><small>INDICE DE RECOMMANDATION</small><h3>Pondération</h3></div><b>{Number(costWeight || 0) + Number(leadWeight || 0)} %</b></div>
          <p>Par défaut, la décision est 100 % orientée coût. Vous pouvez intégrer le délai sans modifier les tarifs.</p>
          <div className={styles.weightFields}><label><span>Coût</span><div><input type="number" min="0" max="100" step="1" value={costWeight} onChange={(event) => setCostWeight(event.target.value)} disabled={!payload.canEdit}/><b>%</b></div></label><label><span>Délai</span><div><input type="number" min="0" max="100" step="1" value={leadWeight} onChange={(event) => setLeadWeight(event.target.value)} disabled={!payload.canEdit}/><b>%</b></div></label></div>
          <button className={styles.primary} disabled={!payload.canEdit || saving} onClick={() => void saveWeights()}>Enregistrer la pondération</button>
        </article>

        <form className={styles.settingsCard} onSubmit={saveTariff}>
          <div className={styles.settingsTitle}><div><small>TARIF INDIVIDUEL</small><h3>{form.id ? "Modifier le tarif" : "Ajouter un tarif"}</h3></div>{form.id ? <button type="button" className={styles.linkButton} onClick={() => setForm(emptyForm(form.crvo))}>Annuler</button> : null}</div>
          <div className={styles.formGrid}>
            <label><span>CRVO</span><select value={form.crvo} onChange={(event) => setForm((old) => ({ ...old, crvo: event.target.value as Crvo }))} disabled={!payload.canEdit}>{CRVOS.map((value) => <option key={value} value={value}>{CRVO_LABEL[value]}</option>)}</select></label>
            <label><span>Société</span><input value={form.carrier} onChange={(event) => setForm((old) => ({ ...old, carrier: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label><span>Type</span><select value={form.carrierType} onChange={(event) => { const type = event.target.value as CarrierType; setForm((old) => ({ ...old, carrierType: type, carrier: type === "INTERNAL" && (!old.carrier || old.carrier === "TRANSPHÈRE") ? "TRANSPHÈRE" : old.carrier })); }} disabled={!payload.canEdit}><option value="INTERNAL">Transphère / interne</option><option value="PARTNER">Partenaire</option></select></label>
            <label className={styles.formWide}><span>Point de vente</span><input value={form.pdvName} onChange={(event) => setForm((old) => ({ ...old, pdvName: event.target.value }))} disabled={!payload.canEdit} required/></label>
            <label className={styles.formWide}><span>Adresse</span><input value={form.address} onChange={(event) => setForm((old) => ({ ...old, address: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label><span>Code postal</span><input value={form.postalCode} onChange={(event) => setForm((old) => ({ ...old, postalCode: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label><span>Pays</span><input value={form.country} onChange={(event) => setForm((old) => ({ ...old, country: event.target.value.toUpperCase() }))} disabled={!payload.canEdit}/></label>
            <label><span>Sens</span><select value={form.direction} onChange={(event) => setForm((old) => ({ ...old, direction: event.target.value as Direction }))} disabled={!payload.canEdit}><option value="BOTH">Aller / retour</option><option value="PDV_TO_CRVO">PDV → CRVO</option><option value="CRVO_TO_PDV">CRVO → PDV</option></select></label>
            <label><span>Scénario</span><select value={form.scenario} onChange={(event) => setForm((old) => ({ ...old, scenario: event.target.value as Scenario }))} disabled={!payload.canEdit}><option value="STANDARD">Standard</option><option value="OPTIMIZED">Rotation optimisée</option><option value="EMPTY">À vide</option></select></label>
            <label><span>Coût / VO (€)</span><input type="number" min="0" step="0.01" value={form.costPerVehicle} onChange={(event) => setForm((old) => ({ ...old, costPerVehicle: event.target.value }))} disabled={!payload.canEdit} required/></label>
            <label><span>Lead-time (j)</span><input type="number" min="0" step="0.1" value={form.leadTimeDays} onChange={(event) => setForm((old) => ({ ...old, leadTimeDays: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label className={styles.formWide}><span>Source / commentaire</span><input value={form.sourceLabel} onChange={(event) => setForm((old) => ({ ...old, sourceLabel: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label><span>Valide du</span><input type="date" value={form.validFrom} onChange={(event) => setForm((old) => ({ ...old, validFrom: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label><span>Valide au</span><input type="date" value={form.validTo} onChange={(event) => setForm((old) => ({ ...old, validTo: event.target.value }))} disabled={!payload.canEdit}/></label>
            <label className={styles.checkbox}><input type="checkbox" checked={form.active} onChange={(event) => setForm((old) => ({ ...old, active: event.target.checked }))} disabled={!payload.canEdit}/><span>Tarif actif</span></label>
          </div>
          <button className={styles.primary} disabled={!payload.canEdit || saving}>{saving ? "Enregistrement…" : form.id ? "Mettre à jour" : "Ajouter à la matrice"}</button>
        </form>
      </div>

      <article className={styles.tariffTableCard}>
        <div className={styles.tableHead}><div><small>RÉFÉRENTIEL TARIFAIRE</small><h3>{filteredTariffs.length} tarif{filteredTariffs.length > 1 ? "s" : ""}</h3></div><div className={styles.filters}><select value={filterCrvo} onChange={(event) => setFilterCrvo(event.target.value as Crvo | "ALL")}><option value="ALL">Tous les CRVO</option>{CRVOS.map((value) => <option key={value} value={value}>{CRVO_LABEL[value]}</option>)}</select><select value={filterCarrier} onChange={(event) => setFilterCarrier(event.target.value)}><option value="ALL">Toutes les sociétés</option>{carriers.map((value) => <option key={value} value={value}>{value}</option>)}</select><input placeholder="Rechercher PDV, CP…" value={filterText} onChange={(event) => setFilterText(event.target.value)}/></div></div>
        <div className={styles.tableWrap}><table><thead><tr><th>CRVO</th><th>PDV</th><th>Société</th><th>Sens</th><th>Scénario</th><th>€/VO</th><th>LT</th><th>Source</th><th>État</th>{payload.canEdit ? <th/> : null}</tr></thead><tbody>{filteredTariffs.map((row) => <tr key={row.id}><td>{row.crvo}</td><td><strong>{row.pdvName}</strong><small>{row.postalCode || "—"}</small></td><td>{row.carrier}<small>{row.carrierType === "INTERNAL" ? "Transphère" : "Partenaire"}</small></td><td>{DIRECTION_LABEL[row.direction]}</td><td>{SCENARIO_LABEL[row.scenario]}</td><td><strong>{euro(row.costPerVehicle)}</strong></td><td>{row.leadTimeDays == null ? "—" : `${numberLabel(row.leadTimeDays)} j`}</td><td><small>{row.sourceLabel || "—"}</small></td><td><span className={row.active ? styles.activePill : styles.inactivePill}>{row.active ? "Actif" : "Inactif"}</span></td>{payload.canEdit ? <td><div className={styles.rowActions}><button type="button" onClick={() => edit(row)}>Modifier</button><button type="button" onClick={() => void remove(row)} disabled={saving}>Supprimer</button></div></td> : null}</tr>)}</tbody></table></div>
      </article>
    </div> : null}
  </section>;
}
