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
    photos?: number | null;
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
    currentOver15?: number | null;
    currentOver20: number | null;
    criticalBottleneck: { key?: string; label?: string; actual?: number; max?: number | null; over?: number | null } | null;
    oldestToExit?: Array<{
      registration?: string | null;
      workOrder?: string | null;
      model?: string | null;
      status?: string | null;
      ageDays?: number | null;
      urgency?: string | null;
      alert?: string | null;
    }>;
  };
  sources?: { financeAsOfDate?: string | null };
};

const BLUE = "#004f9f";
const CYAN = "#009edb";
const YELLOW = "#fec82f";
const RED = "#eb5b56";
const TEAL = "#47b9b4";
const PURPLE = "#9254c8";
const ORANGE = "#d87900";
const INK = "#0a3157";
const MUTED = "#68849b";
const PALE = "#f5f9fc";
const LINE = "#d9e6ee";

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
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
function displayDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius = 20) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 2) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let row = 0;
  for (let i = 0; i < words.length; i += 1) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (line && ctx.measureText(test).width > maxWidth) {
      ctx.fillText(line, x, y + row * lineHeight);
      row += 1;
      line = words[i];
      if (row >= maxLines - 1) {
        let rest = [line, ...words.slice(i + 1)].join(" ");
        while (rest.length > 3 && ctx.measureText(`${rest}…`).width > maxWidth) rest = rest.slice(0, -1);
        ctx.fillText(`${rest}…`, x, y + row * lineHeight);
        return;
      }
    } else line = test;
  }
  if (line && row < maxLines) ctx.fillText(line, x, y + row * lineHeight);
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
  for (const part of parts) { out.set(part, offset); offset += part.length; }
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
    concat([enc.encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, enc.encode("\nendstream\nendobj\n")]),
    enc.encode(`5 0 obj\n<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`),
  ];
  const header = enc.encode("%PDF-1.4\n%CRVO\n");
  const offsets = [0];
  let cursor = header.length;
  for (let i = 1; i < objects.length; i += 1) { offsets[i] = cursor; cursor += objects[i].length; }
  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Blob([concat([header, ...objects.slice(1), enc.encode(xref), enc.encode(trailer)])], { type: "application/pdf" });
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string, label: string, value: string, detail: string, ratio?: number | null) {
  ctx.save();
  ctx.shadowColor = "rgba(0,49,86,.07)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  rounded(ctx, x, y, w, h, 18); ctx.fillStyle = "#fff"; ctx.fill();
  ctx.shadowColor = "transparent";
  rounded(ctx, x, y, 7, h, 4); ctx.fillStyle = accent; ctx.fill();
  ctx.fillStyle = MUTED; ctx.font = '800 14px "Exo", Arial, sans-serif'; ctx.fillText(label.toUpperCase(), x + 25, y + 27);
  ctx.fillStyle = INK; ctx.font = '800 italic 34px "Exo", Arial, sans-serif'; ctx.fillText(value, x + 25, y + 67);
  ctx.fillStyle = MUTED; ctx.font = '600 13px "Exo", Arial, sans-serif'; wrap(ctx, detail, x + 25, y + 91, w - 50, 17, 2);
  if (ratio != null && Number.isFinite(ratio)) {
    const r = Math.max(0, Math.min(Number(ratio), 1));
    rounded(ctx, x + 25, y + h - 18, w - 50, 6, 3); ctx.fillStyle = "#e7eff4"; ctx.fill();
    rounded(ctx, x + 25, y + h - 18, (w - 50) * r, 6, 3); ctx.fillStyle = Number(ratio) >= 1 ? TEAL : Number(ratio) >= .95 ? YELLOW : RED; ctx.fill();
  }
  ctx.restore();
}

function focusItems(summary: DailyAnimationPdfSummary) {
  const rows: Array<{ text: string; color: string }> = [];
  const b = summary.pilotage.criticalBottleneck;
  if (b?.label && num(b.over) > 0) rows.push({ text: `${b.label} : ${fmt(b.actual)} dossiers / seuil ${fmt(b.max)}`, color: RED });
  if (num(summary.pilotage.urgents) > 0) rows.push({ text: `${fmt(summary.pilotage.urgents)} urgents à sécuriser`, color: BLUE });
  if (num(summary.pilotage.qualityAlerts) > 0) rows.push({ text: `${fmt(summary.pilotage.qualityAlerts)} alertes NC à traiter`, color: CYAN });
  if (num(summary.pilotage.currentOver20) > 0) rows.push({ text: `${fmt(summary.pilotage.currentOver20)} véhicules à plus de 20 jours`, color: ORANGE });
  if (!rows.length) rows.push({ text: "Flux sous contrôle : maintenir FIFO, urgents et qualité.", color: TEAL });
  return rows.slice(0, 5);
}

export async function createDailyAnimationPdf(summary: DailyAnimationPdfSummary) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1684;
  canvas.height = 1191;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Moteur PDF indisponible.");

  ctx.fillStyle = PALE; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = BLUE; ctx.fillRect(0, 0, canvas.width, 13);
  ctx.fillStyle = CYAN; ctx.fillRect(0, 13, canvas.width, 5);

  rounded(ctx, 42, 40, 1600, 112, 26); ctx.fillStyle = "#fff"; ctx.fill();
  try {
    const logo = await loadImage("/crvo-logo.png");
    const h = 58; ctx.drawImage(logo, 68, 67, h * (logo.naturalWidth / logo.naturalHeight), h);
  } catch {
    ctx.fillStyle = BLUE; ctx.font = '800 italic 48px "Exo", Arial, sans-serif'; ctx.fillText("CRVO", 68, 110);
  }
  ctx.fillStyle = INK; ctx.font = '800 italic 38px "Exo", Arial, sans-serif'; ctx.fillText("ANIMATION QUOTIDIENNE", 360, 88);
  ctx.fillStyle = MUTED; ctx.font = '600 18px "Exo", Arial, sans-serif'; ctx.fillText(`CRVO ${summary.centre} · Résultats du ${displayDate(summary.reportDate)}`, 362, 119);
  ctx.textAlign = "right"; ctx.fillStyle = BLUE; ctx.font = '800 15px "Exo", Arial, sans-serif'; ctx.fillText("SYNTHÈSE OPÉRATIONNELLE", 1608, 88);
  ctx.fillStyle = MUTED; ctx.font = '600 13px "Exo", Arial, sans-serif'; ctx.fillText("Veille · mois · parc · dossiers prioritaires", 1608, 114); ctx.textAlign = "left";

  const colW = 382, gap = 18;
  const xs = [42, 42 + colW + gap, 42 + (colW + gap) * 2, 42 + (colW + gap) * 3];
  const topGap = 18;
  const topW = (1600 - topGap * 2) / 3;
  const topXs = [42, 42 + topW + topGap, 42 + (topW + topGap) * 2];
  const dayExitRatio = summary.yesterday.exitTarget ? summary.yesterday.exits / summary.yesterday.exitTarget : null;
  const dayRevenueRatio = summary.yesterday.revenueTarget ? summary.yesterday.revenue / summary.yesterday.revenueTarget : null;
  const monthExitRatio = summary.month.exitTarget ? summary.month.exits / summary.month.exitTarget : null;
  const monthRevenueRatio = summary.month.revenueTargetAtDate ? summary.month.revenue / summary.month.revenueTargetAtDate : null;
  const caPct = summary.month.revenueMonthlyTarget ? summary.month.revenue / summary.month.revenueMonthlyTarget : null;

  card(ctx, topXs[0], 174, topW, 124, CYAN, "Entrées veille", `${fmt(summary.yesterday.entries)} VO`, "véhicules réceptionnés", null);
  card(ctx, topXs[1], 174, topW, 124, BLUE, "Sorties veille", `${fmt(summary.yesterday.exits)} VOP`, summary.yesterday.exitTarget == null ? "objectif journalier non configuré" : `objectif ${fmt(summary.yesterday.exitTarget)} · ${signed(summary.yesterday.exits - summary.yesterday.exitTarget, " VOP")}`, dayExitRatio);
  card(ctx, topXs[2], 174, topW, 124, TEAL, "CA veille", euro(summary.yesterday.revenue), summary.yesterday.revenueTarget == null ? `${fmt(summary.yesterday.invoices)} factures` : `cible ${euro(summary.yesterday.revenueTarget)} · ${signed(summary.yesterday.revenue - summary.yesterday.revenueTarget, " €")}`, dayRevenueRatio);

  card(ctx, xs[0], 316, colW, 124, CYAN, "Entrées depuis le 1er", `${fmt(summary.month.entries)} VO`, "réceptions cumulées du mois", null);
  card(ctx, xs[1], 316, colW, 124, BLUE, "Sorties depuis le 1er", `${fmt(summary.month.exits)} VOP`, summary.month.exitTarget == null ? "objectif à date non configuré" : `attendus ${fmt(summary.month.exitTarget)} · ${signed(summary.month.exitDelta, " VOP")}`, monthExitRatio);
  card(ctx, xs[2], 316, colW, 124, RED, "CA depuis le 1er", euro(summary.month.revenue), summary.month.revenueTargetAtDate == null ? "trajectoire à date non configurée" : `trajectoire ${euro(summary.month.revenueTargetAtDate)} · ${signed(summary.month.revenueDelta, " €")}`, monthRevenueRatio);
  card(ctx, xs[3], 316, colW, 124, YELLOW, "Avancement CA mensuel", caPct == null ? "—" : `${fmt(caPct * 100)} %`, `objectif ${euro(summary.month.revenueMonthlyTarget)} · FRE ${summary.month.fre == null ? "—" : euro(summary.month.fre)}`, caPct);

  ctx.fillStyle = INK; ctx.font = '800 italic 25px "Exo", Arial, sans-serif'; ctx.fillText("PRODUCTION ATELIERS · VEILLE", 42, 483);
  ctx.fillStyle = MUTED; ctx.font = '600 13px "Exo", Arial, sans-serif'; ctx.fillText("Véhicules terminés par étape · passages Photo", 42, 506);
  const prod: Array<{ key: string; label: string; value: number | null; color: string }> = [
    ...summary.yesterday.production.slice(0, 6).map((item) => ({ ...item, value: item.value as number | null })),
    { key: "photos", label: "Photos", value: summary.yesterday.photos ?? null, color: PURPLE },
  ];
  const prodGap = 10;
  const prodW = (1600 - prodGap * (prod.length - 1)) / prod.length;
  prod.forEach((item, i) => {
    const x = 42 + i * (prodW + prodGap);
    rounded(ctx, x, 524, prodW, 84, 14); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = item.color || BLUE; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = item.color || BLUE; ctx.fillRect(x, 524, 5, 84);
    ctx.fillStyle = INK; ctx.font = '800 italic 27px "Exo", Arial, sans-serif'; ctx.fillText(item.value == null ? "—" : fmt(item.value), x + 18, 560);
    ctx.fillStyle = MUTED; ctx.font = '700 11px "Exo", Arial, sans-serif'; ctx.fillText(item.label, x + 18, 585);
  });

  const lowerY = 632, lowerH = 292;
  rounded(ctx, 42, lowerY, 535, lowerH, 20); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = BLUE; ctx.fillRect(42, lowerY, 7, lowerH);
  ctx.fillStyle = INK; ctx.font = '800 italic 24px "Exo", Arial, sans-serif'; ctx.fillText("FOCUS DU JOUR", 72, lowerY + 40);
  ctx.fillStyle = MUTED; ctx.font = '600 13px "Exo", Arial, sans-serif'; ctx.fillText("Priorités opérationnelles issues du KPI", 72, lowerY + 63);
  focusItems(summary).forEach((item, index) => {
    const y = lowerY + 102 + index * 39;
    ctx.beginPath(); ctx.arc(82, y - 5, 5, 0, Math.PI * 2); ctx.fillStyle = item.color; ctx.fill();
    ctx.fillStyle = INK; ctx.font = '700 15px "Exo", Arial, sans-serif'; wrap(ctx, item.text, 100, y, 440, 18, 2);
  });

  rounded(ctx, 595, lowerY, 1047, lowerH, 20); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = LINE; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = '800 italic 24px "Exo", Arial, sans-serif'; ctx.fillText("10 PLUS VIEUX DOSSIERS À SORTIR", 622, lowerY + 40);
  ctx.fillStyle = MUTED; ctx.font = '600 13px "Exo", Arial, sans-serif'; ctx.fillText("Parc usine actif · VOP EFF / VOP EXT · priorité vieillissement", 622, lowerY + 63);
  const oldest = (summary.pilotage.oldestToExit ?? []).filter((vehicle) => String(vehicle.registration ?? "").trim().toUpperCase() !== "GJ780RF");
  if (!oldest.length) {
    ctx.fillStyle = MUTED; ctx.font = '600 16px "Exo", Arial, sans-serif'; ctx.fillText("Liste des dossiers vieillissants indisponible.", 622, lowerY + 118);
  } else {
    oldest.slice(0, 10).forEach((vehicle, index) => {
      const col = index < 5 ? 0 : 1;
      const row = index % 5;
      const x = 622 + col * 500;
      const y = lowerY + 91 + row * 38;
      const urgent = String(vehicle.urgency ?? "").toLowerCase().includes("oui") || String(vehicle.alert ?? "").toLowerCase().includes("urgence");
      ctx.beginPath(); ctx.arc(x + 10, y + 4, 11, 0, Math.PI * 2); ctx.fillStyle = urgent ? RED : BLUE; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = '800 10px "Exo", Arial, sans-serif'; ctx.textAlign = "center"; ctx.fillText(String(index + 1), x + 10, y + 8); ctx.textAlign = "left";
      ctx.fillStyle = INK; ctx.font = '800 13px "Exo", Arial, sans-serif'; ctx.fillText(`${vehicle.registration || "—"} · OR ${vehicle.workOrder || "—"}`, x + 31, y + 2);
      ctx.fillStyle = urgent ? RED : ORANGE; ctx.font = '800 13px "Exo", Arial, sans-serif'; ctx.textAlign = "right"; ctx.fillText(`J+${fmt(vehicle.ageDays)}`, x + 474, y + 2); ctx.textAlign = "left";
      ctx.fillStyle = MUTED; ctx.font = '600 10px "Exo", Arial, sans-serif';
      const status = `${vehicle.status || "Statut non renseigné"}${vehicle.model ? ` · ${vehicle.model}` : ""}`;
      wrap(ctx, status, x + 31, y + 18, 420, 13, 1);
    });
  }

  const stock = Math.max(0, num(summary.pilotage.currentStock ?? summary.yesterday.stock));
  const over15 = Math.max(0, num(summary.pilotage.currentOver15 ?? summary.yesterday.over15));
  const over20 = Math.max(0, num(summary.pilotage.currentOver20 ?? summary.yesterday.over20));
  const age21 = Math.min(stock, over20);
  const age16 = Math.max(0, Math.min(stock - age21, over15 - over20));
  const age0 = Math.max(0, stock - age16 - age21);
  const agingY = 946;
  rounded(ctx, 42, agingY, 1600, 184, 20); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = LINE; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = '800 italic 23px "Exo", Arial, sans-serif'; ctx.fillText("POIDS DU PARC EN VIEILLISSEMENT", 70, agingY + 38);
  ctx.fillStyle = MUTED; ctx.font = '600 13px "Exo", Arial, sans-serif'; ctx.fillText(`Stock usine actif : ${fmt(stock)} véhicules`, 70, agingY + 60);

  const barX = 70, barY = agingY + 78, barW = 1544, barH = 42;
  rounded(ctx, barX, barY, barW, barH, 12); ctx.fillStyle = "#e8f0f4"; ctx.fill();
  let cursor = barX;
  const segments = [
    { label: "0–15 jours", value: age0, color: TEAL },
    { label: "16–20 jours", value: age16, color: YELLOW },
    { label: "21 jours et +", value: age21, color: RED },
  ];
  segments.forEach((segment) => {
    if (!stock || segment.value <= 0) return;
    const width = barW * segment.value / stock;
    ctx.fillStyle = segment.color; ctx.fillRect(cursor, barY, width, barH);
    if (width > 100) {
      ctx.fillStyle = segment.color === YELLOW ? "#624b00" : "#fff";
      ctx.font = '800 14px "Exo", Arial, sans-serif'; ctx.textAlign = "center"; ctx.fillText(`${fmt(segment.value)} · ${fmt(segment.value / stock * 100)}%`, cursor + width / 2, barY + 26); ctx.textAlign = "left";
    }
    cursor += width;
  });

  segments.forEach((segment, index) => {
    const x = 72 + index * 510;
    ctx.beginPath(); ctx.arc(x + 5, agingY + 151, 6, 0, Math.PI * 2); ctx.fillStyle = segment.color; ctx.fill();
    ctx.fillStyle = INK; ctx.font = '800 13px "Exo", Arial, sans-serif'; ctx.fillText(segment.label, x + 20, agingY + 156);
    ctx.fillStyle = MUTED; ctx.font = '700 12px "Exo", Arial, sans-serif'; ctx.fillText(`${fmt(segment.value)} VO · ${stock ? fmt(segment.value / stock * 100) : "0"}% du parc`, x + 160, agingY + 156);
  });

  ctx.fillStyle = MUTED; ctx.font = '600 10px "Exo", Arial, sans-serif';
  ctx.fillText("Sources certifiées KPI CRVO · Factory FTP · EtatduParc · Reporting factures · Objectifs KPI", 44, 1166);
  ctx.textAlign = "right"; ctx.fillText(`Généré ${new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date())}`, 1640, 1166); ctx.textAlign = "left";

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  const raw = atob(dataUrl.split(",")[1]);
  const jpeg = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) jpeg[i] = raw.charCodeAt(i);
  const blob = jpegPdf(jpeg, canvas.width, canvas.height);
  return new File([blob], `CRVO_${summary.centre.replace(/[^a-zA-Z0-9_-]+/g, "_")}_Animation_${summary.reportDate}.pdf`, { type: "application/pdf" });
}
