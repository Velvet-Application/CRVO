import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";
import { emailHtml, graphRecipient, signatureFor, signaturePlain, type MailRecipient } from "../../../lib/daily-animation-mail-config";

export const dynamic = "force-dynamic";

type Dashboard = {
  connected?: boolean;
  reportDate?: string;
  day?: { entries?: number; exits?: number; total?: number; objective?: number; delta?: number; achievement?: number | null; serviceHours?: number; fuelLPer100?: number | null };
  monthToDate?: { total?: number; objectiveAtDate?: number; delta?: number; achievementAtDate?: number | null; monthlyTarget?: number; monthlyProgress?: number | null; remainingToTarget?: number };
};

type PostBody = { bodyText?: string; subject?: string; filename?: string; pdfBase64?: string };

const TO: MailRecipient[] = [
  { name: "Thomas GESTIN", address: "thomas.gestin@crvo.fr" },
  { name: "Benoit PECQUEUR", address: "benoit.pecqueur@crvo.fr" },
  { name: "Cyril GAY", address: "cyril.gay@crvo.fr" },
  { name: "Mandy DUJARDIN", address: "mandy.dujardin@crvo.fr" },
  { name: "Baptiste CORBEAU", address: "baptiste.corbeau@crvo.fr" },
];

function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function n(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function fmt(value: unknown, digits = 0) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n(value)); }
function displayDate(value?: string | null) { if (!value) return "—"; const d = new Date(`${value}T12:00:00Z`); return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(d); }
function graphConfig() { const tenantId = process.env.MICROSOFT_TENANT_ID; const clientId = process.env.MICROSOFT_CLIENT_ID; const clientSecret = process.env.MICROSOFT_CLIENT_SECRET; const mailbox = process.env.MICROSOFT_OUTLOOK_MAILBOX; return tenantId && clientId && clientSecret && mailbox ? { tenantId, clientId, clientSecret, mailbox } : null; }
async function graphToken(config: NonNullable<ReturnType<typeof graphConfig>>) { const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }); const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" }); const payload = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string }; if (!response.ok || !payload.access_token) throw new Error(payload.error_description || `Microsoft OAuth ${response.status}`); return payload.access_token; }

function buildMail(summary: Dashboard) {
  const date = displayDate(summary.reportDate); const day = summary.day ?? {}; const month = summary.monthToDate ?? {};
  const ahead = n(month.delta) >= 0; const dayAhead = n(day.delta) >= 0;
  const lines = [
    "Bonjour tout le monde,",
    "",
    `Voici la synthèse Transphère de la journée du ${date}.`,
    "",
    `🎯 Objectif cumulé : ${fmt(month.objectiveAtDate)} transports`,
    `🚚 Réalisation : ${fmt(month.total)} transports · ${fmt(month.achievementAtDate, 1)} %`,
    `📈 Écart cumulé : ${n(month.delta) > 0 ? "+" : ""}${fmt(month.delta)} transports`,
    `🏁 Objectif mensuel : ${fmt(month.monthlyTarget)} transports · ${fmt(month.monthlyProgress, 1)} % déjà réalisé`,
    "",
    `Pour la journée du ${date} :`,
    `🛻 ${fmt(day.total)} véhicules convoyés pour un objectif de ${fmt(day.objective)}, soit ${n(day.delta) > 0 ? "+" : ""}${fmt(day.delta)}.`,
    `⬅️ ${fmt(day.entries)} entrées`,
    `➡️ ${fmt(day.exits)} sorties`,
    `⏱️ ${fmt(day.serviceHours, 1)} h de travail`,
    `⛽ ${day.fuelLPer100 == null ? "—" : `${fmt(day.fuelLPer100, 1)} L/100 km`}`,
    "",
    ahead
      ? `La dynamique mensuelle reste nettement en avance de ${fmt(month.delta)} transports. ${dayAhead ? "La journée confirme cette avance : on garde le rythme et la qualité d'exécution." : "La journée est sous sa cible, mais l'avance cumulée reste solide : il faut sécuriser les rotations prévues pour conserver la trajectoire."}`
      : `La trajectoire est en retrait de ${fmt(Math.abs(n(month.delta)))} transports. La priorité est de sécuriser les rotations et la disponibilité des chauffeurs pour reprendre l'objectif.`,
    "",
    "Bonne journée à tous,",
  ];
  return { subject: `🚚 Book TRANSPHERE - Journée du ${date} 🚚`, body: lines.join("\n"), to: TO };
}

export async function GET() {
  const current = await currentSession(); if (!current) return json({ error: "Session CRVO requise." }, 401); if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);
  try { const summary = await authRpc<Dashboard>("kpi_transphere_dashboard_admin", { p_session_hash: current.tokenHash, p_report_date: null }); const mail = buildMail(summary); const signature = signatureFor(current.session.username); return json({ ...mail, graphConfigured: Boolean(graphConfig()), signature: { name: signature.name, title: signature.title }, plainBody: `${mail.body}\n\n${signaturePlain(signature)}` }); } catch (error) { console.error("transphere_animation_get_failed", error); return json({ error: "Animation Transphère indisponible." }, 503); }
}

export async function POST(request: Request) {
  const current = await currentSession(); if (!current) return json({ error: "Session CRVO requise." }, 401); if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);
  const config = graphConfig(); if (!config) return json({ error: "Microsoft 365 non configuré.", graphConfigured: false }, 501);
  const body = await request.json().catch(() => null) as PostBody | null; const subject = String(body?.subject ?? "").slice(0, 240); const bodyText = String(body?.bodyText ?? "").slice(0, 20000); const filename = String(body?.filename ?? "Book_TRANSPHERE.pdf").replace(/[^a-zA-Z0-9._ -]/g, "_"); const pdfBase64 = String(body?.pdfBase64 ?? "").replace(/^data:application\/pdf;base64,/, ""); if (!subject || !bodyText || !pdfBase64) return json({ error: "Objet, texte ou PDF manquant." }, 400);
  try { const token = await graphToken(config); const signature = signatureFor(current.session.username); const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ subject, body: { contentType: "HTML", content: emailHtml(bodyText, signature) }, toRecipients: TO.map(graphRecipient), attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: filename, contentType: "application/pdf", contentBytes: pdfBase64 }] }), cache: "no-store" }); const created = await response.json().catch(() => ({})) as { id?: string; webLink?: string; error?: { message?: string } }; if (!response.ok || !created.id) throw new Error(created.error?.message || `Microsoft Graph ${response.status}`); let webLink = created.webLink; if (!webLink) { const read = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(created.id)}?$select=webLink`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const result = await read.json().catch(() => ({})) as { webLink?: string }; webLink = result.webLink; } return json({ ok: true, webLink: webLink || null }); } catch (error) { console.error("transphere_outlook_failed", error); return json({ error: error instanceof Error ? error.message : "Brouillon Outlook impossible." }, 502); }
}
