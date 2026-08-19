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
  recipients?: string[];
  pdfBase64?: string;
  filename?: string;
};

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

function buildMail(summary: AnimationSummary) {
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
  lines.push("", "Bonne journée à tous,", "", summary.generatedBy || "Direction CRVO");

  const deltaPart = exitDelta == null ? "" : ` · ${signed(exitDelta, " VOP")}`;
  const caPart = revenueDelta == null ? "" : ` · CA ${signed(Math.round(revenueDelta / 1000), " k€")}`;
  return {
    subject: `[CRVO ${centre}] Animation ${reportDate}${deltaPart}${caPart}`,
    body: lines.join("\n"),
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

function emailHtml(text: string) {
  return text.split(/\n{2,}/).map((paragraph) => `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#17324d;margin:0 0 14px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
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
    const mail = buildMail(summary);
    return json({
      ...summary,
      mail,
      outlook: {
        graphConfigured: Boolean(graphConfig()),
        nativeShareAvailable: true,
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
  const recipients = (Array.isArray(body?.recipients) ? body?.recipients : [])
    .map((value) => String(value).trim())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    .slice(0, 100);

  if (!subject || !bodyText || !pdfBase64) return json({ error: "Objet, corps de mail ou PDF manquant." }, 400);
  if (pdfBase64.length > 4_000_000) return json({ error: "Le PDF est trop volumineux pour une pièce jointe directe Outlook." }, 413);

  try {
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
        body: { contentType: "HTML", content: emailHtml(bodyText) },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
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

    return json({ ok: true, draftId: created.id, webLink: webLink || null, mailbox: config.mailbox });
  } catch (error) {
    console.error("crvo_outlook_draft_failed", error);
    return json({ error: error instanceof Error ? error.message : "Création du brouillon Outlook impossible." }, 502);
  }
}
