create table if not exists public.kpi_historical_productivity_hours (
  month date not null,
  site_code text not null default 'lens',
  activity_label text not null,
  activity_pattern text not null,
  team_code text not null,
  sector_key text not null,
  workcenter_key text not null,
  bought_hours numeric(14,4) not null default 0,
  sold_hours numeric(14,4) not null default 0,
  excludes_from_mini boolean not null default false,
  source_file text not null,
  source_sha256 text not null,
  source_sheet text not null default 'DASHBOARD',
  source_row integer not null,
  imported_at timestamptz not null default now(),
  primary key (site_code, month, activity_pattern)
);

create index if not exists kpi_historical_productivity_hours_sector_month_idx
  on public.kpi_historical_productivity_hours(site_code, sector_key, month);

alter table public.kpi_historical_productivity_hours enable row level security;
revoke all on table public.kpi_historical_productivity_hours from anon, authenticated;
grant select on table public.kpi_historical_productivity_hours to service_role;

comment on table public.kpi_historical_productivity_hours is
'Historique brut des heures achetées / vendues issues des DASHBOARD des outils rendement CRVO Lens. La référence certifiée du simulateur MINI est conservée dans kpi_capacity_productivity_reference.';
