-- Free-tier safety policy for KPI CRVO.
-- Supabase Free: keep the live database comfortably below 500 MB and Storage below 1 GB.
-- Detailed technical snapshots are compacted before deletion; business KPI history remains retained.

create table if not exists public.kpi_ftp_daily_kpi_archive (
  snapshot_at date primary key,
  source_name text,
  metrics jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now()
);

create table if not exists public.kpi_ftp_vehicle_state_daily_archive (
  snapshot_at date primary key,
  vehicle_count integer not null default 0,
  vop_count integer not null default 0,
  stock_over_15d integer not null default 0,
  stock_over_20d integer not null default 0,
  alert_count integer not null default 0,
  avg_factory_age_days numeric,
  status_counts jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now()
);

create table if not exists public.kpi_vehicle_workload_daily_archive (
  snapshot_at date not null,
  sector_key text not null,
  vehicle_count integer not null default 0,
  remaining_minutes numeric not null default 0,
  booked_minutes numeric not null default 0,
  potential_revenue_total numeric not null default 0,
  avg_age_days numeric,
  archived_at timestamptz not null default now(),
  primary key(snapshot_at,sector_key)
);

create table if not exists public.kpi_ftp_status_daily_archive (
  event_date date not null,
  flow text not null,
  status text not null,
  event_count integer not null default 0,
  vehicle_count integer not null default 0,
  archived_at timestamptz not null default now(),
  primary key(event_date,flow,status)
);

create table if not exists public.kpi_status_duration_baseline_archive (
  snapshot_date date not null,
  flow text not null,
  status text not null,
  sample_count integer not null default 0,
  median_days numeric,
  p75_days numeric,
  p90_days numeric,
  average_days numeric,
  archived_at timestamptz not null default now(),
  primary key(snapshot_date,flow,status)
);

create table if not exists public.kpi_retention_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  deleted_rows jsonb not null default '{}'::jsonb,
  deleted_objects integer not null default 0,
  deleted_bytes bigint not null default 0,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'running' check(status in ('running','success','failed'))
);

revoke all on public.kpi_ftp_daily_kpi_archive, public.kpi_ftp_vehicle_state_daily_archive,
  public.kpi_vehicle_workload_daily_archive, public.kpi_ftp_status_daily_archive,
  public.kpi_status_duration_baseline_archive, public.kpi_retention_runs from anon, authenticated, public;
grant all on public.kpi_ftp_daily_kpi_archive, public.kpi_ftp_vehicle_state_daily_archive,
  public.kpi_vehicle_workload_daily_archive, public.kpi_ftp_status_daily_archive,
  public.kpi_status_duration_baseline_archive, public.kpi_retention_runs to service_role;

-- Speeds up the health endpoint's latest park lookup and avoids the observed statement timeouts.
create index if not exists kpi_ftp_vehicle_state_latest_idx
  on public.kpi_ftp_vehicle_state(source_modified_at desc nulls last, created_at desc)
  include(import_batch_id);
create index if not exists kpi_notification_reads_user_id_idx on public.kpi_notification_reads(user_id);

create or replace function public.kpi_retention_compact_database()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_vehicle_cutoff date := v_today - 4;
  v_workload_cutoff date := v_today - 7;
  v_status_cutoff date := v_today - 21;
  v_vehicle_deleted integer := 0;
  v_workload_deleted integer := 0;
  v_status_deleted integer := 0;
  v_run uuid;
begin
  insert into public.kpi_retention_runs(run_kind) values('database') returning id into v_run;

  insert into public.kpi_ftp_daily_kpi_archive(snapshot_at,source_name,metrics,archived_at)
  select h.snapshot_at,h.source_name,h.metrics,now()
  from public.kpi_ftp_daily_history h
  where h.snapshot_at < v_vehicle_cutoff
  on conflict(snapshot_at) do update set source_name=excluded.source_name,metrics=excluded.metrics,archived_at=excluded.archived_at;

  with batch_rank as (
    select b.id,b.snapshot_at,
      row_number() over(partition by b.snapshot_at order by coalesce(nullif(b.metadata->>'modified_at','')::bigint,0) desc,b.imported_at desc) rn
    from public.kpi_import_batches b
    where b.original_filename='EtatduParc.csv' and b.metadata->>'vehicle_state_status'='ready'
      and b.snapshot_at < v_vehicle_cutoff
  ), latest as (
    select id from batch_rank where rn=1
  ), base as (
    select v.*,
      coalesce(nullif(trim(v.vin),''),nullif(trim(v.registration),''),nullif(trim(v.work_order),''),v.id::text) vehicle_key
    from latest l join public.kpi_ftp_vehicle_state v on v.import_batch_id=l.id
  ), dedup as (
    select distinct on(snapshot_at,vehicle_key) * from base
    order by snapshot_at,vehicle_key,status_at desc nulls last,created_at desc,id desc
  ), status_json as (
    select snapshot_at,jsonb_object_agg(status_key,cnt) status_counts
    from (
      select snapshot_at,coalesce(nullif(trim(status),''),'INCONNU') status_key,count(*) cnt
      from dedup group by snapshot_at,coalesce(nullif(trim(status),''),'INCONNU')
    ) s group by snapshot_at
  )
  insert into public.kpi_ftp_vehicle_state_daily_archive(snapshot_at,vehicle_count,vop_count,stock_over_15d,stock_over_20d,alert_count,avg_factory_age_days,status_counts,archived_at)
  select d.snapshot_at,count(*)::int,
    count(*) filter(where d.metadata->>'type' in ('VOP EFF','VOP EXT'))::int,
    count(*) filter(where d.metadata->>'type' in ('VOP EFF','VOP EXT') and coalesce(d.factory_age_days,0)>15)::int,
    count(*) filter(where d.metadata->>'type' in ('VOP EFF','VOP EXT') and coalesce(d.factory_age_days,0)>20)::int,
    count(*) filter(where nullif(trim(coalesce(d.alert,'')),'') is not null)::int,
    round(avg(d.factory_age_days),2),coalesce(s.status_counts,'{}'::jsonb),now()
  from dedup d left join status_json s using(snapshot_at)
  group by d.snapshot_at,s.status_counts
  on conflict(snapshot_at) do update set vehicle_count=excluded.vehicle_count,vop_count=excluded.vop_count,
    stock_over_15d=excluded.stock_over_15d,stock_over_20d=excluded.stock_over_20d,alert_count=excluded.alert_count,
    avg_factory_age_days=excluded.avg_factory_age_days,status_counts=excluded.status_counts,archived_at=excluded.archived_at;

  insert into public.kpi_vehicle_workload_daily_archive(snapshot_at,sector_key,vehicle_count,remaining_minutes,booked_minutes,potential_revenue_total,avg_age_days,archived_at)
  select snapshot_at,coalesce(nullif(trim(sector_key),''),'autre'),
    count(distinct coalesce(nullif(trim(work_order),''),nullif(trim(vin),''),nullif(trim(registration),''),id::text))::int,
    coalesce(sum(remaining_minutes),0),coalesce(sum(booked_minutes),0),coalesce(sum(potential_revenue_total),0),round(avg(age_days),2),now()
  from public.kpi_vehicle_workload
  where snapshot_at < v_workload_cutoff
  group by snapshot_at,coalesce(nullif(trim(sector_key),''),'autre')
  on conflict(snapshot_at,sector_key) do update set vehicle_count=excluded.vehicle_count,remaining_minutes=excluded.remaining_minutes,
    booked_minutes=excluded.booked_minutes,potential_revenue_total=excluded.potential_revenue_total,avg_age_days=excluded.avg_age_days,archived_at=excluded.archived_at;

  insert into public.kpi_ftp_status_daily_archive(event_date,flow,status,event_count,vehicle_count,archived_at)
  select event_date,coalesce(nullif(trim(flow),''),'INCONNU'),coalesce(nullif(trim(status),''),'INCONNU'),count(*)::int,
    count(distinct coalesce(nullif(trim(vin),''),nullif(trim(work_order),''),nullif(trim(registration),''),id::text))::int,now()
  from public.kpi_ftp_status_events
  where event_date < v_status_cutoff
  group by event_date,coalesce(nullif(trim(flow),''),'INCONNU'),coalesce(nullif(trim(status),''),'INCONNU')
  on conflict(event_date,flow,status) do update set event_count=excluded.event_count,vehicle_count=excluded.vehicle_count,archived_at=excluded.archived_at;

  insert into public.kpi_status_duration_baseline_archive(snapshot_date,flow,status,sample_count,median_days,p75_days,p90_days,average_days,archived_at)
  select v_today,flow,status,sample_count,median_days,p75_days,p90_days,average_days,now()
  from public.kpi_ftp_status_duration_baselines
  on conflict(snapshot_date,flow,status) do update set sample_count=excluded.sample_count,median_days=excluded.median_days,
    p75_days=excluded.p75_days,p90_days=excluded.p90_days,average_days=excluded.average_days,archived_at=excluded.archived_at;

  delete from public.kpi_ftp_vehicle_state where snapshot_at < v_vehicle_cutoff;
  get diagnostics v_vehicle_deleted=row_count;
  delete from public.kpi_vehicle_workload where snapshot_at < v_workload_cutoff;
  get diagnostics v_workload_deleted=row_count;
  delete from public.kpi_ftp_status_events where event_date < v_status_cutoff;
  get diagnostics v_status_deleted=row_count;

  update public.kpi_retention_runs set finished_at=now(),status='success',deleted_rows=jsonb_build_object(
    'kpi_ftp_vehicle_state',v_vehicle_deleted,
    'kpi_vehicle_workload',v_workload_deleted,
    'kpi_ftp_status_events',v_status_deleted
  ),details=jsonb_build_object('vehicleStateDetailDays',4,'workloadDetailDays',7,'statusEventDetailDays',21)
  where id=v_run;

  return jsonb_build_object('ok',true,'vehicleStateDeleted',v_vehicle_deleted,'workloadDeleted',v_workload_deleted,'statusEventsDeleted',v_status_deleted);
exception when others then
  update public.kpi_retention_runs set finished_at=now(),status='failed',details=jsonb_build_object('error',sqlerrm) where id=v_run;
  raise;
end
$function$;

create or replace function public.kpi_free_tier_capacity_guard()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_db bigint := pg_database_size(current_database());
  v_storage bigint := coalesce((select sum(coalesce((metadata->>'size')::bigint,0)) from storage.objects),0);
  v_db_warn bigint := 350*1024*1024;
  v_db_crit bigint := 450*1024*1024;
  v_storage_warn bigint := 700*1024*1024;
  v_storage_crit bigint := 900*1024*1024;
  v_db_sev text;
  v_storage_sev text;
begin
  v_db_sev := case when v_db>=v_db_crit then 'critical' when v_db>=v_db_warn then 'warning' else null end;
  v_storage_sev := case when v_storage>=v_storage_crit then 'critical' when v_storage>=v_storage_warn then 'warning' else null end;

  if v_db_sev is not null then
    insert into public.kpi_notifications(kind,severity,entity,source_key,title,message,metadata)
    values('capacity_warning',v_db_sev,'CRVO','capacity:supabase:database','Capacité Supabase · base',
      format('Base KPI CRVO à %.1f MB sur 500 MB Free.',v_db/1048576.0),jsonb_build_object('bytes',v_db,'limitBytes',500*1024*1024,'warningBytes',v_db_warn))
    on conflict(source_key) do update set severity=excluded.severity,message=excluded.message,metadata=excluded.metadata,resolved_at=null,created_at=now();
  else
    update public.kpi_notifications set resolved_at=coalesce(resolved_at,now()) where source_key='capacity:supabase:database' and resolved_at is null;
  end if;

  if v_storage_sev is not null then
    insert into public.kpi_notifications(kind,severity,entity,source_key,title,message,metadata)
    values('capacity_warning',v_storage_sev,'CRVO','capacity:supabase:storage','Capacité Supabase · Storage',
      format('Storage KPI CRVO à %.1f MB sur 1 GB Free.',v_storage/1048576.0),jsonb_build_object('bytes',v_storage,'limitBytes',1024*1024*1024,'warningBytes',v_storage_warn))
    on conflict(source_key) do update set severity=excluded.severity,message=excluded.message,metadata=excluded.metadata,resolved_at=null,created_at=now();
  else
    update public.kpi_notifications set resolved_at=coalesce(resolved_at,now()) where source_key='capacity:supabase:storage' and resolved_at is null;
  end if;

  return jsonb_build_object('databaseBytes',v_db,'storageBytes',v_storage,
    'databasePctFreeLimit',round(v_db::numeric/(500*1024*1024)*100,1),
    'storagePctFreeLimit',round(v_storage::numeric/(1024*1024*1024)*100,1));
end
$function$;

revoke all on function public.kpi_retention_compact_database() from public,anon,authenticated;
revoke all on function public.kpi_free_tier_capacity_guard() from public,anon,authenticated;
grant execute on function public.kpi_retention_compact_database() to service_role;
grant execute on function public.kpi_free_tier_capacity_guard() to service_role;

do $$ declare j bigint; begin
  for j in select jobid from cron.job where jobname='crvo-free-tier-db-retention' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('crvo-free-tier-db-retention','10 2 * * *','select public.kpi_retention_compact_database();');
  for j in select jobid from cron.job where jobname='crvo-free-tier-capacity-guard' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('crvo-free-tier-capacity-guard','17 * * * *','select public.kpi_free_tier_capacity_guard();');
end $$;

-- Storage cleanup is performed through the Storage API by the kpi-retention-cleanup Edge Function.
-- The two Vault secrets are provisioned directly in Supabase and intentionally never committed:
-- crvo_retention_project_url / crvo_retention_anon_jwt.
do $$ declare j bigint; begin
  for j in select jobid from cron.job where jobname='crvo-free-tier-storage-retention' loop perform cron.unschedule(j); end loop;
  perform cron.schedule(
    'crvo-free-tier-storage-retention','25 2 * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name='crvo_retention_project_url' limit 1) || '/functions/v1/kpi-retention-cleanup',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'apikey',(select decrypted_secret from vault.decrypted_secrets where name='crvo_retention_anon_jwt' limit 1),
          'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='crvo_retention_anon_jwt' limit 1)
        ),
        body := jsonb_build_object('source','pg_cron','requestedAt',now()),
        timeout_milliseconds := 30000
      ) as request_id;
    $cron$
  );
end $$;
