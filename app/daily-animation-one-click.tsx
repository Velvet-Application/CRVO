"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createDailyAnimationPdf, type DailyAnimationPdfSummary } from "./lib/daily-animation-pdf";
import styles from "./daily-animation-one-click.module.css";

type MailRecipient = { name: string; address: string };
type Summary = DailyAnimationPdfSummary & {
  connected: boolean;
  generatedAt?: string;
  generatedBy?: string;
  mail: { subject: string; body: string; plainBody?: string };
  outlook?: {
    graphConfigured?: boolean;
    nativeShareAvailable?: boolean;
    to?: MailRecipient[];
    cc?: MailRecipient[];
    distribution?: { toCount?: number; ccCount?: number };
    signature?: { key?: string; name?: string; title?: string };
  };
  error?: string;
};

type Enrichment = {
  connected?: boolean;
  photosYesterday?: number | null;
  currentAging?: { stock?: number | null; over15?: number | null; over20?: number | null } | null;
  oldestToExit?: DailyAnimationPdfSummary["pilotage"]["oldestToExit"];
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
    tab.document.body.innerHTML = '<div style="text-align:center"><div style="font-size:42px;font-weight:800;font-style:italic">CRVO</div><p style="font-size:14px;color:#607d94">Préparation du brouillon Outlook, de la signature et de la pièce jointe PDF…</p></div>';
  } catch {}
  return tab;
}

function addresses(list?: MailRecipient[]) {
  return (list ?? []).map((item) => item.address).filter(Boolean);
}

export default function DailyAnimationOneClick() {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ReadyState>("idle");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const warmingRef = useRef<Promise<{ summary: Summary; pdf: File }> | null>(null);

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

      let enrichment: Enrichment | null = null;
      try {
        const extraResponse = await fetch(`/api/daily-animation-enrichment?date=${encodeURIComponent(payload.reportDate)}&_=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (extraResponse.ok) enrichment = await extraResponse.json() as Enrichment;
      } catch {}

      const enriched: Summary = {
        ...payload,
        yesterday: {
          ...payload.yesterday,
          photos: enrichment?.photosYesterday ?? payload.yesterday.photos ?? null,
        },
        pilotage: {
          ...payload.pilotage,
          currentStock: enrichment?.currentAging?.stock ?? payload.pilotage.currentStock ?? null,
          currentOver15: enrichment?.currentAging?.over15 ?? payload.pilotage.currentOver15 ?? null,
          currentOver20: enrichment?.currentAging?.over20 ?? payload.pilotage.currentOver20 ?? null,
          oldestToExit: enrichment?.oldestToExit ?? payload.pilotage.oldestToExit ?? [],
        },
      };

      const file = await createDailyAnimationPdf(enriched);
      setSummary(enriched);
      setPdf(file);
      setState("ready");
      return { summary: enriched, pdf: file };
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
  const toCount = summary?.outlook?.distribution?.toCount ?? summary?.outlook?.to?.length ?? 0;
  const ccCount = summary?.outlook?.distribution?.ccCount ?? summary?.outlook?.cc?.length ?? 0;

  async function openAnimation() {
    setNotice("");
    setError("");
    setState("opening");

    let outlookTab: Window | null = null;
    try {
      const prepared = await warmup();
      const currentSummary = prepared.summary;
      const file = prepared.pdf;
      const currentWarnings = quality(currentSummary);
      const plainBody = currentSummary.mail.plainBody || currentSummary.mail.body;

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
            filename: file.name,
            pdfBase64: await base64(file),
          }),
        });
        const payload = await response.json().catch(() => ({})) as { webLink?: string | null; error?: string };
        if (!response.ok) throw new Error(payload.error || "Brouillon Outlook impossible.");
        if (payload.webLink) {
          if (outlookTab) outlookTab.location.replace(payload.webLink);
          else window.location.href = payload.webLink;
          setNotice(`Brouillon Outlook prêt · ${toCount} destinataires · ${ccCount} CC · PDF joint.`);
          setState("ready");
          return;
        }
      }

      const nav = navigator as ShareNavigator;
      const shareData: ShareData = { files: [file], title: currentSummary.mail.subject, text: plainBody };
      if (nav.share && (!nav.canShare || nav.canShare(shareData))) {
        await nav.share(shareData);
        setNotice("Animation transmise au partage système avec le PDF joint. La mise en forme HTML complète est disponible avec Microsoft 365.");
        setState("ready");
        return;
      }

      download(file);
      const to = addresses(currentSummary.outlook?.to).join(",");
      const cc = addresses(currentSummary.outlook?.cc).join(",");
      const query = new URLSearchParams({ subject: currentSummary.mail.subject, body: plainBody });
      if (cc) query.set("cc", cc);
      window.location.href = `mailto:${encodeURIComponent(to)}?${query.toString()}`;
      setNotice("Outlook est ouvert avec la diffusion CRVO et le PDF téléchargé. L'attachement et la mise en forme automatiques nécessitent Microsoft 365.");
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
      <button type="button" className={styles.settingsButton} onClick={() => setSettingsOpen((value) => !value)} aria-label="Contrôler l'animation" title="Contrôler la diffusion">⋯</button>
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

      <div className={styles.readiness}>
        <span className={styles.ok}><i />Diffusion CRVO verrouillée : {toCount} destinataires · {ccCount} CC</span>
        <span className={styles.ok}><i />Signature automatique : {summary?.outlook?.signature?.name ?? "Direction CRVO"}{summary?.outlook?.signature?.title ? ` · ${summary.outlook.signature.title}` : ""}</span>
        <span className={graphReady ? styles.ok : styles.warn}><i />{graphReady ? "Microsoft 365 connecté : HTML Aptos Display 10 pt + signature + PDF automatiques" : "Microsoft 365 non relié : partage natif / mailto de secours"}</span>
        <span className={warnings.length ? styles.warn : styles.ok}><i />{warnings.length ? `Contrôle données : ${warnings.join(" · ")}` : "Données de la veille cohérentes pour diffusion"}</span>
        <span className={styles.ok}><i />PDF conforme à la charte CRVO · Exo · couleurs officielles</span>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.panelActions}>
        <button type="button" className={styles.secondary} onClick={() => void warmup(true).catch(() => undefined)}>Actualiser</button>
        <button type="button" className={styles.secondary} onClick={() => pdf && download(pdf)} disabled={!pdf}>Voir le PDF</button>
        <button type="button" className={styles.primary} onClick={() => void openAnimation()} disabled={state === "opening"}>Créer Outlook</button>
      </div>
    </div> : null}

    {!settingsOpen && (notice || error) ? <div className={`${styles.toast} ${error ? styles.toastError : ""}`} onClick={() => setSettingsOpen(true)}>{error || notice}</div> : null}
  </div>;
}
