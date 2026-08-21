import { NextResponse } from "next/server";
import { authRpc, currentSession, hasPageAccess } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } });
}

async function authorized() {
  const current = await currentSession();
  if (!current) return { error: json({ error: "Session requise." }, 401) } as const;
  if (!hasPageAccess(current.session, "transphere")) return { error: json({ error: "Accès Transphère requis." }, 403) } as const;
  return { current } as const;
}

export async function GET() {
  const auth = await authorized();
  if ("error" in auth) return auth.error;
  try {
    const payload = await authRpc<Record<string, unknown>>("kpi_transphere_transport_matrix_admin", { p_session_hash: auth.current.tokenHash });
    return json(payload);
  } catch (error) {
    console.error("transphere_transport_matrix_get_failed", error);
    return json({ error: "Matrice transport temporairement indisponible." }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await authorized();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "Requête invalide." }, 400);
  try {
    if (body.action === "settings") {
      await authRpc<boolean>("kpi_transphere_transport_settings_update_admin", {
        p_session_hash: auth.current.tokenHash,
        p_cost_weight: body.costWeight,
        p_lead_time_weight: body.leadTimeWeight,
      });
      return json({ ok: true });
    }
    if (body.action === "contract_indexation") {
      await authRpc<boolean>("kpi_transphere_transport_contract_indexation_update_admin", {
        p_session_hash: auth.current.tokenHash,
        p_crvo: body.crvo,
        p_carrier: body.carrier,
        p_source_label: body.sourceLabel,
        p_fuel_indexation_pct: body.fuelIndexationPct,
      });
      return json({ ok: true });
    }
    if (body.action !== "tariff") return json({ error: "Action inconnue." }, 400);
    const id = await authRpc<number>("kpi_transphere_transport_tariff_upsert_admin", {
      p_session_hash: auth.current.tokenHash,
      p_id: body.id ?? null,
      p_crvo: body.crvo,
      p_pdv_name: body.pdvName,
      p_address: body.address || null,
      p_postal_code: body.postalCode || null,
      p_country: body.country || "FR",
      p_carrier: body.carrier,
      p_carrier_type: body.carrierType,
      p_direction: body.direction,
      p_scenario: body.scenario,
      p_cost_per_vehicle: body.costPerVehicle,
      p_lead_time_days: body.leadTimeDays ?? null,
      p_source_label: body.sourceLabel || null,
      p_valid_from: body.validFrom || null,
      p_valid_to: body.validTo || null,
      p_active: body.active !== false,
    });
    return json({ ok: true, id });
  } catch (error) {
    console.error("transphere_transport_matrix_post_failed", error);
    const message = error instanceof Error && error.message.includes("non autoris") ? "Modification non autorisée." : "Enregistrement du tarif impossible.";
    return json({ error: message }, message.includes("autorisée") ? 403 : 400);
  }
}

export async function DELETE(request: Request) {
  const auth = await authorized();
  if ("error" in auth) return auth.error;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Identifiant tarif invalide." }, 400);
  try {
    const deleted = await authRpc<boolean>("kpi_transphere_transport_tariff_delete_admin", { p_session_hash: auth.current.tokenHash, p_id: id });
    return json({ ok: deleted });
  } catch (error) {
    console.error("transphere_transport_matrix_delete_failed", error);
    return json({ error: "Suppression du tarif impossible." }, 400);
  }
}
