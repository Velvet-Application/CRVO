import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type SettingsRow = {
  site_code: string;
  settings: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
};

type HistoryRow = {
  id: number | string;
  saved_at: string;
  saved_by: string | null;
};

function env() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl && secretKey ? { supabaseUrl, secretKey } : null;
}

async function rest<T>(supabaseUrl: string, secretKey: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: supabaseRestHeaders(secretKey, {
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function GET() {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }
  const config = env();
  if (!config) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });

  try {
    const [rows, history] = await Promise.all([
      rest<SettingsRow[]>(config.supabaseUrl, config.secretKey, "kpi_capacity_simulator_settings?site_code=eq.lens&select=site_code,settings,updated_at,updated_by&limit=1"),
      rest<HistoryRow[]>(config.supabaseUrl, config.secretKey, "kpi_capacity_simulator_history?site_code=eq.lens&select=id,saved_at,saved_by&order=saved_at.desc&limit=10"),
    ]);
    const row = rows[0] ?? null;
    return NextResponse.json({
      siteCode: "lens",
      settings: row?.settings ?? null,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
      history,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Lecture du simulateur impossible." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const current = await currentSession();
  if (!current || current.session.role !== "admin") {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }
  const config = env();
  if (!config) return NextResponse.json({ error: "Base CRVO non configurée." }, { status: 503 });

  const payload = await request.json().catch(() => null) as { settings?: unknown } | null;
  if (!payload?.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
    return NextResponse.json({ error: "Paramétrage invalide." }, { status: 400 });
  }
  const encoded = JSON.stringify(payload.settings);
  if (encoded.length > 250_000) return NextResponse.json({ error: "Paramétrage trop volumineux." }, { status: 413 });

  const actor = current.session.display_name || current.session.username;
  try {
    await rest<unknown>(config.supabaseUrl, config.secretKey, "kpi_capacity_simulator_history", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ site_code: "lens", settings: payload.settings, saved_by: actor }),
    });
    const rows = await rest<SettingsRow[]>(config.supabaseUrl, config.secretKey, "kpi_capacity_simulator_settings?on_conflict=site_code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ site_code: "lens", settings: payload.settings, updated_at: new Date().toISOString(), updated_by: actor }),
    });
    const row = rows[0] ?? null;
    return NextResponse.json({ saved: true, updatedAt: row?.updated_at ?? new Date().toISOString(), updatedBy: actor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sauvegarde du simulateur impossible." }, { status: 502 });
  }
}
