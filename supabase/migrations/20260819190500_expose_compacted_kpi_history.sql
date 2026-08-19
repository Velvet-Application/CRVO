create or replace view public.kpi_ftp_daily_history_retained as
select a.snapshot_at,a.source_name,a.metrics
from public.kpi_ftp_daily_kpi_archive a
union all
select h.snapshot_at,h.source_name,h.metrics
from public.kpi_ftp_daily_history h
where not exists (
  select 1 from public.kpi_ftp_daily_kpi_archive a where a.snapshot_at=h.snapshot_at
);

grant select on public.kpi_ftp_daily_history_retained to anon,authenticated,service_role;
