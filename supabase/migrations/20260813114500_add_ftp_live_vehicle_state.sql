create table if not exists public.kpi_ftp_vehicle_state (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.kpi_import_batches(id) on delete cascade,
  snapshot_at date not null,
  source_modified_at timestamptz,
  registration text,
  work_order text,
  client text,
  vin text,
  model text,
  mileage numeric,
  status text,
  status_at timestamptz,
  status_age_days numeric,
  factory_age_days numeric,
  alert text,
  urgency text,
  mechanics text,
  bodywork text,
  technical_control text,
  dsp text,
  wheels text,
  part_available text,
  part_ordered_days numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kpi_ftp_vehicle_state_batch_idx on public.kpi_ftp_vehicle_state(import_batch_id);
create index if not exists kpi_ftp_vehicle_state_work_order_idx on public.kpi_ftp_vehicle_state(work_order);
create index if not exists kpi_ftp_vehicle_state_registration_idx on public.kpi_ftp_vehicle_state(registration);
create index if not exists kpi_ftp_vehicle_state_alert_idx on public.kpi_ftp_vehicle_state(alert);

alter table public.kpi_ftp_vehicle_state enable row level security;
revoke all on public.kpi_ftp_vehicle_state from anon, authenticated;
