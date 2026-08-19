"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createDailyAnimationPdf, type DailyAnimationPdfSummary } from "./lib/daily-animation-pdf";
import styles from "./daily-animation-one-click.module.css";

type Summary = DailyAnimationPdfSummary & {
  connected: boolean;
  generatedAt?: string;
  generatedBy?: string;
  mail: { subject: string; body: string };
  outlook?: { graphConfigured?: boolean; nativeShareAvailable?: boolean };
  error?: string;
};

type MePayload = { user?: { role?: string } };
type ReadyState = "idle" | "warming" | "ready" | "opening" | "error";
type ShareNavigator = Navigator & { canShare?: (data?: ShareData) => boolean; share?: (data?: ShareData) => Promise<void> };

function performanceRoute() {
  if (typeof window === "undefined") return false;
  if (window.location.pathname !== "/") return false;
  const nav = new URLSearchParams(window.location.search).get("nav");
  return nav == null || nav === "today";
}

function parseRecipients(value: string) {
  return value.split(/[;,\s]+/).map((item) => item.trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function displayDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}

function signed(value: number | null | undefined, suffix = "") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${n > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)}${suffix}`;
}

function euro(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value));
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  return btoa(binary);
}

function quality(summary: Summary) {
  const warnings: string[] = [];
  if (!summary.reportDate) warnings.push("date de synthèse absente");
  if (summary.sources?.financeAsOfDate && summary.sources.financeAsOfDate !== summary.reportDate) warnings.push(`CA arrêté au ${displayDate(summary.sources.financeAsOfDate)}`);
  if (summary.yesterday.exitTarget == null) warnings.push("objectif Sortie usine de la veille absent");
  if (summary.month.exitTarget == null) warnings.push("objectif sorties à date absent");
  if (summary.month.revenueTargetAtDate == null) warnings.push("trajectoire CA à date absente");
  return warnings;
}

function blankOutlookWindow() {
  const tab = window.open("about:blank", "_blank");
  if (!tab) return null;
  try {
    tab.document.title = "Ouverture Outlook…";
    tab.document.body.style.cssText = "margin:0;background:#f5f9fc;font-family:Arial,sans-serif;color:#004f9f;display:grid;place-items:center;min-height:100vh";
    tab.document.body.innerHTML = '<div style="text-align:center"><div style="font-size:42px;font-weight:800;font-style:italic">CRVO</div><p style="font-size:14px;color:#607d94">Préparation du brouillon Outlook et de la pièce jointe PDF…</p></div>';
  } catch {}
  return tab;
}

export default function DailyAnimationOneClick() {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ReadyState>("idle");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [recipients, setRecipients] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const warmingRef = useRef<Promise<{ summary: Summary; pdf: File }> | null>(null);

  useEffect(() => {
    try { setRecipients(localStorage.getItem("crvo-daily-animation-recipients") ?? ""); } catch {}
  }, []);

  useEffect(() => {
    let stopped = false;
    async function checkVisibility() {
      if (!performanceRoute()) {
        if (!stopped) setVisible(false);
        return;
      }
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as MePayload;
        if (!stopped) setVisible(response.ok && payload.user?.role === "admin");
      } catch {
        if (!stopped) setVisible(false);
      }
    }
    void checkVisibility();
    const timer = window.setInterval(() => void checkVisibility(), 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  async function warmup(force = false) {
    if (!force && summary && pdf) return { summary, pdf };
    if (!force && warmingRef.current) return warmingRef.current;

    const task = (async () => {
      setState("warming");
      setError("");
      const response = await fetch(`/api/daily-animation?_=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      const payload = await response.json().catch(() => ({})) as Summary;
      if (!response.ok || !payload.connected) throw new Error(payload.error || "Synthèse quotidienne indisponible.");
      const file = await createDailyAnimationPdf(payload);
      setSummary(payload);
      setPdf(file);
      setState("ready");
      return { summary: payload, pdf: file };
    })().catch((reason) => {
      setState("error");
      const message = reason instanceof Error ? reason.message : "Préparation impossible.";
      setError(message);
      throw reason;
    }).finally(() => {
      warmingRef.current = null;
    });

    warmingRef.current = task;
    return task;
  }

  useEffect(() => {
    if (!visible || !performanceRoute()) return;
    void warmup().catch(() => undefined);
    const refresh = window.setInterval(() => void warmup(true).catch(() => undefined), 5 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, [visible]);

  const warnings = useMemo(() => summary ? quality(summary) : [], [summary]);
  const graphReady = Boolean(summary?.outlook?.graphConfigured);
  const statusLabel = state === "ready" ? "PRÊT" : state === "opening" ? "OUVERTURE" : state === "error" ? "À CONTRÔLER" : "PRÉPARATION";

  async function openAnimation() {
    setNotice("");
    setError("");
    setState("opening");

    let outlookTab: Window | null = null;
    try {
      const prepared = await warmup();
      const currentSummary = prepared.summary;
      const file = prepared.pdf;
      const addresses = parseRecipients(recipients);
      const currentWarnings = quality(currentSummary);

      if (currentWarnings.length) {
        setState("ready");
        setSettingsOpen(true);
        setError(`Contrôle requis avant diffusion : ${currentWarnings.join(" · ")}.`);
        return;
      }

      if (currentSummary.outlook?.graphConfigured) {
        outlookTab = blankOutlookWindow();
        const response = await fetch("/api/daily-animation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: currentSummary.mail.subject,
            bodyText: currentSummary.mail.body,
            recipients: addresses,
            filename: file.name,
            pdfBase64: await base64(file),
          }),
        });
        const payload = await response.json().catch(() => ({})) as { webLink?: string | null; error?: string };
        if (!response.ok) throw new Error(payload.error || "Brouillon Outlook impossible.");
        if (payload.webLink) {
          if (outlookTab) outlookTab.location.replace(payload.webLink);
          else window.location.href = payload.webLink;
          setNotice("Brouillon Outlook prêt avec le PDF joint.");
          setState("ready");
          return;
        }
      }

      const nav = navigator as ShareNavigator;
      const shareData: ShareData = { files: [file], title: currentSummary.mail.subject, text: currentSummary.mail.body };
      if (nav.share && (!nav.canShare || nav.canShare(shareData))) {
        await nav.share(shareData);
        setNotice("Animation transmise au partage système avec le PDF joint.");
        setState("ready");
        return;
      }

      download(file);
      const to = addresses.join(",");
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(currentSummary.mail.subject)}&body=${encodeURIComponent(currentSummary.mail.body)}`;
      setNotice("Outlook est ouvert et le PDF a été téléchargé. L'attachement automatique nécessite la connexion Microsoft 365.");
      setState("ready");
    } catch (reason) {
      if (outlookTab && !outlookTab.closed) outlookTab.close();
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setState("ready");
        setNotice("Partage annulé.");
        return;
      }
      setState("error");
      setError(reason instanceof Error ? reason.message : "Ouverture de l'animation impossible.");
    }
  }

  function saveRecipients() {
    try { localStorage.setItem("crvo-daily-animation-recipients", recipients); } catch {}
    setSettingsOpen(false);
    setNotice("Destinataires mémorisés sur cet appareil.");
  }

  if (!visible) return null;

  return <div className={styles.root}>
    <div className={`${styles.launcher} ${styles[`state_${state}`]}`}>
      <button type="button" className={styles.mainAction} onClick={() => void openAnimation()} disabled={state === "opening"} aria-label="Créer l'animation quotidienne et ouvrir Outlook">
        <span className={styles.icon}><i /></span>
        <span className={styles.copy}>
          <small>ANIMATION ÉQUIPE · 1 CLIC</small>
          <strong>{state === "opening" ? "Ouverture d'Outlook…" : "Créer & ouvrir Outlook"}</strong>
          <em>{summary ? `Résultats du ${displayDate(summary.reportDate)} · ${graphReady ? "PDF joint automatique" : "PDF + Outlook"}` : "PDF CRVO · mail personnalisé · CA"}</em>
        </span>
        <span className={styles.status}><i />{statusLabel}</span>
      </button>
      <button type="button" className={styles.settingsButton} onClick={() => setSettingsOpen((value) => !value)} aria-label="Paramétrer l'animation" title="Paramétrer les destinataires">⋯</button>
    </div>

    {settingsOpen ? <div className={styles.panel}>
      <div className={styles.panelHead}>
        <div><small>MODE PROFESSIONNEL</small><strong>Animation quotidienne CRVO</strong></div>
        <button type="button" onClick={() => setSettingsOpen(false)}>×</button>
      </div>

      {summary ? <div className={styles.summaryStrip}>
        <span><small>Sorties veille</small><b>{summary.yesterday.exits} / {summary.yesterday.exitTarget ?? "—"}</b></span>
        <span><small>Sorties mois</small><b>{summary.month.exits} <em>{signed(summary.month.exitDelta, " VOP")}</em></b></span>
        <span><small>CA mois</small><b>{euro(summary.month.revenue)} <em>{signed(summary.month.revenueDelta, " €")}</em></b></span>
      </div> : null}

      <label className={styles.label}>Destinataires par défaut <small>séparés par ;</small>
        <textarea value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="prenom.nom@entreprise.fr ; equipe@entreprise.fr" />
      </label>

      <div className={styles.readiness}>
        <span className={graphReady ? styles.ok : styles.warn}><i />{graphReady ? "Microsoft 365 connecté : brouillon + PJ automatiques" : "Microsoft 365 non relié : partage natif / mailto de secours"}</span>
        <span className={warnings.length ? styles.warn : styles.ok}><i />{warnings.length ? `Contrôle données : ${warnings.join(" · ")}` : "Données de la veille cohérentes pour diffusion"}</span>
        <span className={styles.ok}><i />PDF conforme à la charte CRVO · Exo · couleurs officielles</span>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.panelActions}>
        <button type="button" className={styles.secondary} onClick={() => void warmup(true).catch(() => undefined)}>Actualiser</button>
        <button type="button" className={styles.secondary} onClick={() => pdf && download(pdf)} disabled={!pdf}>Voir le PDF</button>
        <button type="button" className={styles.primary} onClick={saveRecipients}>Enregistrer</button>
      </div>
    </div> : null}

    {!settingsOpen && (notice || error) ? <div className={`${styles.toast} ${error ? styles.toastError : ""}`} onClick={() => setSettingsOpen(true)}>{error || notice}</div> : null}
  </div>;
}
