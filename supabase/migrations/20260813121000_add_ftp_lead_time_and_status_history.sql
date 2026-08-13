create table if not exists public.kpi_ftp_lead_time_state (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.kpi_import_batches(id) on delete cascade,
  source_modified_at timestamptz,
  site text,
  flow text,
  client text,
  make text,
  model text,
  vin text,
  registration text,
  work_order text,
  current_state text,
  created_date text,
  waiting_factory_date text,
  transport_outbound_date text,
  received_factory_date text,
  dynamic_expertise_date text,
  factory_exit_date text,
  transport_return_done_date text,
  outbound_in_progress_days numeric,
  lead_time_outbound_days numeric,
  lead_time_storage_days numeric,
  lead_time_factory_days numeric,
  lead_time_return_days numeric,
  lead_time_parts_days numeric,
  exit_week integer,
  exit_month integer,
  exit_year integer,
  created_at timestamptz not null default now()
);
create index if not exists kpi_ftp_lead_time_batch_idx on public.kpi_ftp_lead_time_state(import_batch_id);
create index if not exists kpi_ftp_lead_time_state_idx on public.kpi_ftp_lead_time_state(current_state);
create index if not exists kpi_ftp_lead_time_reg_idx on public.kpi_ftp_lead_time_state(registration);

create table if not exists public.kpi_ftp_status_events (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  source_first_seen_at timestamptz not null default now(),
  source_last_seen_at timestamptz not null default now(),
  source_modified_at timestamptz,
  client text,
  work_order text,
  vin text,
  flow text,
  status text,
  event_date date,
  event_time time without time zone,
  registration text,
  appointment_id text,
  created_at timestamptz not null default now()
);
create index if not exists kpi_ftp_status_events_vehicle_idx on public.kpi_ftp_status_events(registration,event_date,event_time);
create index if not exists kpi_ftp_status_events_or_idx on public.kpi_ftp_status_events(work_order,event_date,event_time);
create index if not exists kpi_ftp_status_events_status_idx on public.kpi_ftp_status_events(status);

alter table public.kpi_ftp_lead_time_state enable row level security;
alter table public.kpi_ftp_status_events enable row level security;
revoke all on public.kpi_ftp_lead_time_state from anon, authenticated;
revoke all on public.kpi_ftp_status_events from anon, authenticated;

drop view if exists public.kpi_ftp_lead_time_summary;
create view public.kpi_ftp_lead_time_summary as
with latest_batch as (
  select b.id, b.imported_at, b.metadata
  from public.kpi_import_batches b
  join public.kpi_data_sources s on s.id=b.source_id
  where s.kind='ftp' and s.is_enabled=true
    and b.original_filename='LeadTimeFactoryBI.csv'
    and b.metadata->>'lead_time_status'='ready'
  order by coalesce((b.metadata->>'modified_at')::bigint,0) desc, b.imported_at desc
  limit 1
)
select
  max(l.source_modified_at) as source_modified_at,
  count(*) as vehicle_count,
  avg(l.lead_time_factory_days) filter (where l.lead_time_factory_days is not null) as avg_factory_days,
  percentile_cont(0.5) within group (order by l.lead_time_factory_days) filter (where l.lead_time_factory_days is not null) as median_factory_days,
  avg(l.lead_time_storage_days) filter (where l.lead_time_storage_days is not null) as avg_storage_days,
  avg(l.lead_time_parts_days) filter (where l.lead_time_parts_days is not null) as avg_parts_days,
  count(*) filter (where l.flow='VOP EFF') as vop_eff_count,
  count(*) filter (where l.flow='VOP EXT') as vop_ext_count
from latest_batch b
join public.kpi_ftp_lead_time_state l on l.import_batch_id=b.id;
