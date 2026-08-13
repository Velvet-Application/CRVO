alter table public.kpi_vehicle_workload
  add column if not exists vin text,
  add column if not exists opened_at date,
  add column if not exists potential_revenue_total numeric,
  add column if not exists potential_labor_revenue numeric,
  add column if not exists potential_parts_revenue numeric,
  add column if not exists potential_other_revenue numeric,
  add column if not exists primary_activity text;

alter table public.kpi_invoice_facts
  add column if not exists vin text,
  add column if not exists labor_hours numeric;

create table if not exists public.kpi_vehicle_identity_map (
  work_order text primary key,
  registration text,
  vin text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sources jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists kpi_invoice_facts_source_invoice_uidx
  on public.kpi_invoice_facts(source_name, invoice_number);
create unique index if not exists kpi_vehicle_workload_snapshot_or_sector_uidx
  on public.kpi_vehicle_workload(snapshot_at, work_order, sector_key, source_name);

alter table public.kpi_vehicle_identity_map enable row level security;
revoke all on public.kpi_vehicle_identity_map from anon, authenticated;

create or replace function public.kpi_upsert_vehicle_identities(payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.kpi_vehicle_identity_map(work_order, registration, vin, sources, metadata, first_seen_at, last_seen_at)
  select nullif(item->>'work_order',''), nullif(item->>'registration',''), nullif(item->>'vin',''), coalesce(item->'sources','[]'::jsonb), coalesce(item->'metadata','{}'::jsonb), now(), now()
  from jsonb_array_elements(payload) item
  where nullif(item->>'work_order','') is not null
  on conflict (work_order) do update set
    registration = coalesce(excluded.registration, kpi_vehicle_identity_map.registration),
    vin = coalesce(excluded.vin, kpi_vehicle_identity_map.vin),
    sources = kpi_vehicle_identity_map.sources || excluded.sources,
    metadata = kpi_vehicle_identity_map.metadata || excluded.metadata,
    last_seen_at = now();
end;
$$;
revoke all on function public.kpi_upsert_vehicle_identities(jsonb) from public, anon, authenticated;
grant execute on function public.kpi_upsert_vehicle_identities(jsonb) to service_role;
