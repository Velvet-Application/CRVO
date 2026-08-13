create or replace view public.kpi_dashboard_snapshots as
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
group by b.id, b.snapshot_at, s.name, b.status, b.archive_status
union all
select
  md5('ftp-live-' || l.snapshot_at::text)::uuid as id,
  l.snapshot_at,
  l.source_name,
  'verified'::text as status,
  'live'::text as archive_status,
  l.metrics
from public.kpi_ftp_live_dashboard l;
