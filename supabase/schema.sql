-- KPI CRVO - schema cible Supabase
-- À appliquer au projet tvmkhvfmdstkunwwuzuz dès que sa connexion OAuth est disponible.

create extension if not exists pgcrypto;

create table if not exists public.kpi_data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null check (kind in ('sftp', 'manual', 'seed')),
  remote_path text,
  schedule text,
  is_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.kpi_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.kpi_data_sources(id),
  snapshot_at date not null,
  original_filename text not null,
  archive_object_path text,
  sha256 text unique check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null default 0 check (byte_size >= 0),
  row_count bigint check (row_count is null or row_count >= 0),
  status text not null check (status in ('received', 'archived', 'processing', 'verified', 'failed')),
  archive_status text not null default 'pending' check (archive_status in ('pending', 'stored', 'missing')),
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.kpi_snapshot_metrics (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references public.kpi_import_batches(id),
  metric_key text not null,
  metric_label text not null,
  metric_value numeric not null,
  unit text not null default 'count',
  dimensions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (import_batch_id, metric_key, dimensions)
);

create table if not exists public.kpi_field_mappings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.kpi_data_sources(id),
  source_field text not null,
  target_metric_key text not null,
  target_metric_label text not null,
  aggregation text not null check (aggregation in ('last', 'sum', 'avg', 'min', 'max', 'count')),
  transform_expression text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source_id, source_field, target_metric_key)
);

create table if not exists public.kpi_visual_definitions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  visual_type text not null check (visual_type in ('number', 'bar', 'line', 'donut', 'table')),
  metric_key text not null,
  aggregation text not null default 'last',
  filters jsonb not null default '{}'::jsonb,
  layout jsonb not null default '{}'::jsonb,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_corrections (
  id uuid primary key default gen_random_uuid(),
  original_metric_id bigint not null references public.kpi_snapshot_metrics(id),
  corrected_value numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.kpi_bridge_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  files_seen integer not null default 0,
  files_imported integer not null default 0,
  details jsonb not null default '{}'::jsonb
);

create index if not exists kpi_import_batches_snapshot_at_idx on public.kpi_import_batches(snapshot_at desc);
create index if not exists kpi_import_batches_source_idx on public.kpi_import_batches(source_id, snapshot_at desc);
create index if not exists kpi_snapshot_metrics_key_idx on public.kpi_snapshot_metrics(metric_key, import_batch_id);
create index if not exists kpi_snapshot_metrics_batch_idx on public.kpi_snapshot_metrics(import_batch_id);

create or replace function public.kpi_reject_batch_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.status = 'verified' then
    raise exception 'KPI history is immutable. Create a correction instead.';
  end if;
  return new;
end;
$$;

create or replace function public.kpi_reject_metric_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'KPI metrics are immutable. Create a correction instead.';
end;
$$;

drop trigger if exists kpi_import_batches_immutable on public.kpi_import_batches;
create trigger kpi_import_batches_immutable
before update or delete on public.kpi_import_batches
for each row execute function public.kpi_reject_batch_change();

drop trigger if exists kpi_snapshot_metrics_immutable on public.kpi_snapshot_metrics;
create trigger kpi_snapshot_metrics_immutable
before update or delete on public.kpi_snapshot_metrics
for each row execute function public.kpi_reject_metric_change();

create or replace view public.kpi_dashboard_snapshots
with (security_invoker = true)
as
select
  b.id,
  b.snapshot_at,
  s.name as source_name,
  b.status,
  b.archive_status,
  jsonb_object_agg(m.metric_key, m.metric_value order by m.metric_key) as metrics
from public.kpi_import_batches b
join public.kpi_data_sources s on s.id = b.source_id
join public.kpi_snapshot_metrics m on m.import_batch_id = b.id
where b.status = 'verified'
group by b.id, b.snapshot_at, s.name, b.status, b.archive_status;

alter table public.kpi_data_sources enable row level security;
alter table public.kpi_import_batches enable row level security;
alter table public.kpi_snapshot_metrics enable row level security;
alter table public.kpi_field_mappings enable row level security;
alter table public.kpi_visual_definitions enable row level security;
alter table public.kpi_corrections enable row level security;
alter table public.kpi_bridge_runs enable row level security;

revoke all on public.kpi_data_sources from anon, authenticated;
revoke all on public.kpi_import_batches from anon, authenticated;
revoke all on public.kpi_snapshot_metrics from anon, authenticated;
revoke all on public.kpi_field_mappings from anon, authenticated;
revoke all on public.kpi_visual_definitions from anon, authenticated;
revoke all on public.kpi_corrections from anon, authenticated;
revoke all on public.kpi_bridge_runs from anon, authenticated;
revoke all on public.kpi_dashboard_snapshots from anon, authenticated;

insert into public.kpi_data_sources (id, name, kind, is_enabled)
values ('8181f95d-5553-4ca4-9f9d-b39186f37963', 'Classeur Excel CRVO quotidien', 'seed', false)
on conflict (name) do nothing;

insert into public.kpi_data_sources (id, name, kind, remote_path, schedule, is_enabled)
values ('dfbb57cc-8771-4e53-b52b-38defa389b64', 'Serveur SFTP CRVO', 'sftp', '/exports/kpi', '30 3 * * 1-5', false)
on conflict (name) do nothing;

insert into public.kpi_import_batches (
  id, source_id, snapshot_at, original_filename, sha256, byte_size, status, archive_status,
  metadata
)
values (
  'b3177ed3-7b28-43c0-9fa2-e627daf0fa42',
  '8181f95d-5553-4ca4-9f9d-b39186f37963',
  '2026-08-07',
  'classeur_crvo_2026-08-07.xlsx',
  null,
  0,
  'verified',
  'pending',
  '{"origin":"values verified during workbook analysis","sheets":75,"business_views":16}'::jsonb
)
on conflict (id) do nothing;

insert into public.kpi_snapshot_metrics (import_batch_id, metric_key, metric_label, metric_value)
values
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'entries_vop', 'Entrées VOP', 78),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'exits_vop', 'Sorties VOP', 86),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'factory_stock', 'Stock usine', 1097),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'stock_over_15d', 'Stock > 15 jours', 494),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'stock_over_20d', 'Stock > 20 jours', 399),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_expertise', 'Expertise', 80),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_mechanics', 'Mécanique', 96),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_dsp', 'DSP', 24),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_bodywork', 'Carrosserie', 11),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_preparation', 'Préparation', 89),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_quality', 'Qualité', 88),
  ('b3177ed3-7b28-43c0-9fa2-e627daf0fa42', 'production_factory_exit', 'Sortie usine', 86)
on conflict (import_batch_id, metric_key, dimensions) do nothing;
