"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./maintenance.module.css";

type TargetStatus = "green" | "amber" | "red" | "unknown";
type Target = {
  key: string; label: string; category: string; type: string; status: TargetStatus; ageMinutes?: number | null;
  lastActivityAt?: string | null; capabilities?: string[]; guardianConfigured?: boolean; heartbeatAt?: string | null;
  appVersion?: string | null; autoRepairEnabled?: boolean; metadata?: Record<string, unknown>;
};
type Probe = { key: string; label: string; ok: boolean; status: number; durationMs: number; error?: string };
type Command = { id: string; target_key: string; action: string; status: string; requested_at: string; started_at?: string | null; finished_at?: string | null; error?: string | null };
type EventRow = { id: number; target_key?: string | null; event_type: string; severity: string; message: string; created_at: string; actor_name?: string | null };
type Overview = { ok?: boolean; generatedAt?: string; checkedAt?: string; targets?: Target[]; probes?: Probe[]; commands?: Command[]; events?: EventRow[]; health?: Record<string, unknown>; error?: string };
type TokenPayload = { ok?: boolean; token?: string; targetKey?: string; error?: string };

type ActionDef = { label: string; level: "green" | "amber" | "red"; description: string };
const ACTIONS: Record<string, ActionDef> = {
  test_service: { label: "Tester", level: "green", description: "Lance un diagnostic sans modifier le système." },
  test_api: { label: "Tester API", level: "green", description: "Contrôle la route en production." },
  test_ftp: { label: "Tester FTP", level: "green", description: "Contrôle le FTP via le runner sécurisé." },
  refresh_ftp: { label: "Forcer synchro FTP", level: "green", description: "Relance une récupération FTP complète." },
  refresh_factory: { label: "Relancer Factory", level: "green", description: "Relance le chemin rapide Factory." },
  refresh_all_feeds: { label: "Relancer les flux", level: "amber", description: "Relance tous les flux FTP et recalcule les données dépendantes." },
  restart_bridge: { label: "Relancer Bridge", level: "amber", description: "Force un nouveau cycle complet du bridge." },
  rebuild_kpi: { label: "Reconstruire KPI", level: "amber", description: "Rejoue les alimentations et reconstruit les indicateurs dépendants." },
  reload_page: { label: "Recharger écran", level: "green", description: "Demande à l’écran de recharger la page." },
  clear_cache: { label: "Reset cache", level: "amber", description: "Vide le cache PWA de l’écran puis recharge." },
  restart_browser: { label: "Redémarrer navigateur", level: "amber", description: "Nécessite le Guardian natif sur le poste." },
  restart_guardian: { label: "Relancer Guardian", level: "amber", description: "Redémarre le service Guardian du poste." },
  reboot_device: { label: "Redémarrer poste", level: "red", description: "Redémarre physiquement le poste. Guardian natif requis." },
};

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value); if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
function ageLabel(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value); if (n < 1) return "< 1 min"; if (n < 60) return `${Math.round(n)} min`;
  return `${Math.floor(n / 60)} h ${String(Math.round(n % 60)).padStart(2, "0")}`;
}
function statusLabel(value: TargetStatus) { return value === "green" ? "OPÉRATIONNEL" : value === "amber" ? "VIGILANCE" : value === "red" ? "INCIDENT" : "À CONTRÔLER"; }

async function readOverview(log = false) {
  const response = await fetch(`/api/maintenance${log ? "?log=1" : ""}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Maintenance ${response.status}`);
  return payload as Overview;
}

export default function MaintenanceClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [guardian, setGuardian] = useState<{ targetKey: string; token: string; url: string } | null>(null);

  async function refresh(log = false) {
    try { setError(""); setData(await readOverview(log)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Diagnostic impossible."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 15000); return () => window.clearInterval(timer); }, []);

  const probeMap = useMemo(() => new Map((data?.probes ?? []).map(item => [item.key, item])), [data]);
  const targets = useMemo(() => (data?.targets ?? []).map(target => {
    const probe = probeMap.get(target.key);
    if (!probe || target.type === "screen") return target;
    if (target.key.startsWith("api.")) return { ...target, status: probe.ok ? "green" as const : "red" as const, ageMinutes: null };
    return target;
  }), [data, probeMap]);
  const categories = useMemo(() => [...new Set(targets.map(item => item.category))], [targets]);
  const counts = useMemo(() => ({ green: targets.filter(item => item.status === "green").length, amber: targets.filter(item => item.status === "amber").length, red: targets.filter(item => item.status === "red").length, unknown: targets.filter(item => item.status === "unknown").length }), [targets]);
  const globalStatus: TargetStatus = counts.red ? "red" : counts.amber ? "amber" : counts.unknown ? "unknown" : "green";

  async function command(targetKey: string, action: string) {
    const def = ACTIONS[action];
    if (!def) return;
    if (action === "test_api" || action === "test_service") { setBusy(`${targetKey}:${action}`); await refresh(true); setBusy(""); setNotice("Diagnostic terminé."); return; }
    if (def.level !== "green" && !window.confirm(`${def.label}\n\n${def.description}\n\nConfirmer l'action ?`)) return;
    setBusy(`${targetKey}:${action}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "command", targetKey, action }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Action ${response.status}`);
      setNotice(payload.deduplicated ? "Cette action est déjà en cours." : "Action envoyée. Le runner sécurisé va la prendre en charge.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action impossible."); }
    finally { setBusy(""); }
  }

  async function repairAll() {
    if (!window.confirm("Lancer une réparation automatique des flux critiques ?\n\nToolbox va relancer les alimentations FTP et vérifier le retour au vert.")) return;
    await command("bridge.ftp", "refresh_all_feeds");
  }

  async function rotateGuardian(target: Target) {
    if (target.guardianConfigured && !window.confirm(`Renouveler le jeton Guardian de ${target.label} ?\n\nL'ancien jeton cessera immédiatement de fonctionner.`)) return;
    setBusy(`${target.key}:guardian`); setError(""); setGuardian(null);
    try {
      const response = await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "guardian-token", targetKey: target.key }) });
      const payload = await response.json().catch(() => ({})) as TokenPayload;
      if (!response.ok || !payload.token) throw new Error(payload.error || "Jeton Guardian indisponible.");
      const setupPath = String(target.metadata?.setup_path ?? (target.key === "screen.direction" ? "/direction" : "/atelier"));
      const url = `${location.origin}${setupPath}?guardian=${payload.token}`;
      setGuardian({ targetKey: target.key, token: payload.token, url });
      setNotice("Jeton Guardian généré. Il n'est affiché qu'une fois : configure l'écran maintenant.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Activation Guardian impossible."); }
    finally { setBusy(""); }
  }

  return <main className={styles.page}>
    <section className={styles.hero}>
      <div><span>ADMIN · CENTRE DE MAINTENANCE</span><h1>Maintenance système</h1><p>Diagnostiquer, relancer et réparer les composants critiques de ToolBox sans intervention technique.</p></div>
      <div className={`${styles.globalStatus} ${styles[globalStatus]}`}><small>ÉTAT GLOBAL</small><strong>{statusLabel(globalStatus)}</strong><span>{counts.green} OK · {counts.amber} vigilance · {counts.red} incident</span></div>
    </section>

    <section className={styles.actionBar}>
      <button onClick={() => { setBusy("diagnostic"); void refresh(true).finally(() => { setBusy(""); setNotice("Diagnostic complet terminé."); }); }} disabled={Boolean(busy)}>{busy === "diagnostic" ? "DIAGNOSTIC EN COURS…" : "DIAGNOSTIC COMPLET"}</button>
      <button className={styles.repair} onClick={() => void repairAll()} disabled={Boolean(busy)}>RÉPARATION AUTOMATIQUE</button>
      <span>Actualisation automatique toutes les 15 s · dernier contrôle {dateLabel(data?.checkedAt)}</span>
    </section>

    {error && <div className={styles.error}><strong>Action impossible.</strong> {error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}
    {loading && !data && <div className={styles.loading}>Lecture de l'état réel du système…</div>}

    {guardian && <section className={styles.guardianSetup}>
      <div><span>GUARDIAN · ACTIVATION</span><h2>{guardian.targetKey === "screen.direction" ? "Écran Direction" : "Écran Atelier"}</h2><p>Ouvre cette URL une seule fois sur le navigateur de l'écran. Le jeton sera enregistré localement puis retiré de l'URL.</p></div>
      <code>{guardian.url}</code>
      <div className={styles.guardianButtons}><button onClick={() => void navigator.clipboard?.writeText(guardian.url)}>COPIER L'URL</button><button onClick={() => void navigator.clipboard?.writeText(guardian.token)}>COPIER LE JETON NATIF</button></div>
      <small>Pour le redémarrage du navigateur ou du poste, utilise ce même jeton dans le Guardian Windows fourni avec le projet.</small>
    </section>}

    {categories.map(category => <section className={styles.section} key={category}>
      <div className={styles.sectionHead}><div><span>SUPERVISION</span><h2>{category}</h2></div><small>{targets.filter(item => item.category === category).length} composant(s)</small></div>
      <div className={styles.grid}>{targets.filter(item => item.category === category).map(target => {
        const probe = probeMap.get(target.key); const actions = (target.capabilities ?? []).filter(action => ACTIONS[action]);
        return <article className={`${styles.card} ${styles[target.status]}`} key={target.key}>
          <header><div><span className={styles.dot}/><strong>{target.label}</strong></div><b>{statusLabel(target.status)}</b></header>
          <div className={styles.metrics}>
            <div><small>DERNIÈRE ACTIVITÉ</small><strong>{dateLabel(target.heartbeatAt ?? target.lastActivityAt)}</strong></div>
            <div><small>ANCIENNETÉ</small><strong>{ageLabel(target.ageMinutes)}</strong></div>
            {probe && <div><small>TEST HTTP</small><strong>{probe.status || "ERR"} · {probe.durationMs} ms</strong></div>}
            {target.appVersion && <div><small>VERSION</small><strong>{target.appVersion}</strong></div>}
          </div>
          {target.type === "screen" && <div className={styles.guardianState}><span>Guardian</span><strong>{target.guardianConfigured ? (target.heartbeatAt ? "ACTIF" : "CONFIGURÉ") : "À INSTALLER"}</strong><button onClick={() => void rotateGuardian(target)} disabled={Boolean(busy)}>{target.guardianConfigured ? "RENOUVELER" : "ACTIVER"}</button></div>}
          <div className={styles.actions}>{actions.map(action => { const def = ACTIONS[action]; const key = `${target.key}:${action}`; return <button key={action} className={styles[def.level]} title={def.description} onClick={() => void command(target.key, action)} disabled={Boolean(busy)}>{busy === key ? "EN COURS…" : def.label}</button>; })}</div>
        </article>;
      })}</div>
    </section>)}

    <section className={styles.split}>
      <div className={styles.section}><div className={styles.sectionHead}><div><span>COMMANDES</span><h2>Actions récentes</h2></div></div><div className={styles.list}>{(data?.commands ?? []).slice(0, 12).map(command => <article key={command.id}><div><strong>{ACTIONS[command.action]?.label ?? command.action}</strong><small>{command.target_key}</small></div><span className={styles[command.status === "success" ? "green" : command.status === "failed" ? "red" : "amber"]}>{command.status.toUpperCase()}</span><small>{dateLabel(command.finished_at ?? command.started_at ?? command.requested_at)}</small>{command.error && <p>{command.error}</p>}</article>)}</div></div>
      <div className={styles.section}><div className={styles.sectionHead}><div><span>JOURNAL</span><h2>Historique maintenance</h2></div></div><div className={styles.list}>{(data?.events ?? []).slice(0, 14).map(event => <article key={event.id}><div><strong>{event.message}</strong><small>{event.target_key ?? "Système"}{event.actor_name ? ` · ${event.actor_name}` : ""}</small></div><span className={styles[event.severity === "critical" ? "red" : event.severity === "warning" ? "amber" : "green"]}>{event.severity.toUpperCase()}</span><small>{dateLabel(event.created_at)}</small></article>)}</div></div>
    </section>

    <section className={styles.note}><strong>Principe de sécurité :</strong> aucune commande libre, aucun SQL libre et aucun secret technique ne sont exposés ici. Les actions sont limitées à une liste blanche, journalisées et exécutées par le runner ou le Guardian sécurisé.</section>
  </main>;
}
