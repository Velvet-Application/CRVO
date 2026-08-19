"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./daily-animation.module.css";

type ProductionItem = { key: string; label: string; value: number; color: string };
type Summary = {
  connected: boolean;
  centre: string;
  reportDate: string;
  generatedAt?: string;
  generatedBy?: string;
  yesterday: {
    entries: number;
    exits: number;
    exitTarget: number | null;
    stock: number;
    over15: number;
    over20: number;
    revenue: number;
    revenueTarget: number | null;
    invoices: number;
    laborHours: number;
    production: ProductionItem[];
  };
  month: {
    entries: number;
    exits: number;
    exitTarget: number | null;
    exitDelta: number | null;
    revenue: number;
    revenueTargetAtDate: number | null;
    revenueMonthlyTarget: number | null;
    revenueDelta: number | null;
    invoices: number;
    fre: number | null;
    laborHours: number;
    hoursPerExit: number | null;
    laborRevenue: number;
    businessDaysElapsed: number;
    businessDaysMonth: number;
  };
  pilotage: {
    tone: "ahead" | "watch" | "alert";
    urgents: number;
    qualityAlerts: number;
    currentStock: number | null;
    currentOver20: number | null;
    criticalBottleneck: { key?: string; label?: string; actual?: number; max?: number | null; over?: number | null } | null;
  };
  sources?: { financeAsOfDate?: string | null };
  mail: { subject: string; body: string };
  outlook?: { graphConfigured?: boolean };
  error?: string;
};

type MePayload = { user?: { role?: string } };

type ShareNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

const BLUE = "#004f9f";
const CYAN = "#009edb";
const YELLOW = "#fec82f";
const RED = "#eb5b56";
const TEAL = "#47b9b4";
const INK = "#082f55";
const MUTED = "#68849b";

function performanceRoute() {
  if (typeof window === "undefined") return false;
  if (window.location.pathname !== "/") return false;
  const nav = new URLSearchParams(window.location.search).get("nav");
  return nav == null || nav === "today";
}

function fmt(value: unknown, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n) : "—";
}

function euro(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "—";
}

function delta(value: unknown, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)}${suffix}`;
}

function displayDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d);
}

function toneLabel(tone: Summary["pilotage"]["tone"]) {
  if (tone === "ahead") return "DYNAMIQUE POSITIVE";
  if (tone === "alert") return "PLAN D'ACTION À TENIR";
  return "TRAJECTOIRE À SÉCURISER";
}

function toneColor(tone: Summary["pilotage"]["tone"]) {
  if (tone === "ahead") return TEAL;
  if (tone === "alert") return RED;
  return YELLOW;
}

function parseRecipients(value: string) {
  return value.split(/[;,\s]+/).map((item) => item.trim()).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 22) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 4) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lineIndex = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      lineIndex++;
      line = words[i];
      if (lineIndex >= maxLines - 1) {
        const remaining = [line, ...words.slice(i + 1)].join(" ");
        let clipped = remaining;
        while (clipped.length > 2 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
        ctx.fillText(`${clipped}…`, x, y + lineIndex * lineHeight);
        return lineIndex + 1;
      }
    } else line = test;
  }
  if (line && lineIndex < maxLines) {
    ctx.fillText(line, x, y + lineIndex * lineHeight);
    lineIndex++;
  }
  return lineIndex;
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string, label: string, value: string, detail: string, progress?: number | null) {
  ctx.save();
  ctx.shadowColor = "rgba(0,48,86,.08)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 7;
  rounded(ctx, x, y, w, h, 22);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowColor = "transparent";
  rounded(ctx, x, y, 8, h, 4);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = MUTED;
  ctx.font = '700 20px "Exo", Arial, sans-serif';
  ctx.fillText(label.toUpperCase(), x + 34, y + 38);
  ctx.fillStyle = INK;
  ctx.font = '800 italic 46px "Exo", Arial, sans-serif';
  ctx.fillText(value, x + 34, y + 96);
  ctx.fillStyle = MUTED;
  ctx.font = '600 18px "Exo", Arial, sans-serif';
  ctx.fillText(detail, x + 34, y + 132);
  if (progress != null && Number.isFinite(progress)) {
    const ratio = Math.max(0, Math.min(progress, 1.15));
    rounded(ctx, x + 34, y + h - 30, w - 68, 10, 5);
    ctx.fillStyle = "#e7f0f5";
    ctx.fill();
    rounded(ctx, x + 34, y + h - 30, (w - 68) * Math.min(ratio, 1), 10, 5);
    ctx.fillStyle = ratio >= 1 ? TEAL : ratio >= .95 ? YELLOW : RED;
    ctx.fill();
  }
  ctx.restore();
}

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image ${src} indisponible`));
    image.src = src;
  });
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function jpegPdf(jpeg: Uint8Array, width: number, height: number) {
  const enc = new TextEncoder();
  const pageW = 841.89;
  const pageH = 595.28;
  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects: Uint8Array[] = [
    new Uint8Array(),
    enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    enc.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    enc.encode(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`),
    concatBytes([
      enc.encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      enc.encode("\nendstream\nendobj\n"),
    ]),
    enc.encode(`5 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`),
  ];
  const header = enc.encode("%PDF-1.4\n%CRVO\n");
  const offsets = [0];
  let cursor = header.length;
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = cursor;
    cursor += objects[i].length;
  }
  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Blob([concatBytes([header, ...objects.slice(1), enc.encode(xref), enc.encode(trailer)])], { type: "application/pdf" });
}

async function createPdf(summary: Summary) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1684;
  canvas.height = 1191;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Moteur PDF indisponible.");

  ctx.fillStyle = "#f4f8fb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, canvas.width, 12);
  ctx.fillStyle = CYAN;
  ctx.fillRect(0, 12, canvas.width, 5);

  try {
    const logo = await loadImage("/crvo-logo.png");
    const ratio = logo.naturalWidth / logo.naturalHeight;
    ctx.drawImage(logo, 64, 48, 200, 200 / ratio);
  } catch {
    ctx.fillStyle = BLUE;
    ctx.font = '800 italic 54px "Exo", Arial, sans-serif';
    ctx.fillText("CRVO", 64, 100);
  }

  ctx.fillStyle = INK;
  ctx.font = '800 italic 44px "Exo", Arial, sans-serif';
  ctx.fillText("ANIMATION QUOTIDIENNE", 310, 78);
  ctx.fillStyle = MUTED;
  ctx.font = '600 21px "Exo", Arial, sans-serif';
  ctx.fillText(`CRVO ${summary.centre} · Résultats du ${displayDate(summary.reportDate)}`, 312, 112);

  const status = toneLabel(summary.pilotage.tone);
  const statusColor = toneColor(summary.pilotage.tone);
  ctx.font = '800 17px "Exo", Arial, sans-serif';
  const statusWidth = Math.max(260, ctx.measureText(status).width + 58);
  rounded(ctx, canvas.width - statusWidth - 64, 52, statusWidth, 56, 28);
  ctx.fillStyle = `${statusColor}22`;
  ctx.fill();
  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = statusColor === YELLOW ? "#8a6500" : statusColor;
  ctx.fillText(status, canvas.width - statusWidth - 35, 87);

  const dayExitRatio = summary.yesterday.exitTarget ? summary.yesterday.exits / summary.yesterday.exitTarget : null;
  const dayCaRatio = summary.yesterday.revenueTarget ? summary.yesterday.revenue / summary.yesterday.revenueTarget : null;
  const mtdExitRatio = summary.month.exitTarget ? summary.month.exits / summary.month.exitTarget : null;
  const mtdCaRatio = summary.month.revenueTargetAtDate ? summary.month.revenue / summary.month.revenueTargetAtDate : null;

  card(ctx, 64, 158, 500, 184, CYAN, "Sorties veille", `${fmt(summary.yesterday.exits)} VOP`, summary.yesterday.exitTarget == null ? "objectif journalier non configuré" : `objectif ${fmt(summary.yesterday.exitTarget)} · ${delta(summary.yesterday.exits - summary.yesterday.exitTarget, " VOP")}`, dayExitRatio);
  card(ctx, 592, 158, 500, 184, BLUE, "CA veille", euro(summary.yesterday.revenue), summary.yesterday.revenueTarget == null ? `${fmt(summary.yesterday.invoices)} factures` : `objectif ${euro(summary.yesterday.revenueTarget)} · ${delta(summary.yesterday.revenue - summary.yesterday.revenueTarget, " €")}`, dayCaRatio);
  card(ctx, 1120, 158, 500, 184, TEAL, "Stock fin de journée", `${fmt(summary.yesterday.stock)} VO`, `${fmt(summary.yesterday.over15)} > 15 j · ${fmt(summary.yesterday.over20)} > 20 j`);

  card(ctx, 64, 372, 500, 184, BLUE, "Sorties depuis le 1er", `${fmt(summary.month.exits)} VOP`, summary.month.exitTarget == null ? "objectif à date non configuré" : `objectif ${fmt(summary.month.exitTarget)} · ${delta(summary.month.exitDelta, " VOP")}`, mtdExitRatio);
  card(ctx, 592, 372, 500, 184, summary.month.revenueDelta != null && summary.month.revenueDelta >= 0 ? TEAL : RED, "CA depuis le 1er", euro(summary.month.revenue), summary.month.revenueTargetAtDate == null ? `${fmt(summary.month.invoices)} factures` : `objectif à date ${euro(summary.month.revenueTargetAtDate)} · ${delta(summary.month.revenueDelta, " €")}`, mtdCaRatio);
  card(ctx, 1120, 372, 500, 184, YELLOW, "Valeur & productivité", summary.month.fre == null ? "FRE —" : `FRE ${euro(summary.month.fre)}`, `${summary.month.hoursPerExit == null ? "—" : `${fmt(summary.month.hoursPerExit, 2)} h`} facturées / VOP · ${fmt(summary.month.invoices)} factures`);

  ctx.fillStyle = INK;
  ctx.font = '800 italic 29px "Exo", Arial, sans-serif';
  ctx.fillText("PRODUCTION ATELIERS - VEILLE", 64, 620);
  ctx.fillStyle = MUTED;
  ctx.font = '600 17px "Exo", Arial, sans-serif';
  ctx.fillText("Nombre de véhicules terminés par étape", 64, 649);

  const production = summary.yesterday.production ?? [];
  const prodGap = 18;
  const prodW = (1556 - prodGap * 5) / 6;
  production.slice(0, 6).forEach((item, index) => {
    const x = 64 + index * (prodW + prodGap);
    const y = 674;
    rounded(ctx, x, y, prodW, 132, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = `${item.color || BLUE}66`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = item.color || BLUE;
    ctx.fillRect(x, y, 7, 132);
    ctx.fillStyle = INK;
    ctx.font = '800 italic 36px "Exo", Arial, sans-serif';
    ctx.fillText(fmt(item.value), x + 28, y + 58);
    ctx.fillStyle = MUTED;
    ctx.font = '700 17px "Exo", Arial, sans-serif';
    wrap(ctx, item.label, x + 28, y + 92, prodW - 48, 21, 2);
  });

  const panelY = 844;
  rounded(ctx, 64, panelY, 1556, 248, 24);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d7e6ef";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = toneColor(summary.pilotage.tone);
  ctx.fillRect(64, panelY, 10, 248);
  ctx.fillStyle = INK;
  ctx.font = '800 italic 29px "Exo", Arial, sans-serif';
  ctx.fillText("PRIORITÉS DE PILOTAGE", 96, panelY + 43);

  const bits: string[] = [];
  const bottleneck = summary.pilotage.criticalBottleneck;
  if (bottleneck?.label && Number(bottleneck.over) > 0) bits.push(`${bottleneck.label} : ${fmt(bottleneck.actual)} dossiers pour un seuil de ${fmt(bottleneck.max)}`);
  if (summary.pilotage.urgents > 0) bits.push(`${fmt(summary.pilotage.urgents)} urgents à sécuriser`);
  if (summary.pilotage.qualityAlerts > 0) bits.push(`${fmt(summary.pilotage.qualityAlerts)} alertes NC à traiter`);
  if (Number(summary.pilotage.currentOver20) > 0) bits.push(`${fmt(summary.pilotage.currentOver20)} véhicules de plus de 20 jours dans le parc actuel`);
  if (!bits.length) bits.push("Aucun signal critique majeur détecté : protéger le flux et la qualité de traversée.");

  ctx.font = '700 21px "Exo", Arial, sans-serif';
  ctx.fillStyle = INK;
  bits.slice(0, 4).forEach((line, index) => {
    ctx.fillStyle = index === 0 && bottleneck?.label ? RED : BLUE;
    ctx.beginPath();
    ctx.arc(106, panelY + 84 + index * 38, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(line, 128, panelY + 91 + index * 38);
  });

  const volumeGood = summary.month.exitDelta == null || summary.month.exitDelta >= 0;
  const caGood = summary.month.revenueDelta == null || summary.month.revenueDelta >= 0;
  const callout = volumeGood && caGood
    ? "Protéger l'avance : garder le rythme, traiter les urgents et ne pas laisser vieillir le parc."
    : volumeGood && !caGood
      ? "Le débit est là : transformer davantage les dossiers produits en facturation et en CA."
      : !volumeGood && caGood
        ? "La valeur est tenue : remettre du débit dans les secteurs aval pour rattraper les sorties."
        : "Priorité flux : débloquer, produire, sortir et facturer les dossiers terminables aujourd'hui.";
  ctx.font = '700 italic 20px "Exo", Arial, sans-serif';
  ctx.fillStyle = BLUE;
  wrap(ctx, callout, 910, panelY + 84, 650, 30, 4);

  ctx.fillStyle = MUTED;
  ctx.font = '600 14px "Exo", Arial, sans-serif';
  ctx.fillText(`Sources : ${summary.sources?.financeAsOfDate ? `CA arrêté au ${displayDate(summary.sources.financeAsOfDate)} · ` : ""}FTP CRVO / EtatduParc / Reporting factures / Objectifs KPI`, 64, 1144);
  ctx.textAlign = "right";
  ctx.fillText(`Généré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`, 1620, 1144);
  ctx.textAlign = "left";

  const jpegBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Rendu PDF impossible.")), "image/jpeg", .94));
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = jpegPdf(jpeg, canvas.width, canvas.height);
  const filename = `CRVO_${summary.centre}_Animation_${summary.reportDate}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new File([pdf], filename, { type: "application/pdf" });
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

async function fileBase64(file: File) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < buffer.length; offset += step) binary += String.fromCharCode(...buffer.subarray(offset, Math.min(offset + step, buffer.length)));
  return btoa(binary);
}

export default function DailyAnimationLauncher() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    async function check() {
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
    void check();
    const timer = window.setInterval(() => {
      const routeVisible = performanceRoute();
      if (!routeVisible) setVisible(false);
    }, 1200);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    try { setRecipients(localStorage.getItem("crvo-daily-animation-recipients") ?? ""); } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("crvo-daily-animation-recipients", recipients); } catch {}
  }, [recipients]);

  const tone = summary?.pilotage.tone ?? "watch";
  const priorities = useMemo(() => {
    if (!summary) return [] as string[];
    const out: string[] = [];
    const b = summary.pilotage.criticalBottleneck;
    if (b?.label && Number(b.over) > 0) out.push(`${b.label} : ${fmt(b.actual)} dossiers / seuil ${fmt(b.max)}`);
    if (summary.pilotage.urgents > 0) out.push(`${fmt(summary.pilotage.urgents)} urgents`);
    if (summary.pilotage.qualityAlerts > 0) out.push(`${fmt(summary.pilotage.qualityAlerts)} alertes NC`);
    if (Number(summary.pilotage.currentOver20) > 0) out.push(`${fmt(summary.pilotage.currentOver20)} véhicules > 20 j`);
    return out;
  }, [summary]);

  async function prepare() {
    setOpen(true);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/daily-animation", { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
      const payload = await response.json().catch(() => ({})) as Summary;
      if (!response.ok || !payload.connected) throw new Error(payload.error || "Synthèse quotidienne indisponible.");
      setSummary(payload);
      setSubject(payload.mail.subject);
      setBody(payload.mail.body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Préparation impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function pdfDownload() {
    if (!summary) return;
    setNotice("Génération du PDF CRVO…");
    setError("");
    try {
      const file = await createPdf(summary);
      download(file);
      setNotice(`PDF prêt : ${file.name}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PDF impossible.");
      setNotice("");
    }
  }

  async function copyMail() {
    try {
      await navigator.clipboard.writeText(`Objet : ${subject}\n\n${body}`);
      setNotice("Corps de mail copié.");
    } catch {
      setError("Impossible de copier automatiquement le mail.");
    }
  }

  async function outlook() {
    if (!summary) return;
    setNotice("Préparation d'Outlook et de la pièce jointe…");
    setError("");
    try {
      const file = await createPdf(summary);
      const addresses = parseRecipients(recipients);

      if (summary.outlook?.graphConfigured) {
        const response = await fetch("/api/daily-animation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject,
            bodyText: body,
            recipients: addresses,
            filename: file.name,
            pdfBase64: await fileBase64(file),
          }),
        });
        const payload = await response.json().catch(() => ({})) as { webLink?: string | null; error?: string };
        if (!response.ok) throw new Error(payload.error || "Brouillon Outlook impossible.");
        if (payload.webLink) {
          window.open(payload.webLink, "_blank", "noopener,noreferrer");
          setNotice("Brouillon Outlook créé avec le PDF joint.");
          return;
        }
      }

      const nav = navigator as ShareNavigator;
      const shareData: ShareData = { files: [file], title: subject, text: body };
      if (nav.share && (!nav.canShare || nav.canShare(shareData))) {
        try {
          await nav.share(shareData);
          setNotice("PDF transmis au partage système : sélectionne Outlook si nécessaire.");
          return;
        } catch (reason) {
          if (reason instanceof DOMException && reason.name === "AbortError") {
            setNotice("Partage annulé.");
            return;
          }
        }
      }

      download(file);
      const to = addresses.join(",");
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      setNotice("Outlook est ouvert avec le mail prérempli. Le PDF a aussi été téléchargé pour la pièce jointe.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ouverture Outlook impossible.");
      setNotice("");
    }
  }

  if (!visible) return null;

  return <>
    <button type="button" className={styles.launcher} onClick={() => void prepare()}>
      <span className={styles.launcherIcon}>✦</span>
      <span><b>Animation équipe</b><small>PDF + Outlook</small></span>
    </button>

    {open ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Préparer l'animation quotidienne">
      <div className={styles.modal}>
        <div className={styles.head}>
          <div>
            <span>ADMIN · PERFORMANCE DU JOUR</span>
            <h2>Préparer l'animation des équipes</h2>
            <p>Résultats veille, trajectoire mensuelle, CA et priorités de pilotage dans un PDF à la charte CRVO.</p>
          </div>
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Fermer">×</button>
        </div>

        {loading ? <div className={styles.loading}><i/><strong>Lecture des données certifiées…</strong><span>Production · objectifs · facturation · parc</span></div> : null}
        {error ? <div className={styles.error}><strong>À CORRIGER</strong><span>{error}</span></div> : null}

        {summary && !loading ? <div className={styles.content}>
          <section className={styles.preview}>
            <div className={styles.previewTop}>
              <div><span>SYNTHÈSE DU {displayDate(summary.reportDate)}</span><h3>CRVO {summary.centre}</h3></div>
              <b className={`${styles.tone} ${styles[`tone_${tone}`]}`}>{toneLabel(tone)}</b>
            </div>

            <div className={styles.kpiGrid}>
              <article><small>Sorties veille</small><strong>{fmt(summary.yesterday.exits)} <em>/ {summary.yesterday.exitTarget == null ? "—" : fmt(summary.yesterday.exitTarget)}</em></strong><span>{summary.yesterday.exitTarget == null ? "objectif non configuré" : delta(summary.yesterday.exits - summary.yesterday.exitTarget, " VOP")}</span></article>
              <article><small>CA veille</small><strong>{euro(summary.yesterday.revenue)}</strong><span>{summary.yesterday.revenueTarget == null ? `${fmt(summary.yesterday.invoices)} factures` : `${delta(summary.yesterday.revenue - summary.yesterday.revenueTarget, " €")} vs cible`}</span></article>
              <article><small>Sorties mois</small><strong>{fmt(summary.month.exits)} <em>/ {summary.month.exitTarget == null ? "—" : fmt(summary.month.exitTarget)}</em></strong><span>{summary.month.exitDelta == null ? "objectif non configuré" : delta(summary.month.exitDelta, " VOP")}</span></article>
              <article><small>CA mois</small><strong>{euro(summary.month.revenue)}</strong><span>{summary.month.revenueDelta == null ? "cible non configurée" : `${delta(summary.month.revenueDelta, " €")} vs trajectoire`}</span></article>
              <article><small>FRE</small><strong>{summary.month.fre == null ? "—" : euro(summary.month.fre)}</strong><span>{summary.month.hoursPerExit == null ? "—" : `${fmt(summary.month.hoursPerExit, 2)} h / VOP`}</span></article>
              <article><small>Parc actuel</small><strong>{summary.pilotage.currentStock == null ? fmt(summary.yesterday.stock) : fmt(summary.pilotage.currentStock)} VO</strong><span>{summary.pilotage.currentOver20 == null ? `${fmt(summary.yesterday.over20)} > 20 j` : `${fmt(summary.pilotage.currentOver20)} > 20 j`}</span></article>
            </div>

            <div className={styles.production}><span>PRODUCTION VEILLE</span><div>{summary.yesterday.production.map((item) => <article key={item.key} style={{ borderColor: item.color }}><i style={{ background: item.color }}/><strong>{fmt(item.value)}</strong><small>{item.label}</small></article>)}</div></div>

            <div className={styles.priorities}><strong>Priorités proposées</strong>{priorities.length ? priorities.map((item) => <span key={item}>{item}</span>) : <span>Pas de signal critique majeur détecté.</span>}</div>
          </section>

          <section className={styles.composer}>
            <div className={styles.formRow}><label>Destinataires <small>optionnel · séparés par ;</small><input value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="prenom.nom@entreprise.fr ; équipe@entreprise.fr"/></label></div>
            <div className={styles.formRow}><label>Objet<input value={subject} onChange={(event) => setSubject(event.target.value)}/></label></div>
            <label className={styles.bodyLabel}>Corps du mail <small>Personnalisé selon la situation du centre · modifiable avant ouverture d'Outlook</small><textarea value={body} onChange={(event) => setBody(event.target.value)} /></label>
            <div className={styles.sourceLine}>CA arrêté au <b>{displayDate(summary.sources?.financeAsOfDate)}</b> · PDF généré à partir des données KPI certifiées.</div>
          </section>

          {notice ? <div className={styles.notice}>{notice}</div> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => void copyMail()}>Copier le mail</button>
            <button type="button" className={styles.secondary} onClick={() => void pdfDownload()}>Télécharger le PDF</button>
            <button type="button" className={styles.primary} onClick={() => void outlook()}>{summary.outlook?.graphConfigured ? "Créer le brouillon Outlook + PDF" : "Outlook + PDF"}</button>
          </div>
          {!summary.outlook?.graphConfigured ? <p className={styles.outlookHint}>Le bouton utilise le partage natif du poste/PWA pour transmettre directement le PDF à Outlook lorsqu'il est disponible. Sur un poste ne supportant pas le partage de fichiers, le PDF est téléchargé et le mail Outlook est prérempli automatiquement.</p> : null}
        </div> : null}
      </div>
    </div> : null}
  </>;
}
