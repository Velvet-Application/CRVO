create or replace view public.kpi_ftp_status_duration_baselines as
with ordered as (
  select
    coalesce(nullif(vin,''), nullif('or:'||work_order,'or:'), nullif('reg:'||registration,'reg:')) as vehicle_key,
    flow,
    status,
    (event_date::timestamp + coalesce(event_time, time '00:00:00')) as event_ts,
    lead(event_date::timestamp + coalesce(event_time, time '00:00:00')) over (
      partition by coalesce(nullif(vin,''), nullif('or:'||work_order,'or:'), nullif('reg:'||registration,'reg:'))
      order by event_date, event_time nulls first, id
    ) as next_event_ts
  from public.kpi_ftp_status_events
  where event_date is not null
    and status is not null
    and btrim(status) <> ''
    and flow in ('VOP EFF','VOP EXT')
), durations as (
  select
    flow,
    status,
    extract(epoch from (next_event_ts - event_ts))/86400.0 as duration_days
  from ordered
  where vehicle_key is not null
    and next_event_ts is not null
    and next_event_ts > event_ts
    and next_event_ts - event_ts <= interval '30 days'
)
select
  flow,
  status,
  count(*)::integer as sample_count,
  percentile_cont(0.50) within group (order by duration_days)::numeric as median_days,
  percentile_cont(0.75) within group (order by duration_days)::numeric as p75_days,
  percentile_cont(0.90) within group (order by duration_days)::numeric as p90_days,
  avg(duration_days)::numeric as average_days
from durations
group by flow, status;

create or replace view public.kpi_ftp_current_drift as
with latest_batch as (
  select b.id, b.snapshot_at, b.imported_at
  from public.kpi_import_batches b
  where b.source_id = 'dfbb57cc-8771-4e53-b52b-38defa389b64'::uuid
    and b.original_filename = 'EtatduParc.csv'
    and b.metadata->>'vehicle_state_status' = 'ready'
  order by coalesce((b.metadata->>'modified_at')::bigint,0) desc, b.imported_at desc
  limit 1
), current_vehicles as (
  select
    s.id,
    s.registration,
    s.work_order,
    s.vin,
    s.client,
    s.model,
    s.status,
    s.status_age_days,
    s.factory_age_days,
    s.alert,
    s.urgency,
    s.metadata->>'type' as flow,
    s.snapshot_at,
    s.source_modified_at
  from latest_batch b
  join public.kpi_ftp_vehicle_state s on s.import_batch_id = b.id
  where s.metadata->>'type' in ('VOP EFF','VOP EXT')
    and coalesce(s.status,'') not in (
      'Transport à vide',
      'En attente de transport aller',
      'Sortie Usine',
      'En attente de transport retour',
      'Transport retour planifié',
      'Transport retour effectué'
    )
)
select
  c.*,
  b.sample_count,
  b.median_days,
  b.p75_days,
  b.p90_days,
  case
    when c.status_age_days is null or b.sample_count is null or b.sample_count < 5 then 'INSUFFICISANT'
    when c.status_age_days > greatest(coalesce(b.p90_days,0), coalesce(b.median_days,0)*2, 0.50) then 'CRITIQUE'
    when c.status_age_days > greatest(coalesce(b.p75_days,0), coalesce(b.median_days,0)*1.5, 0.25) then 'SURVEILLANCE'
    else 'NORMAL'
  end as drift_level,
  case
    when c.status_age_days is null or b.p75_days is null or b.p75_days <= 0 then null
    else round((c.status_age_days / b.p75_days)::numeric, 2)
  end as drift_ratio
from current_vehicles c
left join public.kpi_ftp_status_duration_baselines b
  on b.flow = c.flow and b.status = c.status;

create or replace view public.kpi_ftp_proactive_drift as
select
  registration,
  work_order,
  vin,
  client,
  model,
  flow,
  status,
  status_age_days,
  factory_age_days,
  alert,
  urgency,
  sample_count,
  median_days,
  p75_days,
  p90_days,
  case
    when sample_count < 5 or status_age_days is null or factory_age_days is null then 'INSUFFICISANT'
    when factory_age_days >= 15 then 'FIFO'
    when status_age_days > greatest(coalesce(p90_days,0) * 4, 3.0) then 'CRITIQUE'
    when status_age_days > greatest(coalesce(p75_days,0) * 3, 1.5) then 'SURVEILLANCE'
    else 'NORMAL'
  end as proactive_level,
  case
    when p75_days is null or p75_days <= 0 or status_age_days is null then null
    else round((status_age_days / p75_days)::numeric,2)
  end as abnormality_ratio,
  snapshot_at,
  source_modified_at
from public.kpi_ftp_current_drift;

grant select on public.kpi_ftp_status_duration_baselines to service_role;
grant select on public.kpi_ftp_current_drift to service_role;
grant select on public.kpi_ftp_proactive_drift to service_role;
revoke all on public.kpi_ftp_status_duration_baselines from anon, authenticated;
revoke all on public.kpi_ftp_current_drift from anon, authenticated;
revoke all on public.kpi_ftp_proactive_drift from anon, authenticated;
