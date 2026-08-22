create index if not exists kpi_ftp_vehicle_state_pr_snapshot_idx
on public.kpi_ftp_vehicle_state (
  work_order,
  snapshot_at desc,
  source_modified_at desc nulls last,
  created_at desc
)
include (registration, vin, client, model, status, part_available, part_ordered_days)
where nullif(trim(coalesce(work_order,'')),'') is not null;

create index if not exists kpi_ftp_status_events_pr_snapshot_idx
on public.kpi_ftp_status_events (status,event_date)
include (work_order,vin,registration);
