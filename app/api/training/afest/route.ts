import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function trainingAllowed(profile: string, role: string) {
  return role === "admin" || ["service_manager", "hr", "trainer"].includes(profile);
}

function message(error: unknown, fallback: string) {
  const raw = error instanceof Error
    ? error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/, "")
    : fallback;
  const known: Record<string, string> = {
    training_forbidden: "Accès Formation & compétences non autorisé.",
    training_finance_forbidden: "Cette action est réservée aux profils habilités au financement formation.",
    afest_not_found: "Dossier AFEST introuvable.",
    afest_not_ready_edi: "Le dossier n’est pas encore prêt pour la préparation EDI. Corrige les points bloquants.",
    afest_invalid_status: "Statut AFEST invalide.",
    afest_unknown_action: "Action AFEST inconnue.",
    session_not_found: "Session de formation introuvable.",
  };
  for (const [key, value] of Object.entries(known)) if (raw.includes(key)) return value;
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    return parsed.message || fallback;
  } catch {
    return raw || fallback;
  }
}

async function access() {
  const current = await currentSession();
  if (!current || !trainingAllowed(current.session.access_profile, current.session.role)) return null;
  return current;
}

export async function GET(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès réservé aux RH, chefs de service, administrateurs et formateurs." }, 403);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  try {
    if (id) {
      const payload = await authRpc<Record<string, unknown>>("kpi_training_afest_dossier_detail", {
        p_session_hash: current.tokenHash,
        p_dossier_id: id,
      });
      return json(payload);
    }
    const payload = await authRpc<Record<string, unknown>>("kpi_training_afest_dashboard", {
      p_session_hash: current.tokenHash,
    });
    return json(payload);
  } catch (error) {
    console.error("training_afest_get_failed", error);
    return json({ error: message(error, "Module AFEST temporairement indisponible.") }, 500);
  }
}

export async function POST(request: Request) {
  const current = await access();
  if (!current) return json({ error: "Accès réservé aux RH, chefs de service, administrateurs et formateurs." }, 403);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");
  if (!action) return json({ error: "Action AFEST manquante." }, 400);
  try {
    const payload = { ...body };
    delete payload.action;
    const result = await authRpc<Record<string, unknown>>("kpi_training_afest_save", {
      p_session_hash: current.tokenHash,
      p_action: action,
      p_payload: payload,
    });
    return json(result);
  } catch (error) {
    console.error("training_afest_post_failed", error);
    return json({ error: message(error, "Enregistrement AFEST impossible.") }, 400);
  }
}
