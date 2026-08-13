"use client";

import { useEffect, useMemo, useState } from "react";
import "./clients.css";

type ClientSummary = {
  client: string;
  vehicle_count: number | string;
  expertise_count: number | string;
  chiffrage_count: number | string;
  controle_technique_count: number | string;
  dsp_count: number | string;
  jantes_count: number | string;
  mecanique_count: number | string;
  carrosserie_count: number | string;
  preparation_count: number | string;
  qualite_count: number | string;
  sortie_usine_count: number | string;
  age_0_15: number | string;
  age_16_20: number | string;
  age_21_30: number | string;
  age_31_plus: number | string;
  source_modified_at: string | null;
  snapshot_at: string | null;
};

type Vehicle = {
  registration: string | null;
  work_order: string | null;
  vin: string | null;
  model: string | null;
  mileage: number | string | null;
  status: string | null;
  status_age_days: number | string | null;
  factory_age_days: number | string | null;
  alert: string | null;
  urgency: string | null;
  pending_expertise: boolean;
  pending_chiffrage: boolean;
  pending_controle_technique: boolean;
  pending_dsp: boolean;
  pending_jantes: boolean;
  pending_mecanique: boolean;
  pending_carrosserie: boolean;
  pending_preparation: boolean;
  pending_qualite: boolean;
  pending_sortie_usine: boolean;
};

type ListPayload = { connected: boolean; clients: ClientSummary[]; totalClients: number; totalVehicles: number; sourceModifiedAt: string | null };
type DetailPayload = { connected: boolean; client: string; summary: ClientSummary; vehicles: Vehicle[]; timeReady: boolean; timeMessage: string; sourceModifiedAt: string | null; snapshotAt: string | null };

const sectors = [
  ["expertise_count", "Expertise", "pending_expertise"],
  ["chiffrage_count", "Chiffrage", "pending_chiffrage"],
  ["controle_technique_count", "Contrôle technique", "pending_controle_technique"],
  ["dsp_count", "DSP", "pending_dsp"],
  ["jantes_count", "Jantes", "pending_jantes"],
  ["mecanique_count", "Mécanique", "pending_mecanique"],
  ["carrosserie_count", "Carrosserie", "pending_carrosserie"],
  ["preparation_count", "Préparation", "pending_preparation"],
  ["qualite_count", "Qualité", "pending_qualite"],
  ["sortie_usine_count", "Sortie usine", "pending_sortie_usine"],
] as const;

function n(value: unknown) { const valueNumber = Number(value); return Number.isFinite(valueNumber) ? valueNumber : 0; }
function age(value: unknown) { const number = Number(value); return Number.isFinite(number) ? `${number.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} j` : "—"; }
function km(value: unknown) { const number = Number(value); return Number.isFinite(number) ? `${Math.round(number).toLocaleString("fr-FR")} km` : "—"; }
function timeParis(value: string | null) { if (!value) return "—"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "—"; return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Europe/Paris" }).format(date); }

function csvCell(value: unknown) { const text = String(value ?? "").replaceAll('"','""'); return `"${text}"`; }

export default function ClientsPage() {
  const [list, setList] = useState<ListPayload | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadList() {
    try {
      const response = await fetch(`/api/clients?_=${Date.now()}`, { cache:"no-store" });
      const payload = await response.json() as ListPayload & { error?:string };
      if (!response.ok) throw new Error(payload.error || "Liste clients indisponible");
      setList(payload);
      setSelected((current) => current || payload.clients[0]?.client || "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger les clients"); }
  }

  async function loadDetail(client: string) {
    if (!client) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/clients?client=${encodeURIComponent(client)}&_=${Date.now()}`, { cache:"no-store" });
      const payload = await response.json() as DetailPayload & { error?:string };
      if (!response.ok) throw new Error(payload.error || "Dashboard client indisponible");
      setDetail(payload);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Impossible de charger ce client"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadList(); const timer = window.setInterval(() => void loadList(), 300000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!selected) return; void loadDetail(selected); const timer = window.setInterval(() => void loadDetail(selected), 60000); return () => window.clearInterval(timer); }, [selected]);

  const filteredClients = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("fr");
    return (list?.clients ?? []).filter((item) => !needle || item.client.toLocaleLowerCase("fr").includes(needle));
  }, [list, search]);

  function exportCsv() {
    if (!detail) return;
    const headers = ["Client","Immatriculation","OR","VIN","Modèle","Kilométrage","Statut","Ancienneté usine","Ancienneté statut","À faire","Alerte","Heures restantes","MO restante"];
    const lines = detail.vehicles.map((vehicle) => {
      const remaining = sectors.filter(([, , flag]) => Boolean(vehicle[flag])).map(([, label]) => label).join(" | ");
      return [detail.client,vehicle.registration,vehicle.work_order,vehicle.vin,vehicle.model,vehicle.mileage,vehicle.status,vehicle.factory_age_days,vehicle.status_age_days,remaining,vehicle.alert,"À venir","À venir"].map(csvCell).join(";");
    });
    const blob = new Blob(["\ufeff" + [headers.map(csvCell).join(";"), ...lines].join("\n")], { type:"text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CRVO_Parc_${detail.client.replace(/[^a-z0-9]+/gi,"_")}_${String(detail.snapshotAt ?? "J")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const summary = detail?.summary;
  const total = n(summary?.vehicle_count);

  return <main className="client-page">
    <header className="client-header">
      <div><a href="/" className="client-back">← REPORTING CRVO</a><span>PARC CLIENT · ETATDUPARC FTP</span><h1>Dashboard client</h1><p>Une lecture exploitable du parc en cours : volume, vieillissement, travaux restant à réaliser et détail véhicule par véhicule.</p></div>
      <div className="client-live"><span>DERNIÈRE PHOTO FTP</span><strong>{timeParis(detail?.sourceModifiedAt ?? list?.sourceModifiedAt ?? null)}</strong><small>Actualisation écran : 60 s · données source FTP</small></div>
    </header>

    <section className="client-toolbar no-print">
      <div className="client-search"><label>RECHERCHER UN CLIENT</label><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Nom du client…" /></div>
      <div className="client-select"><label>CLIENT SÉLECTIONNÉ</label><select value={selected} onChange={(event)=>setSelected(event.target.value)}>{filteredClients.map((client)=><option key={client.client} value={client.client}>{client.client} · {client.vehicle_count} véhicules</option>)}</select></div>
      <button onClick={()=>window.print()}>EXPORTER PDF</button><button onClick={exportCsv}>EXPORTER CSV</button>
    </section>

    {error && <div className="client-error">{error}</div>}
    {loading && !detail && <div className="client-loading">Préparation du dashboard client…</div>}

    {detail && summary && <>
      <section className="client-title"><div><span>CLIENT</span><h2>{detail.client}</h2></div><div><span>PHOTO DU PARC</span><strong>{detail.snapshotAt || "—"}</strong></div><div><span>VÉHICULES EN COURS</span><strong>{total}</strong></div></section>

      <section className="client-kpis">
        <article className="client-total"><span>PARC EN COURS</span><strong>{total}</strong><small>véhicules actuellement dans le périmètre usine</small></article>
        <article><span>0–15 JOURS</span><strong>{n(summary.age_0_15)}</strong><small>{total ? Math.round(n(summary.age_0_15)/total*100) : 0}% du parc</small></article>
        <article><span>16–20 JOURS</span><strong>{n(summary.age_16_20)}</strong><small>{total ? Math.round(n(summary.age_16_20)/total*100) : 0}% du parc</small></article>
        <article className="client-watch"><span>21–30 JOURS</span><strong>{n(summary.age_21_30)}</strong><small>{total ? Math.round(n(summary.age_21_30)/total*100) : 0}% du parc</small></article>
        <article className="client-risk"><span>31 JOURS ET +</span><strong>{n(summary.age_31_plus)}</strong><small>{total ? Math.round(n(summary.age_31_plus)/total*100) : 0}% du parc</small></article>
      </section>

      <section className="client-section">
        <div className="client-section-head"><div><span>TRAVAUX RESTANT À RÉALISER</span><h3>Charge restante par activité</h3></div><p>Un même véhicule peut apparaître dans plusieurs activités lorsque le champ <b>Alerte</b> indique plusieurs passages restant à effectuer.</p></div>
        <div className="client-sector-grid">{sectors.map(([key,label]) => <article key={key}><span>{label}</span><strong>{n(summary[key])}</strong><small>véhicule{n(summary[key])>1?"s":""} restant{n(summary[key])>1?"s":""}</small></article>)}</div>
      </section>

      <section className="client-future">
        <div><span>CAPACITÉ FUTURE DÉJÀ PRÉVUE</span><h3>Heures & main-d’œuvre restantes</h3><p>{detail.timeMessage}</p></div><div><span>HEURES RESTANTES</span><strong>À VENIR</strong></div><div><span>MO RESTANTE</span><strong>À VENIR</strong></div>
      </section>

      <section className="client-section client-vehicles">
        <div className="client-section-head"><div><span>DÉTAIL DU PARC</span><h3>{detail.vehicles.length} véhicules en cours</h3></div><p>Tri par ancienneté usine décroissante. Les informations sont issues de la dernière photo EtatduParc.</p></div>
        <div className="client-table-wrap"><table><thead><tr><th>Véhicule</th><th>OR</th><th>Modèle</th><th>Km</th><th>Statut actuel</th><th>Âge usine</th><th>À faire</th><th>Alerte</th><th>Heures</th></tr></thead><tbody>{detail.vehicles.map((vehicle,index)=>{
          const remaining=sectors.filter(([, , flag])=>Boolean(vehicle[flag])).map(([,label])=>label);
          return <tr key={`${vehicle.registration}-${vehicle.work_order}-${index}`}><td><strong>{vehicle.registration || "—"}</strong><small>{vehicle.vin || ""}</small></td><td>{vehicle.work_order || "—"}</td><td>{vehicle.model || "—"}</td><td>{km(vehicle.mileage)}</td><td>{vehicle.status || "—"}</td><td><strong>{age(vehicle.factory_age_days ?? vehicle.status_age_days)}</strong></td><td><div className="client-pills">{remaining.length?remaining.map((label)=><span key={label}>{label}</span>):<em>—</em>}</div></td><td>{vehicle.alert || "—"}{/^oui$/i.test(vehicle.urgency || "") && <b className="client-urgent">URGENT</b>}</td><td className="client-pending">À venir</td></tr>;
        })}</tbody></table></div>
      </section>

      <footer className="client-report-footer"><span>CRVO Lens · Dashboard parc client</span><span>{detail.client}</span><span>Données FTP au {timeParis(detail.sourceModifiedAt)}</span></footer>
    </>}
  </main>;
}
