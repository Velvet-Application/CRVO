"use client";

export type TransphereTrend = {
  date: string;
  entries: number;
  exits: number;
  total: number;
  objective: number;
  cumulative: number;
  cumulativeObjective: number;
  serviceHours: number;
  fuelLPer100: number | null;
};

export type TransphereSummary = {
  reportDate: string;
  sourceFile?: string;
  day: {
    entries: number;
    exits: number;
    total: number;
    objective: number;
    delta: number;
    achievement: number | null;
    serviceHours: number;
    fuelLPer100: number | null;
  };
  monthToDate: {
    entries: number;
    exits: number;
    total: number;
    objectiveAtDate: number;
    delta: number;
    achievementAtDate: number | null;
    monthlyTarget: number;
    monthlyProgress: number | null;
    remainingToTarget: number;
    serviceHours: number;
    averageFuelLPer100: number | null;
    workedDays: number;
    averageDaily: number | null;
  };
  trend: TransphereTrend[];
};

const BLUE = "#0055a5";
const DARK = "#003a78";
const TEAL = "#0aa99f";
const CYAN = "#00a7d7";
const YELLOW = "#fec82f";
const RED = "#eb5b56";
const INK = "#092f55";
const MUTED = "#6c8499";
const PALE = "#f3f8fb";
const LINE = "#d9e6ee";

function fmt(value: unknown, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n) : "—";
}
function signed(value: unknown, suffix = "") {
  const n = Number(value);
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${fmt(n)}${suffix}` : "—";
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}
function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);
}
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius = 18) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
}
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`Image ${src} indisponible`)); image.src = src; });
}
function concat(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(length); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
}
function jpegPdf(jpeg: Uint8Array, width: number, height: number) {
  const enc = new TextEncoder(); const pageW = 841.89; const pageH = 595.28; const stream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  const objects: Uint8Array[] = [new Uint8Array(), enc.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"), enc.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"), enc.encode(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`), concat([enc.encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, enc.encode("\nendstream\nendobj\n")]), enc.encode(`5 0 obj\n<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`)];
  const header = enc.encode("%PDF-1.4\n%TRANSPHERE\n"); const offsets = [0]; let cursor = header.length; for (let i = 1; i < objects.length; i += 1) { offsets[i] = cursor; cursor += objects[i].length; } const xrefStart = cursor; let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`; for (let i = 1; i < objects.length; i += 1) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`; const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`; return new Blob([concat([header, ...objects.slice(1), enc.encode(xref), enc.encode(trailer)])], { type: "application/pdf" });
}
function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string, label: string, value: string, detail: string, ratio?: number | null) {
  ctx.save(); ctx.shadowColor = "rgba(0,45,85,.07)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5; rounded(ctx, x, y, w, h); ctx.fillStyle = "#fff"; ctx.fill(); ctx.shadowColor = "transparent"; rounded(ctx, x, y, 7, h, 4); ctx.fillStyle = accent; ctx.fill(); ctx.fillStyle = MUTED; ctx.font = '800 13px "Exo",Arial,sans-serif'; ctx.fillText(label.toUpperCase(), x + 24, y + 27); ctx.fillStyle = INK; ctx.font = '800 italic 34px "Exo",Arial,sans-serif'; ctx.fillText(value, x + 24, y + 67); ctx.fillStyle = MUTED; ctx.font = '600 12px "Exo",Arial,sans-serif'; ctx.fillText(detail, x + 24, y + 93); if (ratio != null && Number.isFinite(ratio)) { const r = Math.max(0, Math.min(ratio, 1)); rounded(ctx, x + 24, y + h - 17, w - 48, 6, 3); ctx.fillStyle = "#e8eff4"; ctx.fill(); rounded(ctx, x + 24, y + h - 17, (w - 48) * r, 6, 3); ctx.fillStyle = ratio >= 1 ? TEAL : ratio >= .9 ? YELLOW : RED; ctx.fill(); } ctx.restore();
}
function lineChart(ctx: CanvasRenderingContext2D, trend: TransphereTrend[], x: number, y: number, w: number, h: number) {
  rounded(ctx, x, y, w, h, 20); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = '800 italic 21px "Exo",Arial,sans-serif'; ctx.fillText("TRAJECTOIRE MENSUELLE", x + 24, y + 36); ctx.fillStyle = MUTED; ctx.font = '600 12px "Exo",Arial,sans-serif'; ctx.fillText("Cumul transports réalisés vs objectif cumulé", x + 24, y + 58);
  if (trend.length < 2) return;
  const px = x + 35, py = y + 82, pw = w - 70, ph = h - 120; const max = Math.max(...trend.flatMap((r) => [r.cumulative, r.cumulativeObjective]), 1);
  ctx.strokeStyle = "#e7eef3"; ctx.lineWidth = 1; for (let i = 0; i <= 4; i += 1) { const gy = py + ph * i / 4; ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + pw, gy); ctx.stroke(); }
  const draw = (key: "cumulative" | "cumulativeObjective", color: string, dashed = false) => { ctx.beginPath(); trend.forEach((r, i) => { const xx = px + pw * i / Math.max(1, trend.length - 1); const yy = py + ph - ph * Number(r[key]) / max; if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }); ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.setLineDash(dashed ? [10, 8] : []); ctx.stroke(); ctx.setLineDash([]); };
  draw("cumulative", BLUE); draw("cumulativeObjective", YELLOW, true);
  ctx.fillStyle = BLUE; ctx.fillRect(x + w - 270, y + 27, 18, 5); ctx.fillStyle = MUTED; ctx.font = '700 11px "Exo",Arial,sans-serif'; ctx.fillText("Réalisé", x + w - 245, y + 34); ctx.fillStyle = YELLOW; ctx.fillRect(x + w - 160, y + 27, 18, 5); ctx.fillStyle = MUTED; ctx.fillText("Objectif", x + w - 135, y + 34);
  ctx.fillStyle = MUTED; ctx.font = '600 10px "Exo",Arial,sans-serif'; const picks = [0, Math.floor((trend.length - 1) / 2), trend.length - 1]; picks.forEach((index) => { const xx = px + pw * index / Math.max(1, trend.length - 1); ctx.textAlign = index === 0 ? "left" : index === trend.length - 1 ? "right" : "center"; ctx.fillText(shortDate(trend[index].date), xx, y + h - 18); }); ctx.textAlign = "left";
}

export async function createTransphereDailyPdf(summary: TransphereSummary) {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1684; canvas.height = 1191; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Moteur PDF indisponible.");
  ctx.fillStyle = PALE; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = BLUE; ctx.fillRect(0, 0, canvas.width, 12); ctx.fillStyle = TEAL; ctx.fillRect(0, 12, canvas.width, 5);
  rounded(ctx, 42, 38, 1600, 122, 24); ctx.fillStyle = "#fff"; ctx.fill();
  try { const logo = await loadImage("/transphere-logo.svg"); ctx.drawImage(logo, 65, 56, 220, 86); } catch { ctx.fillStyle = BLUE; ctx.font = '800 italic 42px "Exo",Arial,sans-serif'; ctx.fillText("TRANSPHERE", 65, 110); }
  ctx.fillStyle = INK; ctx.font = '800 italic 38px "Exo",Arial,sans-serif'; ctx.fillText("REPORTING QUOTIDIEN", 345, 87); ctx.fillStyle = MUTED; ctx.font = '600 17px "Exo",Arial,sans-serif'; ctx.fillText(`Transphère Lens · Journée du ${dateLabel(summary.reportDate)}`, 347, 119); ctx.textAlign = "right"; ctx.fillStyle = TEAL; ctx.font = '800 14px "Exo",Arial,sans-serif'; ctx.fillText("TRANSPORTS · FLUX · SERVICE · CARBURANT", 1607, 88); ctx.fillStyle = MUTED; ctx.font = '600 12px "Exo",Arial,sans-serif'; ctx.fillText("Synthèse issue du Book Transphère", 1607, 116); ctx.textAlign = "left";

  const gap = 16, w = (1600 - gap * 4) / 5; const xs = Array.from({ length: 5 }, (_, i) => 42 + i * (w + gap));
  card(ctx, xs[0], 182, w, 126, BLUE, "Transports veille", `${fmt(summary.day.total)} VO`, `objectif ${fmt(summary.day.objective)} · ${signed(summary.day.delta, " VO")}`, summary.day.objective ? summary.day.total / summary.day.objective : null);
  card(ctx, xs[1], 182, w, 126, TEAL, "Entrées", `${fmt(summary.day.entries)} VO`, "PdV → CRVO", null);
  card(ctx, xs[2], 182, w, 126, CYAN, "Sorties", `${fmt(summary.day.exits)} VO`, "CRVO → PdV", null);
  card(ctx, xs[3], 182, w, 126, DARK, "Temps service", `${fmt(summary.day.serviceHours, 1)} h`, `cumul ${fmt(summary.monthToDate.serviceHours, 1)} h`, null);
  card(ctx, xs[4], 182, w, 126, YELLOW, "Conso", summary.day.fuelLPer100 == null ? "—" : `${fmt(summary.day.fuelLPer100, 1)} L/100`, `moyenne mois ${fmt(summary.monthToDate.averageFuelLPer100, 1)} L/100`, null);

  const gap2 = 18, w2 = (1600 - gap2 * 3) / 4; const xs2 = Array.from({ length: 4 }, (_, i) => 42 + i * (w2 + gap2));
  card(ctx, xs2[0], 326, w2, 126, BLUE, "Cumul réalisé", `${fmt(summary.monthToDate.total)} VO`, `${fmt(summary.monthToDate.entries)} entrées · ${fmt(summary.monthToDate.exits)} sorties`, null);
  card(ctx, xs2[1], 326, w2, 126, TEAL, "Objectif à date", `${fmt(summary.monthToDate.objectiveAtDate)} VO`, `${signed(summary.monthToDate.delta, " VO")} d'écart`, summary.monthToDate.objectiveAtDate ? summary.monthToDate.total / summary.monthToDate.objectiveAtDate : null);
  card(ctx, xs2[2], 326, w2, 126, YELLOW, "Réalisation vs trajectoire", summary.monthToDate.achievementAtDate == null ? "—" : `${fmt(summary.monthToDate.achievementAtDate, 1)} %`, `${fmt(summary.monthToDate.workedDays)} jours réalisés`, (summary.monthToDate.achievementAtDate ?? 0) / 100);
  card(ctx, xs2[3], 326, w2, 126, CYAN, "Objectif mensuel", `${fmt(summary.monthToDate.monthlyTarget)} VO`, `${fmt(summary.monthToDate.monthlyProgress, 1)} % réalisé · reste ${fmt(summary.monthToDate.remainingToTarget)}`, (summary.monthToDate.monthlyProgress ?? 0) / 100);

  lineChart(ctx, summary.trend, 42, 472, 1018, 360);
  rounded(ctx, 1078, 472, 564, 360, 20); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = LINE; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = '800 italic 22px "Exo",Arial,sans-serif'; ctx.fillText("LECTURE DU JOUR", 1104, 510);
  const ahead = summary.monthToDate.delta >= 0; const dayAhead = summary.day.delta >= 0;
  const message = ahead
    ? `La trajectoire mensuelle est en avance de ${fmt(summary.monthToDate.delta)} transports. ${dayAhead ? `La journée confirme la dynamique avec ${signed(summary.day.delta, " véhicule")}.` : `La journée est sous son objectif de ${fmt(Math.abs(summary.day.delta))} véhicules, sans remettre en cause l'avance cumulée.`}`
    : `La trajectoire mensuelle accuse un retard de ${fmt(Math.abs(summary.monthToDate.delta))} transports. Le pilotage doit sécuriser les rotations et la disponibilité chauffeurs pour reprendre l'objectif.`;
  ctx.fillStyle = ahead ? TEAL : RED; ctx.font = '800 17px "Exo",Arial,sans-serif'; ctx.fillText(ahead ? "DYNAMIQUE POSITIVE" : "TRAJECTOIRE À REPRENDRE", 1104, 548);
  ctx.fillStyle = MUTED; ctx.font = '600 15px "Exo",Arial,sans-serif'; const words = message.split(/\s+/); let line = "", yy = 584; for (const word of words) { const test = line ? `${line} ${word}` : word; if (ctx.measureText(test).width > 500) { ctx.fillText(line, 1104, yy); yy += 23; line = word; } else line = test; } if (line) ctx.fillText(line, 1104, yy);
  ctx.fillStyle = INK; ctx.font = '800 14px "Exo",Arial,sans-serif'; ctx.fillText("INDICATEURS DE RYTHME", 1104, 690); ctx.fillStyle = MUTED; ctx.font = '600 14px "Exo",Arial,sans-serif'; ctx.fillText(`Moyenne : ${fmt(summary.monthToDate.averageDaily, 1)} transports / jour`, 1104, 723); ctx.fillText(`Temps de service cumulé : ${fmt(summary.monthToDate.serviceHours, 1)} h`, 1104, 753); ctx.fillText(`Consommation moyenne : ${fmt(summary.monthToDate.averageFuelLPer100, 1)} L/100 km`, 1104, 783);

  rounded(ctx, 42, 854, 1600, 210, 20); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = LINE; ctx.stroke(); ctx.fillStyle = INK; ctx.font = '800 italic 22px "Exo",Arial,sans-serif'; ctx.fillText("JOURNÉES DU MOIS", 68, 892);
  const recent = summary.trend.slice(-8); const bw = (1544 - 14 * Math.max(0, recent.length - 1)) / Math.max(1, recent.length); recent.forEach((row, index) => { const x = 68 + index * (bw + 14); const ratio = row.objective ? row.total / row.objective : 0; rounded(ctx, x, 918, bw, 112, 14); ctx.fillStyle = "#f8fbfd"; ctx.fill(); ctx.fillStyle = ratio >= 1 ? TEAL : RED; ctx.font = '800 italic 25px "Exo",Arial,sans-serif'; ctx.fillText(fmt(row.total), x + 16, 954); ctx.fillStyle = INK; ctx.font = '800 11px "Exo",Arial,sans-serif'; ctx.fillText(shortDate(row.date), x + 16, 978); ctx.fillStyle = MUTED; ctx.font = '600 10px "Exo",Arial,sans-serif'; ctx.fillText(`${fmt(row.entries)} IN · ${fmt(row.exits)} OUT`, x + 16, 1000); ctx.fillText(`obj ${fmt(row.objective)} · ${fmt(ratio * 100)}%`, x + 16, 1019); });

  ctx.fillStyle = MUTED; ctx.font = '600 11px "Exo",Arial,sans-serif'; ctx.fillText(`Source : ${summary.sourceFile || "Book Transphère"}`, 42, 1128); ctx.textAlign = "right"; ctx.fillText("KPI CRVO · Environnement TRANSPHÈRE · reporting direction", 1642, 1128); ctx.textAlign = "left";

  const dataUrl = canvas.toDataURL("image/jpeg", .94); const binary = atob(dataUrl.split(",")[1]); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); const pdf = jpegPdf(bytes, canvas.width, canvas.height); return new File([pdf], `Book_TRANSPHERE_${summary.reportDate}.pdf`, { type: "application/pdf" });
}
