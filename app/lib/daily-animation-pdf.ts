"use client";

export type DailyAnimationPdfSummary = {
  centre: string;
  reportDate: string;
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
    production: Array<{ key: string; label: string; value: number; color: string }>;
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
};

const BLUE = "#004f9f";
const CYAN = "#009edb";
const YELLOW = "#fec82f";
const RED = "#eb5b56";
const TEAL = "#47b9b4";
const INK = "#0a3157";
const MUTED = "#68849b";
const PALE = "#f5f9fc";
const LINE = "#d9e6ee";

function fmt(value: unknown, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n) : "—";
}

function euro(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n) : "—";
}

function signed(value: unknown, suffix = "") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)}${suffix}`;
}

function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)}%` : "—";
}

function displayDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius = 22) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 4) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let index = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + index * lineHeight);
      index++;
      line = words[i];
      if (index >= maxLines - 1) {
        const rest = [line, ...words.slice(i + 1)].join(" ");
        let clipped = rest;
        while (clipped.length > 2 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
        ctx.fillText(`${clipped}…`, x, y + index * lineHeight);
        return;
      }
    } else line = test;
  }
  if (line && index < maxLines) ctx.fillText(line, x, y + index * lineHeight);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image ${src} indisponible`));
    image.src = src;
  });
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function jpegPdf(jpeg: Uint8Array, width: number, height: number) {
  const enc = new TextEncoder();
  const pageW = 841.89;
  const pageH = 595.28;
  const stream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects: Uint8Array[] = [
    new Uint8Array(),
    enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    enc.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    enc.encode(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`),
    concat([
      enc.encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg,
      enc.encode("\nendstream\nendobj\n"),
    ]),
    enc.encode(`5 0 obj\n<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`),
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
  return new Blob([concat([header, ...objects.slice(1), enc.encode(xref), enc.encode(trailer)])], { type: "application/pdf" });
}

function status(summary: DailyAnimationPdfSummary) {
  if (summary.pilotage.tone === "ahead") return { label: "DYNAMIQUE POSITIVE", color: TEAL, text: "Protéger l'avance et maintenir le rythme." };
  if (summary.pilotage.tone === "alert") return { label: "PLAN D'ACTION", color: RED, text: "Reprendre la trajectoire avec des priorités claires." };
  return { label: "TRAJECTOIRE À SÉCURISER", color: YELLOW, text: "Rester au contact et convertir chaque dossier terminable." };
}

function kpiCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: string,
  eyebrow: string,
  value: string,
  detail: string,
  ratio: number | null,
) {
  ctx.save();
  ctx.shadowColor = "rgba(0,46,84,.07)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 7;
  rounded(ctx, x, y, width, height, 22);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = accent;
  rounded(ctx, x, y, 9, height, 5);
  ctx.fill();
  ctx.fillStyle = MUTED;
  ctx.font = '700 17px "Exo", Arial, sans-serif';
  ctx.fillText(eyebrow.toUpperCase(), x + 32, y + 36);
  ctx.fillStyle = INK;
  ctx.font = '800 italic 42px "Exo", Arial, sans-serif';
  ctx.fillText(value, x + 32, y + 86);
  ctx.fillStyle = MUTED;
  ctx.font = '600 16px "Exo", Arial, sans-serif';
  wrap(ctx, detail, x + 32, y + 116, width - 64, 21, 2);
  if (ratio != null && Number.isFinite(ratio)) {
    const r = Math.max(0, Math.min(ratio, 1.2));
    rounded(ctx, x + 32, y + height - 27, width - 64, 8, 4);
    ctx.fillStyle = "#e6eff4";
    ctx.fill();
    rounded(ctx, x + 32, y + height - 27, (width - 64) * Math.min(r, 1), 8, 4);
    ctx.fillStyle = r >= 1 ? TEAL : r >= .95 ? YELLOW : RED;
    ctx.fill();
  }
  ctx.restore();
}

function focusText(summary: DailyAnimationPdfSummary) {
  const volumeGood = summary.month.exitDelta == null || summary.month.exitDelta >= 0;
  const caGood = summary.month.revenueDelta == null || summary.month.revenueDelta >= 0;
  if (volumeGood && caGood) return "La trajectoire est positive. On protège l'avance, on traite les urgents et on empêche le parc de vieillir.";
  if (volumeGood && !caGood) return "Le débit est là. La priorité est maintenant de convertir la production en facturation et en chiffre d'affaires.";
  if (!volumeGood && caGood) return "La valeur est tenue. Il faut remettre du débit dans les secteurs aval et accélérer les sorties sans dégrader la facturation.";
  return "Priorité flux : débloquer les dossiers terminables, alimenter les postes aval, sortir et facturer dans la journée.";
}

export async function createDailyAnimationPdf(summary: DailyAnimationPdfSummary) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1684;
  canvas.height = 1191;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Moteur PDF indisponible.");

  ctx.fillStyle = PALE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = BLUE;
  ctx.fillRect(0, 0, canvas.width, 14);
  ctx.fillStyle = CYAN;
  ctx.fillRect(0, 14, canvas.width, 5);

  rounded(ctx, 42, 42, 1600, 130, 28);
  ctx.fillStyle = "#fff";
  ctx.fill();

  try {
    const logo = await loadImage("/crvo-logo.png");
    const ratio = logo.naturalWidth / logo.naturalHeight;
    const h = 64;
    ctx.drawImage(logo, 72, 72, h * ratio, h);
  } catch {
    ctx.fillStyle = BLUE;
    ctx.font = '800 italic 54px "Exo", Arial, sans-serif';
    ctx.fillText("CRVO", 72, 112);
  }

  ctx.fillStyle = INK;
  ctx.font = '800 italic 42px "Exo", Arial, sans-serif';
  ctx.fillText("ANIMATION QUOTIDIENNE", 365, 94);
  ctx.fillStyle = MUTED;
  ctx.font = '600 19px "Exo", Arial, sans-serif';
  ctx.fillText(`CRVO ${summary.centre} · Résultats du ${displayDate(summary.reportDate)}`, 367, 128);

  const st = status(summary);
  ctx.font = '800 16px "Exo", Arial, sans-serif';
  const badgeWidth = Math.max(260, ctx.measureText(st.label).width + 70);
  rounded(ctx, 1606 - badgeWidth, 72, badgeWidth, 54, 27);
  ctx.fillStyle = `${st.color}18`;
  ctx.fill();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = st.color === YELLOW ? "#8b6700" : st.color;
  ctx.fillText(st.label, 1636 - badgeWidth, 105);

  const dayExitRatio = summary.yesterday.exitTarget ? summary.yesterday.exits / summary.yesterday.exitTarget : null;
  const dayRevenueRatio = summary.yesterday.revenueTarget ? summary.yesterday.revenue / summary.yesterday.revenueTarget : null;
  const monthExitRatio = summary.month.exitTarget ? summary.month.exits / summary.month.exitTarget : null;
  const monthRevenueRatio = summary.month.revenueTargetAtDate ? summary.month.revenue / summary.month.revenueTargetAtDate : null;
  const monthTargetPct = summary.month.revenueMonthlyTarget ? summary.month.revenue / summary.month.revenueMonthlyTarget * 100 : null;

  kpiCard(ctx, 42, 198, 500, 168, CYAN, "Sorties veille", `${fmt(summary.yesterday.exits)} VOP`, summary.yesterday.exitTarget == null ? "Objectif journalier non configuré" : `Objectif ${fmt(summary.yesterday.exitTarget)} · ${signed(summary.yesterday.exits - summary.yesterday.exitTarget, " VOP")}`, dayExitRatio);
  kpiCard(ctx, 568, 198, 500, 168, BLUE, "CA veille", euro(summary.yesterday.revenue), summary.yesterday.revenueTarget == null ? `${fmt(summary.yesterday.invoices)} factures` : `Cible ${euro(summary.yesterday.revenueTarget)} · ${signed(summary.yesterday.revenue - summary.yesterday.revenueTarget, " €")}`, dayRevenueRatio);
  kpiCard(ctx, 1094, 198, 548, 168, TEAL, "Stock fin de journée", `${fmt(summary.yesterday.stock)} VO`, `${fmt(summary.yesterday.over15)} > 15 j · ${fmt(summary.yesterday.over20)} > 20 j`, null);

  kpiCard(ctx, 42, 390, 500, 168, BLUE, "Sorties depuis le 1er", `${fmt(summary.month.exits)} VOP`, summary.month.exitTarget == null ? "Objectif à date non configuré" : `Attendus ${fmt(summary.month.exitTarget)} · ${signed(summary.month.exitDelta, " VOP")}`, monthExitRatio);
  kpiCard(ctx, 568, 390, 500, 168, summary.month.revenueDelta != null && summary.month.revenueDelta >= 0 ? TEAL : RED, "CA depuis le 1er", euro(summary.month.revenue), summary.month.revenueTargetAtDate == null ? `${fmt(summary.month.invoices)} factures` : `Trajectoire ${euro(summary.month.revenueTargetAtDate)} · ${signed(summary.month.revenueDelta, " €")}`, monthRevenueRatio);
  kpiCard(ctx, 1094, 390, 548, 168, YELLOW, "Avancement CA mensuel", monthTargetPct == null ? "—" : pct(monthTargetPct), summary.month.revenueMonthlyTarget == null ? `FRE ${summary.month.fre == null ? "—" : euro(summary.month.fre)}` : `Objectif mois ${euro(summary.month.revenueMonthlyTarget)} · FRE ${summary.month.fre == null ? "—" : euro(summary.month.fre)}`, monthTargetPct == null ? null : monthTargetPct / 100);

  ctx.fillStyle = INK;
  ctx.font = '800 italic 27px "Exo", Arial, sans-serif';
  ctx.fillText("PRODUCTION ATELIERS - VEILLE", 42, 620);
  ctx.fillStyle = MUTED;
  ctx.font = '600 16px "Exo", Arial, sans-serif';
  ctx.fillText("Véhicules terminés par étape", 42, 647);

  const production = summary.yesterday.production.slice(0, 6);
  const gap = 16;
  const totalWidth = 1600;
  const cellWidth = (totalWidth - gap * 5) / 6;
  production.forEach((item, index) => {
    const x = 42 + index * (cellWidth + gap);
    rounded(ctx, x, 674, cellWidth, 126, 18);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = `${item.color || BLUE}5f`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = item.color || BLUE;
    ctx.fillRect(x, 674, 7, 126);
    ctx.fillStyle = INK;
    ctx.font = '800 italic 34px "Exo", Arial, sans-serif';
    ctx.fillText(fmt(item.value), x + 26, 727);
    ctx.fillStyle = MUTED;
    ctx.font = '700 15px "Exo", Arial, sans-serif';
    wrap(ctx, item.label, x + 26, 761, cellWidth - 46, 19, 2);
  });

  const panelY = 836;
  rounded(ctx, 42, panelY, 1600, 266, 24);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = st.color;
  ctx.fillRect(42, panelY, 10, 266);

  ctx.fillStyle = INK;
  ctx.font = '800 italic 27px "Exo", Arial, sans-serif';
  ctx.fillText("FOCUS DU JOUR", 76, panelY + 43);
  ctx.fillStyle = MUTED;
  ctx.font = '600 15px "Exo", Arial, sans-serif';
  ctx.fillText(st.text, 76, panelY + 70);

  const bullets: string[] = [];
  const bottleneck = summary.pilotage.criticalBottleneck;
  if (bottleneck?.label && Number(bottleneck.over) > 0) bullets.push(`${bottleneck.label} : ${fmt(bottleneck.actual)} dossiers / seuil ${fmt(bottleneck.max)}`);
  if (summary.pilotage.urgents > 0) bullets.push(`${fmt(summary.pilotage.urgents)} urgents à sécuriser`);
  if (summary.pilotage.qualityAlerts > 0) bullets.push(`${fmt(summary.pilotage.qualityAlerts)} alertes NC à traiter`);
  if (Number(summary.pilotage.currentOver20) > 0) bullets.push(`${fmt(summary.pilotage.currentOver20)} véhicules à plus de 20 jours`);
  if (!bullets.length) bullets.push("Aucun signal critique majeur détecté sur le pilotage du jour.");

  ctx.font = '700 18px "Exo", Arial, sans-serif';
  bullets.slice(0, 4).forEach((line, index) => {
    const yy = panelY + 112 + index * 34;
    ctx.fillStyle = index === 0 && bottleneck?.label ? RED : BLUE;
    ctx.beginPath();
    ctx.arc(84, yy - 5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(line, 103, yy);
  });

  ctx.fillStyle = "#eef7fc";
  rounded(ctx, 910, panelY + 92, 676, 126, 20);
  ctx.fill();
  ctx.fillStyle = CYAN;
  ctx.fillRect(910, panelY + 92, 7, 126);
  ctx.fillStyle = BLUE;
  ctx.font = '800 italic 19px "Exo", Arial, sans-serif';
  ctx.fillText("MESSAGE D'ANIMATION", 940, panelY + 124);
  ctx.fillStyle = INK;
  ctx.font = '700 18px "Exo", Arial, sans-serif';
  wrap(ctx, focusText(summary), 940, panelY + 158, 610, 26, 3);

  ctx.fillStyle = MUTED;
  ctx.font = '600 13px "Exo", Arial, sans-serif';
  const financeDate = summary.sources?.financeAsOfDate ? `CA arrêté au ${displayDate(summary.sources.financeAsOfDate)} · ` : "";
  ctx.fillText(`Sources certifiées : ${financeDate}FTP CRVO · EtatduParc · Reporting factures · Objectifs KPI`, 42, 1153);
  ctx.textAlign = "right";
  ctx.fillText(`Généré ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}`, 1642, 1153);
  ctx.textAlign = "left";

  const jpegBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Rendu PDF impossible.")), "image/jpeg", .96));
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = jpegPdf(jpeg, canvas.width, canvas.height);
  const filename = `CRVO_${summary.centre}_Animation_${summary.reportDate}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new File([pdf], filename, { type: "application/pdf" });
}
