import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type ProductionItem = { key: string; label: string; value: number; color: string };
type AnimationSummary = {
  connected: boolean;
  centre?: string;
  reportDate?: string;
  generatedAt?: string;
  generatedBy?: string;
  error?: string;
  yesterday?: {
    entries?: number;
    exits?: number;
    exitTarget?: number | null;
    stock?: number;
    over15?: number;
    over20?: number;
    revenue?: number;
    revenueTarget?: number | null;
    invoices?: number;
    laborHours?: number;
    production?: ProductionItem[];
  };
  month?: {
    entries?: number;
    exits?: number;
    exitTarget?: number | null;
    exitDelta?: number | null;
    revenue?: number;
    revenueTargetAtDate?: number | null;
    revenueMonthlyTarget?: number | null;
    revenueDelta?: number | null;
    invoices?: number;
    fre?: number | null;
    laborHours?: number;
    hoursPerExit?: number | null;
    laborRevenue?: number;
    businessDaysElapsed?: number;
    businessDaysMonth?: number;
  };
  pilotage?: {
    tone?: "ahead" | "watch" | "alert";
    urgents?: number;
    qualityAlerts?: number;
    currentStock?: number | null;
    currentOver20?: number | null;
    criticalBottleneck?: { key?: string; label?: string; actual?: number; max?: number | null; over?: number | null } | null;
  };
  sources?: {
    operations?: string | null;
    finance?: string | null;
    financeAsOfDate?: string | null;
    objectives?: string | null;
    park?: string | null;
  };
};

type OutlookBody = {
  subject?: string;
  bodyText?: string;
  pdfBase64?: string;
  filename?: string;
};

type MailRecipient = { name: string; address: string };
type SignatureProfile = {
  key: "cyril" | "celine" | "direction";
  name: string;
  title: string;
  company: string;
  mobile?: string;
  email?: string;
};

const MAIL_FONT = '"Aptos Display","Aptos Display_EmbeddedFont","Aptos Display_MSFontService","Calibri Light","Helvetica Light",sans-serif';
const MAIL_COLOR = "#002451";

const TO_RECIPIENTS: MailRecipient[] = [
  { name: "Emeline BOULONNE", address: "emeline.boulonne@crvo.fr" },
  { name: "Cyril GAY", address: "cyril.gay@crvo.fr" },
  { name: "Benjamin BALINGON", address: "benjamin.balingon@crvo.fr" },
  { name: "Jean Francois PIASECKI", address: "jean-francois.piasecki@crvo.fr" },
  { name: "Laurence LAUDES", address: "laurence.laudes@crvo.fr" },
  { name: "Valérie GRONIER", address: "valerie.gronier@crvo.fr" },
  { name: "Vanessa COUVERT", address: "vanessa.couvert@crvo.fr" },
  { name: "Yves Marie THERON", address: "yves-marie.theron@crvo.fr" },
  { name: "Yohan VELLE", address: "yohan.velle@crvo.fr" },
  { name: "Audrey ATMANIA", address: "audrey.atmania@crvo.fr" },
  { name: "Christopher LEMORT", address: "christopher.lemort@crvo.fr" },
  { name: "Romuald LAURENT", address: "romuald.laurent@crvo.fr" },
  { name: "Johnny TRANAIN", address: "johnny.tranain@crvo.fr" },
  { name: "Frederic BARTCZAK", address: "frederic.bartczak@crvo.fr" },
  { name: "Geremy VELLE", address: "geremy.velle@crvo.fr" },
  { name: "Ludovic DUMONT", address: "ludovic.dumont@crvo.fr" },
  { name: "Anthony MARMUSE", address: "anthony.marmuse@crvo.fr" },
  { name: "Jeffrey COILLOT", address: "jeffrey.coillot@crvo.fr" },
  { name: "Jean Francois COLAERT", address: "jean-francois.colaert@crvo.fr" },
  { name: "Vincent DYNOWSKI", address: "vincent.dynowski@crvo.fr" },
  { name: "Lucie DEGARDIN", address: "lucie.degardin@crvo.fr" },
  { name: "Stacy MUSIOL", address: "stacy.musiol@crvo.fr" },
  { name: "Vanessa LEGRAND", address: "vanessa.legrand@crvo.fr" },
  { name: "Guillaume GOUILLIART", address: "guillaume.gouilliart@crvo.fr" },
  { name: "Morgane LOPES", address: "morgane.lopes@crvo.fr" },
  { name: "Alexandre FOURNIER", address: "alexandre.fournier@crvo.fr" },
  { name: "Giovanny CAVROIS", address: "giovanny.cavrois@crvo.fr" },
  { name: "Julien LEMAIRE", address: "julien.lemaire1@crvo.fr" },
  { name: "Sarah OLIVIER", address: "sarah.olivier@crvo.fr" },
  { name: "Geoffrey CAMBIEN", address: "geoffrey.cambien@crvo.fr" },
  { name: "Allan BONNAILLIE", address: "allan.bonnaillie@crvo.fr" },
  { name: "Quentin PEYRARD", address: "quentin.peyrard@crvo.fr" },
  { name: "Tifany LHOMME", address: "tifany.lhomme@crvo.fr" },
  { name: "Steven DESTUNDER", address: "steven.destunder@crvo.fr" },
  { name: "Thomas GESTIN", address: "thomas.gestin@crvo.fr" },
  { name: "Anthony SPREUX", address: "anthony.spreux@crvo.fr" },
  { name: "Mandy DUJARDIN", address: "mandy.dujardin@crvo.fr" },
  { name: "Jordan CLABAUT", address: "jordan.clabaut@crvo.fr" },
  { name: "Julie BECQUAERT", address: "julie.becquaert@crvo.fr" },
  { name: "Baptiste CORBEAU", address: "baptiste.corbeau@crvo.fr" },
  { name: "Corentin ARZU", address: "corentin.arzu@crvo.fr" },
  { name: "Karine HOURDE", address: "karine.hourde@crvo.fr" },
  { name: "Sarah PIETSZYKOWSKI", address: "sarah.pietszykowski@crvo.fr" },
  { name: "Leslie DANEL", address: "leslie.danel@crvo.fr" },
  { name: "Baptiste CADART", address: "baptiste.cadart@crvo.fr" },
  { name: "Séverine VERITE", address: "severine.verite@crvo.fr" },
  { name: "Dan DURAND", address: "dan.durand@crvo.fr" },
  { name: "Jessy LECOINTE", address: "jessy.lecointe@crvo.fr" },
  { name: "Inès MORTREUX", address: "ines.mortreux@crvo.fr" },
  { name: "Fabien GRONUS", address: "fabien.gronus@crvo.fr" },
  { name: "Jean Marc DEGARDIN", address: "jean-marc.degardin@crvo.fr" },
  { name: "Maxence CHATELET", address: "maxence.chatelet@crvo.fr" },
];

const CC_RECIPIENTS: MailRecipient[] = [
  { name: "Benoit PECQUEUR", address: "benoit.pecqueur@crvo.fr" },
  { name: "Jaouad OUARIBA", address: "jaouad.ouariba@emilfrey.fr" },
  { name: "Vincent GORCE", address: "vincent.gorce@emilfrey.fr" },
  { name: "Damien PAILLET", address: "damien.paillet@emilfrey.fr" },
  { name: "Ali MELLOUL", address: "ali.melloul@crvo.fr" },
  { name: "Daniel PELLETIER", address: "daniel.pelletier@autosphere.fr" },
  { name: "Jean-Baptiste ALLEAU", address: "jean-baptiste.alleau@crvo.fr" },
];

const CYRIL_SIGNATURE: SignatureProfile = {
  key: "cyril",
  name: "Cyril GAY",
  title: "Directeur",
  company: "CRVO Lens & Emil Frey Transphère",
  mobile: "07.64.70.76.83",
  email: "cyril.gay@crvo.fr",
};

const CELINE_SIGNATURE: SignatureProfile = {
  key: "celine",
  name: "Céline MANIEZ",
  title: "Cheffe de groupe administratif",
  company: "CRVO Lens",
};

const DIRECTION_SIGNATURE: SignatureProfile = {
  key: "direction",
  name: "Direction CRVO",
  title: "CRVO Lens",
  company: "CRVO Lens",
};

function signatureFor(username?: string | null): SignatureProfile {
  const key = String(username ?? "").trim().toLowerCase();
  if (key === "cyril") return CYRIL_SIGNATURE;
  if (key === "celine.maniez") return CELINE_SIGNATURE;
  return DIRECTION_SIGNATURE;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function euro(value: unknown) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n(value));
}

function signed(value: unknown, suffix = "") {
  const parsed = n(value);
  return `${parsed > 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(parsed)}${suffix}`;
}

function decimal(value: unknown, digits = 2) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n(value));
}

function displayDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
}

function signaturePlain(signature: SignatureProfile) {
  const rows = [
    "Cordialement",
    "",
    signature.name,
    signature.title,
    signature.company,
  ];
  if (signature.mobile) rows.push(`Mob. ${signature.mobile}`);
  if (signature.email) rows.push(signature.email);
  rows.push("", "CRVO Lens", "Rue Alexis Halette", "62300 Lens", "www.crvo.fr");
  return rows.join("\n");
}

function buildMail(summary: AnimationSummary, signature: SignatureProfile) {
  const centre = summary.centre || "Lens";
  const reportDate = displayDate(summary.reportDate);
  const day = summary.yesterday ?? {};
  const month = summary.month ?? {};
  const pilotage = summary.pilotage ?? {};
  const exitDelta = month.exitDelta == null ? null : n(month.exitDelta);
  const revenueDelta = month.revenueDelta == null ? null : n(month.revenueDelta);
  const dayExitDelta = day.exitTarget == null ? null : n(day.exits) - n(day.exitTarget);
  const dayRevenueDelta = day.revenueTarget == null ? null : n(day.revenue) - n(day.revenueTarget);
  const volumeAhead = exitDelta != null && exitDelta >= 0;
  const revenueAhead = revenueDelta != null && revenueDelta >= 0;
  const bottleneck = pilotage.criticalBottleneck;
  const lines: string[] = [];

  lines.push("Bonjour à tous,", "", `Voici la synthèse CRVO ${centre} pour la journée du ${reportDate}.`, "");

  if (day.exitTarget != null) {
    lines.push(`${new Intl.NumberFormat("fr-FR").format(n(day.exits))} VOP sont sortis hier pour un objectif de ${new Intl.NumberFormat("fr-FR").format(n(day.exitTarget))}, soit ${signed(dayExitDelta, " VOP")}.`);
  } else {
    lines.push(`${new Intl.NumberFormat("fr-FR").format(n(day.exits))} VOP sont sortis hier.`);
  }
  if (day.revenueTarget != null) {
    lines.push(`Le CA de la veille atteint ${euro(day.revenue)} pour une cible de ${euro(day.revenueTarget)}, soit ${signed(dayRevenueDelta, " €")}.`);
  } else {
    lines.push(`Le CA de la veille atteint ${euro(day.revenue)}.`);
  }
  lines.push("");

  if (month.exitTarget != null) {
    lines.push(`Depuis le début du mois : ${new Intl.NumberFormat("fr-FR").format(n(month.exits))} VOP sortis pour ${new Intl.NumberFormat("fr-FR").format(n(month.exitTarget))} attendus à date, soit ${signed(exitDelta, " VOP")}.`);
  } else {
    lines.push(`Depuis le début du mois : ${new Intl.NumberFormat("fr-FR").format(n(month.exits))} VOP sortis.`);
  }
  if (month.revenueTargetAtDate != null) {
    lines.push(`${euro(month.revenue)} de CA cumulé pour ${euro(month.revenueTargetAtDate)} attendus à date, soit ${signed(revenueDelta, " €")}.`);
  } else {
    lines.push(`${euro(month.revenue)} de CA cumulé.`);
  }
  if (month.fre != null || month.hoursPerExit != null) {
    lines.push(`FRE moyen : ${month.fre == null ? "—" : euro(month.fre)} · ${month.hoursPerExit == null ? "—" : `${decimal(month.hoursPerExit)} h`} facturées par VOP.`);
  }
  lines.push("");

  if (volumeAhead && revenueAhead) {
    lines.push("Nous sommes au-dessus de la trajectoire à la fois en débit et en chiffre d'affaires. L'enjeu est maintenant de protéger cette avance sans relâcher la qualité ni la vitesse de traversée du parc.");
  } else if (volumeAhead && !revenueAhead) {
    lines.push("Nous conservons de l'avance en volume, mais la transformation de cette production en chiffre d'affaires reste insuffisante. Il faut sécuriser le chiffrage, les libérations et la facturation des dossiers déjà produits afin que le CA rejoigne le rythme industriel.");
  } else if (!volumeAhead && revenueAhead) {
    lines.push("La valeur produite reste au niveau attendu, mais le débit de sortie est sous la trajectoire. La priorité est de remettre du flux dans les secteurs aval sans dégrader le niveau de facturation.");
  } else {
    lines.push("Nous sommes sous la trajectoire en volume et en chiffre d'affaires. La journée doit être pilotée sur le flux : traiter les dossiers bloqués, alimenter les postes aval et convertir rapidement les véhicules terminables en sorties et en facturation.");
  }

  if (bottleneck?.label && n(bottleneck.over) > 0) {
    lines.push(`Point de tension principal : ${bottleneck.label} avec ${new Intl.NumberFormat("fr-FR").format(n(bottleneck.actual))} dossiers pour un seuil de ${new Intl.NumberFormat("fr-FR").format(n(bottleneck.max))}. Ce stock doit être attaqué en priorité pour éviter de désamorcer la suite du flux.`);
  }

  const priorityBits: string[] = [];
  if (n(pilotage.urgents) > 0) priorityBits.push(`${n(pilotage.urgents)} urgent${n(pilotage.urgents) > 1 ? "s" : ""}`);
  if (n(pilotage.qualityAlerts) > 0) priorityBits.push(`${n(pilotage.qualityAlerts)} alerte${n(pilotage.qualityAlerts) > 1 ? "s" : ""} NC`);
  if (n(pilotage.currentOver20) > 0) priorityBits.push(`${new Intl.NumberFormat("fr-FR").format(n(pilotage.currentOver20))} véhicules à plus de 20 jours`);
  if (priorityBits.length) lines.push(`À surveiller ce matin : ${priorityBits.join(" · ")}. Chacun doit s'assurer de la prise en charge de ses priorités et des vieillissants.`);

  lines.push("");
  if (pilotage.tone === "ahead") lines.push("La dynamique est bonne : on garde le rythme, on protège l'avance et on continue à pousser ! 💪");
  else if (pilotage.tone === "alert") lines.push("Nous avons les leviers pour reprendre la trajectoire : priorité aux dossiers qui peuvent être débloqués et transformés aujourd'hui. On reste concentrés et on pousse ! 💪");
  else lines.push("Nous sommes au contact de la trajectoire : chaque dossier débloqué compte. On reste concentrés et on continue à pousser ! 💪");
  lines.push("", "Bonne journée à tous,");

  const animationBody = lines.join("\n");
  const deltaPart = exitDelta == null ? "" : ` · ${signed(exitDelta, " VOP")}`;
  const caPart = revenueDelta == null ? "" : ` · CA ${signed(Math.round(revenueDelta / 1000), " k€")}`;
  return {
    subject: `[CRVO ${centre}] Animation ${reportDate}${deltaPart}${caPart}`,
    body: animationBody,
    plainBody: `${animationBody}\n\n${signaturePlain(signature)}`,
  };
}

function graphConfig() {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const mailbox = process.env.MICROSOFT_OUTLOOK_MAILBOX;
  if (!tenantId || !clientId || !clientSecret || !mailbox) return null;
  return { tenantId, clientId, clientSecret, mailbox };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function signatureHtml(signature: SignatureProfile) {
  const optional = [
    signature.mobile ? `<div>Mob. ${escapeHtml(signature.mobile)}</div>` : "",
    signature.email ? `<div><a href="mailto:${escapeHtml(signature.email)}" style="color:${MAIL_COLOR};text-decoration:none">${escapeHtml(signature.email)}</a></div>` : "",
  ].join("");
  return `<div style="font-family:${MAIL_FONT};font-size:10pt;line-height:1.35;color:${MAIL_COLOR};margin-top:16px">
    <div>Cordialement</div>
    <div style="height:10px"></div>
    <div style="font-weight:700">${escapeHtml(signature.name)}</div>
    <div>${escapeHtml(signature.title)}</div>
    <div>${escapeHtml(signature.company)}</div>
    ${optional}
    <div style="height:10px"></div>
    <div>CRVO Lens</div>
    <div>Rue Alexis Halette</div>
    <div>62300 Lens</div>
    <div><a href="https://www.crvo.fr" style="color:${MAIL_COLOR};text-decoration:none">www.crvo.fr</a></div>
  </div>`;
}

function emailHtml(text: string, signature: SignatureProfile) {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => `<p style="font-family:${MAIL_FONT};font-size:10pt;line-height:1.35;color:${MAIL_COLOR};margin:0 0 10pt 0">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font-family:${MAIL_FONT};font-size:10pt;line-height:1.35;color:${MAIL_COLOR}">${paragraphs}${signatureHtml(signature)}</div>`;
}

function graphRecipient(recipient: MailRecipient) {
  return { emailAddress: { name: recipient.name, address: recipient.address } };
}

async function graphToken(config: NonNullable<ReturnType<typeof graphConfig>>) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || `Microsoft OAuth ${response.status}`);
  return payload.access_token;
}

export async function GET(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session CRVO requise." }, 401);
  if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const reportDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;

  try {
    const summary = await authRpc<AnimationSummary>("kpi_daily_animation_admin", {
      p_session_hash: current.tokenHash,
      p_report_date: reportDate,
    });
    if (!summary?.connected) return json(summary || { connected: false, error: "Synthèse indisponible." }, 503);
    const signature = signatureFor(current.session.username);
    const mail = buildMail(summary, signature);
    return json({
      ...summary,
      generatedBy: signature.name,
      mail,
      outlook: {
        graphConfigured: Boolean(graphConfig()),
        nativeShareAvailable: true,
        to: TO_RECIPIENTS,
        cc: CC_RECIPIENTS,
        distribution: { toCount: TO_RECIPIENTS.length, ccCount: CC_RECIPIENTS.length },
        signature: { key: signature.key, name: signature.name, title: signature.title },
      },
    });
  } catch (error) {
    console.error("crvo_daily_animation_failed", error);
    return json({ error: "Impossible de préparer l'animation quotidienne." }, 503);
  }
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current) return json({ error: "Session CRVO requise." }, 401);
  if (current.session.role !== "admin") return json({ error: "Accès administrateur requis." }, 403);

  const config = graphConfig();
  if (!config) {
    return json({
      error: "Connexion Microsoft 365 non configurée. Le partage natif Outlook reste disponible.",
      graphConfigured: false,
    }, 501);
  }

  const body = await request.json().catch(() => null) as OutlookBody | null;
  const subject = String(body?.subject ?? "").trim().slice(0, 240);
  const bodyText = String(body?.bodyText ?? "").trim().slice(0, 20000);
  const filename = String(body?.filename ?? "Animation_CRVO.pdf").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  const pdfBase64 = String(body?.pdfBase64 ?? "").replace(/^data:application\/pdf;base64,/, "");

  if (!subject || !bodyText || !pdfBase64) return json({ error: "Objet, corps de mail ou PDF manquant." }, 400);
  if (pdfBase64.length > 4_000_000) return json({ error: "Le PDF est trop volumineux pour une pièce jointe directe Outlook." }, 413);

  try {
    const signature = signatureFor(current.session.username);
    const token = await graphToken(config);
    const createResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        subject,
        body: { contentType: "HTML", content: emailHtml(bodyText, signature) },
        toRecipients: TO_RECIPIENTS.map(graphRecipient),
        ccRecipients: CC_RECIPIENTS.map(graphRecipient),
        attachments: [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: filename,
          contentType: "application/pdf",
          contentBytes: pdfBase64,
        }],
      }),
      cache: "no-store",
    });
    const created = await createResponse.json().catch(() => ({})) as { id?: string; webLink?: string; error?: { message?: string } };
    if (!createResponse.ok || !created.id) throw new Error(created.error?.message || `Microsoft Graph ${createResponse.status}`);

    let webLink = created.webLink;
    if (!webLink) {
      const messageResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(created.id)}?$select=id,webLink`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      const message = await messageResponse.json().catch(() => ({})) as { webLink?: string };
      webLink = message.webLink;
    }

    return json({
      ok: true,
      draftId: created.id,
      webLink: webLink || null,
      mailbox: config.mailbox,
      distribution: { toCount: TO_RECIPIENTS.length, ccCount: CC_RECIPIENTS.length },
      signature: { key: signature.key, name: signature.name },
    });
  } catch (error) {
    console.error("crvo_outlook_draft_failed", error);
    return json({ error: error instanceof Error ? error.message : "Création du brouillon Outlook impossible." }, 502);
  }
}
