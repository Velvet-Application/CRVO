"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./client-portal.module.css";

type ClientOption = { client: string; vehicleCount: number; updatedAt: string | null };
type Vehicle = {
  client: string;
  registration: string;
  vin: string | null;
  model: string | null;
  mileage: number | null;
  status: string | null;
  statusAgeDays: number | null;
  factoryAgeDays: number | null;
  alert: string | null;
  updatedAt: string | null;
};
type Metrics = {
  leadTimeTransportDays?: number | null;
  leadTimeFactoryDays?: number | null;
  leadTimeReturnDays?: number | null;
  freAverage?: number | null;
  timeAverageHours?: number | null;
  workloadMatchedVehicles?: number | null;
  openClaims?: number | null;
  claims30d?: number | null;
};
type Claim = {
  id: string;
  claimNumber: string;
  registration: string;
  category: string;
  description: string;
  status: string;
  decision?: string | null;
  committeeResponse?: string | null;
  requestedInfo?: string | null;
  declaredAt: string;
  updatedAt: string;
};
type PortalPayload = {
  found: boolean;
  client?: string;
  clients: ClientOption[];
  summary?: { client: string; vehicleCount: number; updatedAt: string | null; snapshotAt: string | null };
  metrics?: Metrics;
  vehicles?: Vehicle[];
  claims?: Claim[];
  isClientAdmin?: boolean;
};
type Tab = "overview" | "vehicles" | "claims";

type Stage = { label: string; progress: number; detail: string };

function n(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function one(value: unknown, suffix = "") {
  if (value == null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${suffix}` : "—";
}
function euro(value: unknown) {
  if (value == null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(number) : "—";
}
function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parsed);
}
function stage(status: string | null | undefined): Stage {
  const value = String(status ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/sortie|pret|expedi|retour/.test(value)) return { label: "Prêt au retour", progress: 94, detail: "Le véhicule arrive au terme de son parcours CRVO." };
  if (/qualite|photo|preparation|controle final/.test(value)) return { label: "Contrôle final", progress: 82, detail: "Les dernières vérifications sont en cours." };
  if (/carrosserie|mecanique|jante|dsp|technique|atelier|travaux/.test(value)) return { label: "Reconditionnement", progress: 60, detail: "Le véhicule est pris en charge par nos ateliers." };
  if (/expertise|lavage|chiffrage|reception|recu/.test(value)) return { label: "Prise en charge", progress: 34, detail: "Le véhicule est en phase de diagnostic et de préparation des travaux." };
  return { label: "Reconditionnement", progress: 52, detail: "Le véhicule poursuit son parcours de reconditionnement." };
}
function claimStatus(value: string) {
  const map: Record<string, string> = {
    RECEIVED: "Reçue",
    ANALYSIS: "En analyse",
    COMMITTEE: "En comité",
    ACCEPTED: "Acceptée",
    REFUSED: "Refusée",
    CLOSED: "Clôturée",
  };
  return map[value] ?? value;
}
function shortVin(vin: string | null) {
  if (!vin) return "VIN non renseigné";
  return `VIN ···${vin.slice(-6)}`;
}
async function fileData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

export default function ClientPortalPage() {
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [selectedClient, setSelectedClient] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimSaving, setClaimSaving] = useState(false);
  const [claimRegistration, setClaimRegistration] = useState("");
  const [claimCategory, setClaimCategory] = useState("Carrosserie");
  const [claimDescription, setClaimDescription] = useState("");
  const [claimReturnedAt, setClaimReturnedAt] = useState("");
  const [claimFiles, setClaimFiles] = useState<File[]>([]);
  const [claimError, setClaimError] = useState("");
  const [claimSuccess, setClaimSuccess] = useState("");

  async function load(client?: string) {
    setLoading(true);
    setError("");
    try {
      const query = client ? `?client=${encodeURIComponent(client)}&_=${Date.now()}` : `?_=${Date.now()}`;
      const response = await fetch(`/api/client-portal${query}`, { cache: "no-store" });
      if (response.status === 401) {
        location.replace(`/login?next=${encodeURIComponent("/espace-client")}`);
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Données indisponibles.");
      setPayload(data as PortalPayload);
      setSelectedClient(String(data.client ?? client ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Données indisponibles.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const vehicles = payload?.vehicles ?? [];
  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("fr");
    if (!q) return vehicles;
    return vehicles.filter((vehicle) => [vehicle.registration, vehicle.vin, vehicle.model].some((value) => String(value ?? "").toLocaleLowerCase("fr").includes(q)));
  }, [search, vehicles]);
  const metrics = payload?.metrics ?? {};
  const claims = payload?.claims ?? [];

  function openClaim(registration = "") {
    setClaimRegistration(registration);
    setClaimCategory("Carrosserie");
    setClaimDescription("");
    setClaimReturnedAt("");
    setClaimFiles([]);
    setClaimError("");
    setClaimSuccess("");
    setClaimOpen(true);
  }

  async function submitClaim(event: FormEvent) {
    event.preventDefault();
    if (!selectedClient || !claimRegistration.trim() || claimDescription.trim().length < 8) {
      setClaimError("Renseigne le véhicule et décris le problème en quelques mots.");
      return;
    }
    setClaimSaving(true);
    setClaimError("");
    setClaimSuccess("");
    try {
      const response = await fetch("/api/client-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createClaim",
          client: selectedClient,
          registration: claimRegistration,
          category: claimCategory,
          description: claimDescription,
          returnedAt: claimReturnedAt || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Déclaration impossible.");
      const claimId = String(data.claim?.id ?? "");
      const claimNumber = String(data.claim?.claimNumber ?? "");
      for (const file of claimFiles) {
        if (file.size > 6 * 1024 * 1024) throw new Error(`${file.name} dépasse 6 Mo.`);
        const mime = file.type || "application/octet-stream";
        if (!(mime.startsWith("image/") || mime === "application/pdf")) throw new Error(`${file.name} : format non autorisé.`);
        const attachmentResponse = await fetch("/api/client-portal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "addAttachment",
            claimId,
            attachment: {
              fileName: file.name,
              mimeType: mime,
              sizeBytes: file.size,
              kind: mime === "application/pdf" ? "QUOTE" : "PHOTO",
              fileData: await fileData(file),
            },
          }),
        });
        const attachmentData = await attachmentResponse.json().catch(() => ({}));
        if (!attachmentResponse.ok) throw new Error(attachmentData.error || `Impossible d’ajouter ${file.name}.`);
      }
      setClaimSuccess(`Demande ${claimNumber || "enregistrée"} transmise au CRVO.`);
      await load(selectedClient);
      window.setTimeout(() => setClaimOpen(false), 1400);
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : "Déclaration impossible.");
    } finally {
      setClaimSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    location.href = "/login";
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>CRVO</span>
        <div><strong>Espace concession</strong><small>CRVO Lens · suivi de vos véhicules</small></div>
      </div>
      <button className={styles.logout} type="button" onClick={() => void logout()} aria-label="Se déconnecter">Déconnexion</button>
    </header>

    <section className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>{payload?.isClientAdmin ? "MODE DÉMO · TOUTES CONCESSIONS" : "VOTRE CONCESSION"}</span>
        <h1>{selectedClient || "Espace client CRVO"}</h1>
        <p>Les informations essentielles pour suivre vos véhicules, sans jargon atelier.</p>
      </div>
      {(payload?.clients?.length ?? 0) > 1 && <label className={styles.clientPicker}>
        <span>Concession affichée</span>
        <select value={selectedClient} onChange={(event) => { const value = event.target.value; setSelectedClient(value); void load(value); }}>
          {(payload?.clients ?? []).map((client) => <option key={client.client} value={client.client}>{client.client} · {client.vehicleCount} VO</option>)}
        </select>
      </label>}
    </section>

    <nav className={styles.tabs} aria-label="Navigation espace concession">
      <button className={tab === "overview" ? styles.active : ""} onClick={() => setTab("overview")}>Synthèse</button>
      <button className={tab === "vehicles" ? styles.active : ""} onClick={() => setTab("vehicles")}>Mes véhicules <b>{vehicles.length}</b></button>
      <button className={tab === "claims" ? styles.active : ""} onClick={() => setTab("claims")}>Réclamations {n(metrics.openClaims) > 0 && <b>{n(metrics.openClaims)}</b>}</button>
    </nav>

    {error && <div className={styles.error}>{error}<button onClick={() => void load(selectedClient)}>Réessayer</button></div>}
    {loading && !payload && <div className={styles.loading}>Mise à jour de votre espace…</div>}

    {payload && tab === "overview" && <>
      <section className={styles.kpis}>
        <article className={styles.primaryKpi}><span>Véhicules en cours</span><strong>{n(payload.summary?.vehicleCount)}</strong><small>actuellement au CRVO</small></article>
        <article><span>LT transport</span><strong>{one(metrics.leadTimeTransportDays, " j")}</strong><small>moyenne vers le CRVO</small></article>
        <article><span>LT usine</span><strong>{one(metrics.leadTimeFactoryDays, " j")}</strong><small>moyenne de reconditionnement</small></article>
        <article><span>FRE moyen</span><strong>{euro(metrics.freAverage)}</strong><small>sur l’encours rapproché</small></article>
        <article><span>Réclamations ouvertes</span><strong>{n(metrics.openClaims)}</strong><small>{n(metrics.claims30d)} sur les 30 derniers jours</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><span>VOS VÉHICULES</span><h2>À suivre aujourd’hui</h2></div><button onClick={() => setTab("vehicles")}>Voir tout</button></div>
        <div className={styles.vehiclePreview}>
          {vehicles.slice(0, 4).map((vehicle) => <VehicleCard key={`${vehicle.client}-${vehicle.registration}`} vehicle={vehicle} onClaim={() => openClaim(vehicle.registration)} compact />)}
          {!vehicles.length && <p className={styles.empty}>Aucun véhicule en cours pour cette concession.</p>}
        </div>
      </section>

      <section className={styles.infoStrip}>
        <div><span>Temps moyen restant</span><strong>{one(metrics.timeAverageHours, " h")}</strong></div>
        <div><span>LT retour</span><strong>{one(metrics.leadTimeReturnDays, " j")}</strong></div>
        <div><span>Dernière actualisation</span><strong>{date(payload.summary?.updatedAt)}</strong></div>
      </section>

      <button className={styles.claimCta} onClick={() => openClaim()}><span>Un problème au retour ?</span><strong>Déclarer une réclamation</strong><i>→</i></button>
    </>}

    {payload && tab === "vehicles" && <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>PARC EN COURS</span><h2>{filteredVehicles.length} véhicule{filteredVehicles.length > 1 ? "s" : ""}</h2></div></div>
      <div className={styles.search}><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Immatriculation, VIN ou modèle…" autoComplete="off" /></div>
      <div className={styles.vehicleList}>{filteredVehicles.map((vehicle) => <VehicleCard key={`${vehicle.client}-${vehicle.registration}`} vehicle={vehicle} onClaim={() => openClaim(vehicle.registration)} />)}</div>
      {!filteredVehicles.length && <p className={styles.empty}>Aucun véhicule ne correspond à cette recherche.</p>}
    </section>}

    {payload && tab === "claims" && <section className={styles.panel}>
      <div className={styles.panelHead}><div><span>SUIVI QUALITÉ</span><h2>Vos réclamations</h2></div><button className={styles.solidButton} onClick={() => openClaim()}>+ Déclarer</button></div>
      <div className={styles.claimList}>
        {claims.map((claim) => <article className={styles.claimCard} key={claim.id}>
          <div><span>{claim.claimNumber}</span><strong>{claim.registration}</strong><small>{claim.category} · déclarée le {date(claim.declaredAt)}</small></div>
          <em data-status={claim.status}>{claimStatus(claim.status)}</em>
          <p>{claim.description}</p>
          {claim.requestedInfo && <aside><strong>Complément demandé</strong>{claim.requestedInfo}</aside>}
          {claim.committeeResponse && <aside><strong>Réponse du CRVO</strong>{claim.committeeResponse}</aside>}
        </article>)}
        {!claims.length && <p className={styles.empty}>Aucune réclamation enregistrée pour cette concession.</p>}
      </div>
    </section>}

    {claimOpen && <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !claimSaving) setClaimOpen(false); }}>
      <form className={styles.claimSheet} onSubmit={submitClaim}>
        <div className={styles.sheetHandle} />
        <div className={styles.sheetHead}><div><span>RÉCLAMATION QUALITÉ</span><h2>Signaler un problème au retour</h2><p>Le CRVO retrouvera automatiquement le dossier véhicule associé.</p></div><button type="button" onClick={() => !claimSaving && setClaimOpen(false)} aria-label="Fermer">×</button></div>
        <label><span>Immatriculation</span><input value={claimRegistration} onChange={(event) => setClaimRegistration(event.target.value.toUpperCase())} list="client-vehicle-registrations" placeholder="AB-123-CD" required /></label>
        <datalist id="client-vehicle-registrations">{vehicles.map((vehicle) => <option key={vehicle.registration} value={vehicle.registration}>{vehicle.model}</option>)}</datalist>
        <div className={styles.formGrid}>
          <label><span>Type de problème</span><select value={claimCategory} onChange={(event) => setClaimCategory(event.target.value)}><option>Carrosserie</option><option>Mécanique</option><option>Propreté</option><option>Équipement manquant</option><option>Administratif</option><option>Transport</option><option>Autre</option></select></label>
          <label><span>Date de retour</span><input type="date" value={claimReturnedAt} onChange={(event) => setClaimReturnedAt(event.target.value)} /></label>
        </div>
        <label><span>Décris le problème</span><textarea value={claimDescription} onChange={(event) => setClaimDescription(event.target.value)} rows={5} placeholder="Ce que vous avez constaté, où se situe le défaut et toute information utile…" required /></label>
        <label className={styles.fileField}><span>Photos / devis</span><input type="file" accept="image/*,application/pdf" multiple onChange={(event) => setClaimFiles(Array.from(event.target.files ?? []).slice(0, 8))} /><small>Images ou PDF · 6 Mo maximum par fichier · jusqu’à 8 pièces jointes</small></label>
        {claimFiles.length > 0 && <div className={styles.fileList}>{claimFiles.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>)}</div>}
        {claimError && <div className={styles.formError}>{claimError}</div>}
        {claimSuccess && <div className={styles.formSuccess}>{claimSuccess}</div>}
        <button className={styles.submitButton} disabled={claimSaving}>{claimSaving ? "Transmission au CRVO…" : "Envoyer la réclamation"}</button>
      </form>
    </div>}
  </main>;
}

function VehicleCard({ vehicle, onClaim, compact = false }: { vehicle: Vehicle; onClaim: () => void; compact?: boolean }) {
  const state = stage(vehicle.status);
  return <article className={`${styles.vehicleCard} ${compact ? styles.compactVehicle : ""}`}>
    <div className={styles.vehicleTop}><div><span>{vehicle.registration}</span><strong>{vehicle.model || "Véhicule"}</strong><small>{shortVin(vehicle.vin)}</small></div><em>{state.label}</em></div>
    <div className={styles.progress}><i style={{ width: `${state.progress}%` }} /></div>
    <p>{state.detail}</p>
    <div className={styles.vehicleMeta}><span>Au CRVO <strong>{one(vehicle.factoryAgeDays, " j")}</strong></span>{vehicle.alert && <span className={styles.vehicleAlert}>Suivi renforcé</span>}</div>
    {!compact && <button type="button" onClick={onClaim}>Signaler un problème sur ce véhicule</button>}
  </article>;
}
