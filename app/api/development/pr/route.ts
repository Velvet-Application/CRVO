import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../../lib/crvo-auth";

export const dynamic = "force-dynamic";

type PrPayload = Record<string, unknown> & { connected?: boolean; error?: string };

async function requireAdmin() {
  const current = await currentSession();
  if (!current) return { error: NextResponse.json({ error: "Session CRVO requise." }, { status: 401 }) } as const;
  if (current.session.role !== "admin") return { error: NextResponse.json({ error: "Module PR de développement réservé aux administrateurs." }, { status: 403 }) } as const;
  return { current } as const;
}

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || null;
  const workOrder = url.searchParams.get("workOrder")?.trim() || null;
  const inventory = url.searchParams.get("inventory")?.trim() || null;
  try {
    let payload: PrPayload;
    if (workOrder) {
      payload = await authRpc<PrPayload>("kpi_pr_dev_work_order", { p_token_hash: gate.current.tokenHash, p_work_order: workOrder });
    } else if (inventory) {
      payload = await authRpc<PrPayload>("kpi_pr_dev_inventory_get", { p_token_hash: gate.current.tokenHash, p_session_id: inventory });
    } else {
      payload = await authRpc<PrPayload>("kpi_pr_dev_snapshot", { p_token_hash: gate.current.tokenHash, p_query: query });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Module PR indisponible." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const action = String(body.action || "").trim();
  try {
    let result: unknown;
    if (action === "upsertItem") {
      result = await authRpc("kpi_pr_dev_upsert_item", { p_token_hash: gate.current.tokenHash, p_item: body.item || {} });
    } else if (action === "movement") {
      result = await authRpc("kpi_pr_dev_post_movement", { p_token_hash: gate.current.tokenHash, p_payload: body.payload || {} });
    } else if (action === "reserve") {
      result = await authRpc("kpi_pr_dev_reserve", { p_token_hash: gate.current.tokenHash, p_payload: body.payload || {} });
    } else if (action === "releaseReservation") {
      result = await authRpc("kpi_pr_dev_release_reservation", { p_token_hash: gate.current.tokenHash, p_reservation_id: body.reservationId });
    } else if (action === "serveReservation") {
      result = await authRpc("kpi_pr_dev_serve_reservation", { p_token_hash: gate.current.tokenHash, p_reservation_id: body.reservationId });
    } else if (action === "createInventory") {
      result = await authRpc("kpi_pr_dev_create_inventory", { p_token_hash: gate.current.tokenHash, p_filters: body.filters || {} });
    } else if (action === "countInventoryLine") {
      result = await authRpc("kpi_pr_dev_count_inventory_line", { p_token_hash: gate.current.tokenHash, p_line_id: body.lineId, p_count: body.count });
    } else if (action === "closeInventory") {
      result = await authRpc("kpi_pr_dev_close_inventory", { p_token_hash: gate.current.tokenHash, p_session_id: body.sessionId });
    } else if (action === "upsertDiscountRule") {
      result = await authRpc("kpi_pr_dev_upsert_discount_rule", { p_token_hash: gate.current.tokenHash, p_rule: body.rule || {} });
    } else if (action === "upsertPackage") {
      result = await authRpc("kpi_pr_dev_upsert_package", { p_token_hash: gate.current.tokenHash, p_package: body.package || {} });
    } else if (action === "saveSetting") {
      result = await authRpc("kpi_pr_dev_save_setting", { p_token_hash: gate.current.tokenHash, p_key: body.key, p_value: body.value || {} });
    } else if (action === "beginCatalogImport") {
      result = await authRpc("kpi_pr_dev_import_begin", {
        p_token_hash: gate.current.tokenHash,
        p_source_name: body.sourceName || null,
        p_source_fingerprint: body.sourceFingerprint || null,
        p_mapping: body.mapping || {},
      });
    } else if (action === "importCatalogChunk") {
      result = await authRpc("kpi_pr_dev_import_catalog_chunk", {
        p_token_hash: gate.current.tokenHash,
        p_batch_id: body.batchId,
        p_rows: body.rows || [],
      });
    } else if (action === "completeCatalogImport") {
      result = await authRpc("kpi_pr_dev_import_complete", {
        p_token_hash: gate.current.tokenHash,
        p_batch_id: body.batchId,
      });
    } else {
      return NextResponse.json({ error: "Action PR inconnue." }, { status: 400 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action PR impossible." }, { status: 500 });
  }
}
