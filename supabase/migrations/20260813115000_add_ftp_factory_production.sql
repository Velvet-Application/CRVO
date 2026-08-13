create table if not exists public.kpi_ftp_factory_production (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.kpi_import_batches(id) on delete cascade,
  production_date date not null,
  source_modified_at timestamptz,
  flow text not null,
  received integer not null default 0,
  dynamic_expertise integer not null default 0,
  washing integer not null default 0,
  expertise integer not null default 0,
  mechanics integer not null default 0,
  bodywork integer not null default 0,
  fixline_1 integer not null default 0,
  fixline_2 integer not null default 0,
  fixline_3 integer not null default 0,
  dsp integer not null default 0,
  preparation integer not null default 0,
  photos integer not null default 0,
  quality integer not null default 0,
  wheels integer not null default 0,
  restor_fx integer not null default 0,
  technical_control integer not null default 0,
  available integer not null default 0,
  created_at timestamptz not null default now(),
  unique(import_batch_id, production_date, flow)
);

create index if not exists kpi_ftp_factory_production_date_idx on public.kpi_ftp_factory_production(production_date desc);
create index if not exists kpi_ftp_factory_production_batch_idx on public.kpi_ftp_factory_production(import_batch_id);

alter table public.kpi_ftp_factory_production enable row level security;
revoke all on public.kpi_ftp_factory_production from anon, authenticated;
