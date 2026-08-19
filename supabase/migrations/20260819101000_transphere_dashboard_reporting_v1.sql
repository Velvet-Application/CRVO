create table if not exists public.kpi_transphere_daily_stats (
  stat_date date primary key,
  in_crvo integer not null default 0,
  out_crvo integer not null default 0,
  total_transports integer not null default 0,
  daily_objective integer not null default 0,
  cumulative_objective integer not null default 0,
  cumulative_transports integer not null default 0,
  service_hours numeric(10,2) not null default 0,
  fuel_l_per_100 numeric(10,3),
  source_file text not null,
  imported_at timestamptz not null default now()
);
create table if not exists public.kpi_transphere_month_targets (
  month date primary key,
  target_transports integer not null,
  source_file text,
  updated_at timestamptz not null default now()
);
alter table public.kpi_transphere_daily_stats enable row level security;
alter table public.kpi_transphere_month_targets enable row level security;
revoke all on table public.kpi_transphere_daily_stats from anon,authenticated;
revoke all on table public.kpi_transphere_month_targets from anon,authenticated;
grant select,insert,update,delete on public.kpi_transphere_daily_stats to service_role;
grant select,insert,update,delete on public.kpi_transphere_month_targets to service_role;

insert into public.kpi_transphere_month_targets(month,target_transports,source_file) values
('2026-08-01',600,'Book TRANSPHERE - Journée du 18.08.2026.xlsx')
on conflict(month) do update set target_transports=excluded.target_transports,source_file=excluded.source_file,updated_at=now();

insert into public.kpi_transphere_daily_stats(stat_date,in_crvo,out_crvo,total_transports,daily_objective,cumulative_objective,cumulative_transports,service_hours,fuel_l_per_100,source_file) values
('2026-08-03',20,19,39,16,16,39,11.75,36.36363636,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-04',17,19,36,16,32,75,12.50,38.01775148,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-05',17,17,34,16,48,109,9.00,39.85507246,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-06',12,26,38,16,64,147,12.50,37.73148148,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-07',19,18,37,16,80,184,7.75,42.70270270,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-10',11,26,37,16,96,221,9.50,34.91271820,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-11',12,16,28,16,112,249,9.00,35.50185874,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-12',10,18,28,16,128,277,12.00,36.26237624,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-13',11,18,29,16,144,306,13.25,37.01863354,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-14',6,9,15,16,160,321,8.50,41.17647059,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-17',16,26,42,32,192,363,19.25,35.76437588,'Book TRANSPHERE - Journée du 18.08.2026.xlsx'),
('2026-08-18',27,26,53,48,240,416,22.50,36.54925983,'Book TRANSPHERE - Journée du 18.08.2026.xlsx')
on conflict(stat_date) do nothing;

-- Les RPC kpi_transphere_dashboard_admin et kpi_transphere_import_month_admin sont créés dans la migration production correspondante.
