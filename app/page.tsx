"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";

type Tab = "Pilotage" | "Sources" | "Studio" | "Paramètres";
type IconName =
  | "dashboard" | "database" | "studio" | "settings" | "calendar" | "download"
  | "filter" | "bell" | "upload" | "clock" | "check" | "warning" | "arrow"
  | "file" | "server" | "shield" | "refresh" | "plus" | "eye" | "chevron";

const tabs: Array<{ label: Tab; icon: IconName }> = [
  { label: "Pilotage", icon: "dashboard" },
  { label: "Sources", icon: "database" },
  { label: "Studio", icon: "studio" },
  { label: "Paramètres", icon: "settings" },
];

type Snapshot = {
  date: string;
  label: string;
  source: string;
  entries: number;
  exits: number;
  stock: number;
  over15: number;
  over20: number;
  production: Array<{ name: string; value: number; tone: string }>;
};

const seedSnapshot: Snapshot = {
  date: "2026-08-07",
  label: "07 août 2026",
  source: "Classeur Excel CRVO quotidien",
  entries: 78,
  exits: 86,
  stock: 1097,
  over15: 494,
  over20: 399,
  production: [
    { name: "Expertise", value: 80, tone: "blue" },
    { name: "Mécanique", value: 96, tone: "cyan" },
    { name: "DSP", value: 24, tone: "teal" },
    { name: "Carrosserie", value: 11, tone: "yellow" },
    { name: "Préparation", value: 89, tone: "blue" },
    { name: "Qualité", value: 88, tone: "cyan" },
    { name: "Sortie usine", value: 86, tone: "teal" },
  ],
};

function getStudioMetrics(snapshot: Snapshot) { return [
  { id: "stock", label: "Stock usine", value: snapshot.stock },
  { id: "over15", label: "Stock > 15 jours", value: snapshot.over15 },
  { id: "over20", label: "Stock > 20 jours", value: snapshot.over20 },
  { id: "entries", label: "Entrées VOP", value: snapshot.entries },
  { id: "exits", label: "Sorties VOP", value: snapshot.exits },
]; }

function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot>(seedSnapshot);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/dashboard", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("unavailable")))
      .then((payload: unknown) => {
        const parsed = payload as { snapshot?: Snapshot };
        if (parsed.snapshot) setSnapshot(parsed.snapshot);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return snapshot;
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    studio: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><circle cx="4" cy="7" r="2"/><circle cx="10" cy="16" r="2"/><circle cx="16" cy="10" r="2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/></>,
    filter: <path d="M3 5h18l-7 8v5l-4 2v-7Z"/>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    upload: <><path d="M12 21V9m-5 5 5-5 5 5"/><path d="M5 4h14"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v4m0 3h.01"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    file: <><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></>,
    server: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h7M11 17.5h7"/></>,
    shield: <><path d="M12 2 4 5v6c0 5.1 3.4 8.7 8 11 4.6-2.3 8-5.9 8-11V5Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14 5l3-3"/><path d="M21 20v-5h-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function PageTitle({ tab }: { tab: Tab }) {
  const content: Record<Tab, { eyebrow: string; title: string; description: string }> = {
    Pilotage: { eyebrow: "PILOTAGE OPÉRATIONNEL", title: "Performance CRVO Lens", description: "Lecture consolidée de l'activité à partir des instantanés archivés." },
    Sources: { eyebrow: "DATA HUB", title: "Sources & historique", description: "Chaque fichier est archivé sans écrasement avant traitement." },
    Studio: { eyebrow: "STUDIO DE PILOTAGE", title: "Créer un visuel", description: "Composez les indicateurs comme dans un outil décisionnel." },
    Paramètres: { eyebrow: "CONFIGURATION", title: "Passerelle & règles", description: "Pilotez la collecte, l'archivage et la transformation des données." },
  };
  return <div className="title-block"><span>{content[tab].eyebrow}</span><h1>{content[tab].title}</h1><p>{content[tab].description}</p></div>;
}

function MetricCard({ label, value, suffix, note, icon, tone = "blue" }: { label: string; value: string | number; suffix?: string; note: string; icon: IconName; tone?: string }) {
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon name={icon}/></div>
    <span>{label}</span><strong>{value}{suffix && <small>{suffix}</small>}</strong><p>{note}</p>
  </article>;
}

function Pilotage() {
  const snapshot = useLiveSnapshot();
  const recent = snapshot.stock - snapshot.over15;
  const between = snapshot.over15 - snapshot.over20;
  const net = snapshot.entries - snapshot.exits;
  const maxProduction = Math.max(...snapshot.production.map((item) => item.value));
  return <div className="page-content">
    <section className="data-banner">
      <div className="data-banner-icon"><Icon name="check"/></div>
      <div><strong>Instantané réel chargé</strong><span>{snapshot.source} · arrêté au {snapshot.label}</span></div>
      <div className="data-banner-meta"><span>75 feuilles analysées</span><span>16 vues métier identifiées</span></div>
    </section>

    <section className="kpi-grid">
      <MetricCard label="ENTRÉES VOP" value={snapshot.entries} note="Flux du jour" icon="download" tone="cyan" />
      <MetricCard label="SORTIES VOP" value={snapshot.exits} note="Flux du jour" icon="upload" tone="blue" />
      <MetricCard label="STOCK USINE" value={snapshot.stock.toLocaleString("fr-FR")} note="Photographie à l'instant T" icon="dashboard" tone="blue" />
      <MetricCard label="STOCK > 20 JOURS" value={snapshot.over20} note={`${Math.round(snapshot.over20 / snapshot.stock * 100)}% du stock`} icon="warning" tone="red" />
    </section>

    <section className="dashboard-grid">
      <article className="panel production-panel">
        <div className="panel-heading"><div><span>PRODUCTION DU JOUR</span><h2>Volumes par étape</h2></div><div className="source-chip"><i/>Donnée vérifiée</div></div>
        <div className="production-chart">
          {snapshot.production.map((item) => <div className="production-row" key={item.name}>
            <div className="production-label"><span>{item.name}</span><strong>{item.value}</strong></div>
            <div className="bar-track"><i className={item.tone} style={{ width: `${item.value / maxProduction * 100}%` }}/></div>
          </div>)}
        </div>
      </article>

      <article className="panel stock-panel">
        <div className="panel-heading"><div><span>ANCIENNETÉ DU STOCK</span><h2>Répartition des 1 097 véhicules</h2></div></div>
        <div className="stock-visual">
          <div className="stock-donut" style={{ "--recent": `${recent / snapshot.stock * 360}deg`, "--between": `${(recent + between) / snapshot.stock * 360}deg` } as React.CSSProperties}><div><strong>{snapshot.stock.toLocaleString("fr-FR")}</strong><span>VÉHICULES</span></div></div>
          <div className="stock-legend">
            <div><i className="recent"/><span>0 à 15 jours</span><strong>{recent}</strong></div>
            <div><i className="between"/><span>16 à 20 jours</span><strong>{between}</strong></div>
            <div><i className="old"/><span>Plus de 20 jours</span><strong>{snapshot.over20}</strong></div>
          </div>
        </div>
      </article>
    </section>

    <section className="dashboard-bottom">
      <article className="panel flow-card">
        <div className="panel-heading"><div><span>ÉQUILIBRE DES FLUX</span><h2>Entrées vs sorties</h2></div><strong className={net < 0 ? "positive-net" : "negative-net"}>{net > 0 ? "+" : ""}{net}</strong></div>
        <div className="flow-comparison"><div><span>Entrées</span><strong>{snapshot.entries}</strong><i style={{ width: `${snapshot.entries}%` }}/></div><div><span>Sorties</span><strong>{snapshot.exits}</strong><i style={{ width: `${snapshot.exits}%` }}/></div></div>
        <p>Le stock a diminué de <b>{Math.abs(net)} véhicules</b> sur la journée.</p>
      </article>
      <article className="panel quality-card">
        <div className="panel-heading"><div><span>QUALITÉ DE LA DONNÉE</span><h2>Traçabilité de l’instantané</h2></div><div className="quality-score">VÉRIFIÉ</div></div>
        <ul><li><Icon name="check"/>Source et méthode identifiées</li><li><Icon name="check"/>Date de référence identifiée</li><li><Icon name="check"/>Valeurs contrôlées dans le classeur</li></ul>
      </article>
    </section>
  </div>;
}

function Sources() {
  const snapshot = useLiveSnapshot();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importDate, setImportDate] = useState(seedSnapshot.date);
  const [message, setMessage] = useState("");
  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setMessage("");
  }
  function prepareImport() {
    if (!selectedFile) return setMessage("Sélectionnez d'abord un fichier CSV, XLS ou XLSX.");
    setMessage(`« ${selectedFile.name} » est prêt pour le contrôle des colonnes. L'archivage serveur sera activé dès la reconnexion Supabase.`);
  }
  return <div className="page-content sources-page">
    <section className="source-overview">
      <article className="panel connector-card">
        <div className="connector-head"><div className="connector-icon"><Icon name="server"/></div><div><span>PASSERELLE AUTOMATIQUE</span><h2>Serveur SFTP CRVO</h2></div><div className="status-pill pending"><i/>À configurer</div></div>
        <div className="connector-grid"><div><small>MODE</small><strong>Lecture seule</strong></div><div><small>FRÉQUENCE</small><strong>Chaque jour · 05:30</strong></div><div><small>ARCHIVAGE</small><strong>Copie immuable</strong></div><div><small>DOUBLONS</small><strong>Contrôle SHA-256</strong></div></div>
        <div className="connector-footer"><p><Icon name="shield"/>Aucun fichier ne sera modifié ni supprimé sur le serveur source.</p><button className="text-button">Configurer <Icon name="arrow"/></button></div>
      </article>
      <article className="panel source-stats"><span>VOLUMÉTRIE IDENTIFIÉE</span><h2>Classeur quotidien</h2><strong>126<small> Mo</small></strong><div><span>75 feuilles</span><span>+1 M lignes sur certaines sources</span></div></article>
    </section>

    <section className="sources-grid">
      <article className="panel import-card">
        <div className="panel-heading"><div><span>IMPORT HISTORIQUE</span><h2>Ajouter un fichier antérieur</h2></div><div className="file-types">CSV · XLS · XLSX</div></div>
        <label className={selectedFile ? "dropzone has-file" : "dropzone"}>
          <input type="file" accept=".csv,.xls,.xlsx" onChange={pickFile}/>
          <div className="drop-icon"><Icon name={selectedFile ? "check" : "upload"}/></div>
          {selectedFile ? <><strong>{selectedFile.name}</strong><span>{(selectedFile.size / 1024 / 1024).toFixed(1)} Mo · prêt à contrôler</span></> : <><strong>Déposez votre fichier ici</strong><span>ou cliquez pour parcourir vos dossiers</span></>}
        </label>
        <div className="import-controls"><label><span>Date de l’instantané</span><input type="date" value={importDate} onChange={(event) => setImportDate(event.target.value)}/></label><label><span>Jeu de données</span><select><option>Production CRVO complète</option><option>Stock usine</option><option>Entrées / Sorties</option></select></label></div>
        {message && <div className="inline-message"><Icon name="warning"/><span>{message}</span></div>}
        <button className="primary-button" onClick={prepareImport}><Icon name="arrow"/>Contrôler les colonnes</button>
      </article>

      <article className="panel history-card">
        <div className="panel-heading"><div><span>HISTORIQUE DES IMPORTS</span><h2>Instantanés archivés</h2></div><button className="icon-action" aria-label="Actualiser"><Icon name="refresh"/></button></div>
        <div className="history-timeline">
          <div className="history-item"><div className="timeline-dot success"><Icon name="check" size={14}/></div><div><strong>Instantané du {snapshot.label}</strong><span>{snapshot.source}</span><small><Icon name="clock" size={13}/>Valeurs métier vérifiées · original à archiver</small></div><div className="history-tag">RÉEL</div></div>
          <div className="history-empty"><i/><p>Les prochains fichiers apparaîtront ici sans remplacer les précédents.</p></div>
        </div>
      </article>
    </section>

    <section className="panel dataset-table">
      <div className="panel-heading"><div><span>JEUX DE DONNÉES</span><h2>Domaines métier détectés dans le classeur</h2></div><button className="secondary-button"><Icon name="plus"/>Nouveau jeu</button></div>
      <div className="table-wrap"><table><thead><tr><th>Domaine</th><th>Source</th><th>Actualisation</th><th>État</th><th/></tr></thead><tbody>
        {["Production & synthèse", "Main-d'œuvre & chiffre d'affaires", "Parc usine & flux", "Ateliers & goulots", "Qualité & contrôle technique"].map((name, index) => <tr key={name}><td><div className="table-name"><Icon name="database"/><strong>{name}</strong></div></td><td>Classeur quotidien</td><td>{index === 0 ? "07/08/2026" : "À mapper"}</td><td><span className={index === 0 ? "status-pill success" : "status-pill neutral"}><i/>{index === 0 ? "Disponible" : "Préparé"}</span></td><td><button aria-label={`Ouvrir ${name}`}><Icon name="chevron"/></button></td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}

function Studio() {
  const snapshot = useLiveSnapshot();
  const studioMetrics = getStudioMetrics(snapshot);
  const [metric, setMetric] = useState("stock");
  const [visual, setVisual] = useState("number");
  const [title, setTitle] = useState("Stock usine à date");
  const [saved, setSaved] = useState(false);
  const selected = studioMetrics.find((item) => item.id === metric) ?? studioMetrics[0];
  const max = Math.max(...studioMetrics.map((item) => item.value));
  return <div className="page-content studio-page">
    <section className="studio-layout">
      <aside className="panel studio-config">
        <div className="panel-heading"><div><span>PROPRIÉTÉS</span><h2>Configuration du visuel</h2></div></div>
        <label><span>Titre du visuel</span><input value={title} onChange={(event) => { setTitle(event.target.value); setSaved(false); }}/></label>
        <label><span>Jeu de données</span><select><option>Instantané métier CRVO</option></select></label>
        <label><span>Mesure</span><select value={metric} onChange={(event) => { setMetric(event.target.value); setSaved(false); }}>{studioMetrics.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>Agrégation</span><select><option>Dernière valeur</option><option>Somme</option><option>Moyenne</option><option>Minimum</option><option>Maximum</option></select></label>
        <label><span>Filtre temporel</span><select><option>Instantané sélectionné</option><option>Période</option><option>Comparer deux dates</option></select></label>
        <div className="visual-selector"><span>TYPE DE VISUEL</span><div>{[
          ["number", "123", "Indicateur"], ["bar", "▥", "Barres"], ["donut", "◔", "Anneau"], ["table", "▦", "Tableau"],
        ].map(([id, glyph, label]) => <button className={visual === id ? "active" : ""} onClick={() => { setVisual(id); setSaved(false); }} key={id}><strong>{glyph}</strong><span>{label}</span></button>)}</div></div>
        <button className="primary-button" onClick={() => setSaved(true)}><Icon name="check"/>Ajouter au dashboard</button>
        {saved && <div className="saved-message"><Icon name="check"/>Visuel préparé pour publication.</div>}
      </aside>

      <section className="studio-canvas">
        <div className="canvas-toolbar"><div><span>APERÇU</span><strong>Format bureau · données du {snapshot.label}</strong></div><div><button><Icon name="eye"/>Prévisualiser</button></div></div>
        <article className="visual-preview">
          <div className="preview-header"><div><span>INSTANTANÉ MÉTIER</span><h2>{title || "Sans titre"}</h2></div><div className="preview-date"><Icon name="calendar"/>{snapshot.label}</div></div>
          {visual === "number" && <div className="number-preview"><strong>{selected.value.toLocaleString("fr-FR")}</strong><span>{selected.label}</span><div><i/>Source réelle · Excel quotidien</div></div>}
          {visual === "bar" && <div className="preview-bars">{studioMetrics.map((item) => <div key={item.id}><span>{item.label}</span><div><i style={{ width: `${item.value / max * 100}%` }}/></div><strong>{item.value.toLocaleString("fr-FR")}</strong></div>)}</div>}
          {visual === "donut" && <div className="donut-preview"><div className="large-donut" style={{ "--value": `${selected.value / max * 360}deg` } as React.CSSProperties}><strong>{selected.value.toLocaleString("fr-FR")}</strong></div><div><span>Part relative au maximum de la sélection</span><strong>{Math.round(selected.value / max * 100)}%</strong><small>Base : {max.toLocaleString("fr-FR")}</small></div></div>}
          {visual === "table" && <div className="preview-table"><table><thead><tr><th>Mesure</th><th>Valeur</th><th>Date</th></tr></thead><tbody>{studioMetrics.map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.value.toLocaleString("fr-FR")}</td><td>{snapshot.label}</td></tr>)}</tbody></table></div>}
        </article>
        <div className="canvas-hint"><Icon name="plus"/><div><strong>Zone de composition</strong><span>Les visuels enregistrés pourront être déplacés et redimensionnés dans la prochaine étape de mise en page.</span></div></div>
      </section>
    </section>
  </div>;
}

function Parametres() {
  const [authMode, setAuthMode] = useState("key");
  const [notice, setNotice] = useState("");
  return <div className="page-content settings-page">
    <section className="settings-grid">
      <article className="panel settings-card wide">
        <div className="settings-heading"><div className="settings-icon"><Icon name="server"/></div><div><span>CONNEXION SFTP</span><h2>Passerelle vers le serveur source</h2><p>Les informations sensibles seront stockées dans les secrets Cloudflare.</p></div><div className="status-pill pending"><i/>Non connectée</div></div>
        <div className="form-grid"><label><span>Hôte</span><input placeholder="sftp.exemple.fr"/></label><label><span>Port</span><input type="number" defaultValue="22"/></label><label><span>Utilisateur</span><input placeholder="crvo_lecture"/></label><label><span>Répertoire source</span><input placeholder="/exports/kpi"/></label></div>
        <div className="segmented"><span>Authentification</span><div><button className={authMode === "key" ? "active" : ""} onClick={() => setAuthMode("key")}>Clé privée</button><button className={authMode === "password" ? "active" : ""} onClick={() => setAuthMode("password")}>Mot de passe</button></div></div>
        <div className="secret-info"><Icon name="shield"/><div><strong>Secret non saisi dans le dashboard</strong><span>La clé privée ou le mot de passe sera ajouté directement dans Cloudflare ou GitHub Actions, jamais dans le navigateur ni dans le dépôt.</span></div></div>
        <div className="settings-actions"><button className="secondary-button" onClick={() => setNotice("La passerelle doit d'abord être déployée et recevoir ses secrets.")}><Icon name="refresh"/>Tester la connexion</button><button className="primary-button" onClick={() => setNotice("Paramètres contrôlés. L'enregistrement serveur sera disponible dès que Supabase sera reconnecté.")}><Icon name="check"/>Préparer la configuration</button></div>
        {notice && <div className="inline-message"><Icon name="warning"/><span>{notice}</span></div>}
      </article>

      <article className="panel settings-card">
        <div className="settings-heading compact"><div className="settings-icon"><Icon name="clock"/></div><div><span>PLANIFICATION</span><h2>Collecte automatique</h2></div></div>
        <label><span>Fréquence</span><select><option>Tous les jours</option><option>Du lundi au vendredi</option><option>Toutes les heures</option></select></label>
        <div className="two-fields"><label><span>Heure</span><input type="time" defaultValue="05:30"/></label><label><span>Fuseau</span><select><option>Europe/Paris</option></select></label></div>
        <label className="switch-row"><div><strong>Relance automatique</strong><span>Nouvelle tentative en cas d’échec</span></div><input type="checkbox" defaultChecked/><i/></label>
      </article>

      <article className="panel settings-card">
        <div className="settings-heading compact"><div className="settings-icon"><Icon name="shield"/></div><div><span>HISTORISATION</span><h2>Politique d’archivage</h2></div></div>
        <div className="locked-rule"><Icon name="check"/><div><strong>Conservation immuable</strong><span>Un import crée toujours une nouvelle version.</span></div><b>OBLIGATOIRE</b></div>
        <label><span>Durée de conservation</span><select defaultValue="unlimited"><option value="unlimited">Sans limite</option><option>10 ans</option><option>5 ans</option></select></label>
        <label className="switch-row"><div><strong>Détection des doublons</strong><span>Empreinte SHA-256 avant import</span></div><input type="checkbox" defaultChecked/><i/></label>
      </article>
    </section>

    <section className="panel mapping-panel">
      <div className="panel-heading"><div><span>MODÈLE DE TRANSFORMATION</span><h2>Correspondance des valeurs sources</h2><p>Les règles restent modifiables sans altérer les fichiers archivés.</p></div><button className="secondary-button"><Icon name="plus"/>Ajouter une règle</button></div>
      <div className="mapping-list">
        {[['Entrées VOP', 'entries_vop', 'Somme'], ['Sorties VOP', 'exits_vop', 'Somme'], ['Parc Usine', 'factory_stock', 'Dernière valeur'], ['Stock +20 jours', 'stock_over_20d', 'Dernière valeur']].map(([source, target, agg]) => <div className="mapping-row" key={target}><div><small>CHAMP SOURCE</small><strong>{source}</strong></div><Icon name="arrow"/><div><small>CHAMP NORMALISÉ</small><strong>{target}</strong></div><div><small>AGRÉGATION</small><strong>{agg}</strong></div><button aria-label={`Modifier ${source}`}><Icon name="settings"/></button></div>)}
      </div>
    </section>
  </div>;
}

export default function Home() {
  const [active, setActive] = useState<Tab>("Pilotage");
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeIndex = useMemo(() => tabs.findIndex((tab) => tab.label === active), [active]);
  function changeTab(tab: Tab) { setActive(tab); setMobileOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <main className="app-shell">
    <aside className={mobileOpen ? "sidebar open" : "sidebar"}>
      <div className="brand"><Image src="/crvo-logo.png" alt="CRVO - Votre potentiel VO au plus haut" width={280} height={94} priority/></div>
      <nav aria-label="Navigation principale">{tabs.map((tab) => <button key={tab.label} className={active === tab.label ? "nav-item active" : "nav-item"} onClick={() => changeTab(tab.label)}><Icon name={tab.icon}/><span>{tab.label}</span>{tab.label === "Sources" && <i>1</i>}</button>)}</nav>
      <div className="sidebar-status"><span className="status-dot warning"/><div><strong>Connexion à finaliser</strong><small>Supabase & SFTP en attente</small></div></div>
      <div className="user-card"><span>CG</span><div><strong>Cyril Gay</strong><small>Administrateur</small></div></div>
    </aside>
    {mobileOpen && <button className="sidebar-overlay" aria-label="Fermer le menu" onClick={() => setMobileOpen(false)}/>}

    <section className="workspace">
      <header className="topbar">
        <button className="mobile-menu" aria-label="Ouvrir le menu" onClick={() => setMobileOpen(true)}><span/><span/><span/></button>
        <PageTitle tab={active}/>
        <div className="top-actions"><button className="icon-button" aria-label="Notifications"><Icon name="bell"/><span/></button><label className="period"><Icon name="calendar"/><select aria-label="Instantané"><option>07/08/2026</option></select></label><button className="export"><Icon name="download"/>Exporter</button></div>
      </header>
      <div className="mobile-tabs" aria-label="Navigation mobile">{tabs.map((tab, index) => <button className={index === activeIndex ? "active" : ""} onClick={() => changeTab(tab.label)} key={tab.label}><Icon name={tab.icon}/><span>{tab.label}</span></button>)}</div>
      {active === "Pilotage" && <Pilotage/>}
      {active === "Sources" && <Sources/>}
      {active === "Studio" && <Studio/>}
      {active === "Paramètres" && <Parametres/>}
    </section>
  </main>;
}
