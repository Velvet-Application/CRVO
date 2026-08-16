create or replace function public.kpi_ftp_import_history_get(
  p_token_hash text,
  p_hours integer default 168,
  p_limit integer default 250
)
returns table(payload jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_hours integer := greatest(1, least(coalesce(p_hours,168), 720));
  v_limit integer := greatest(10, least(coalesce(p_limit,250), 500));
begin
  select exists(
    select 1
    from public.crvo_auth_sessions s
    join public.crvo_auth_users u on u.id=s.user_id
    where s.token_hash=p_token_hash
      and s.revoked_at is null
      and s.expires_at>now()
      and u.is_active=true
  ) into v_ok;

  if not v_ok then
    return query select jsonb_build_object('ok',false,'error','Session CRVO requise.');
    return;
  end if;

  return query
  with raw as (
    select
      b.id,
      b.snapshot_at,
      coalesce(nullif(regexp_replace(coalesce(b.metadata->>'remote_path',''), '^.*/', ''), ''), b.original_filename) as filename,
      b.original_filename as archived_filename,
      b.status,
      b.imported_at,
      case
        when coalesce(b.metadata->>'modified_at','') ~ '^[0-9]+(\.[0-9]+)?$'
          then to_timestamp((b.metadata->>'modified_at')::double precision / 1000.0)
        else null
      end as deposit_at,
      coalesce(
        nullif(b.metadata->>'vehicle_state_loaded_at','')::timestamptz,
        nullif(b.metadata->>'factory_production_loaded_at','')::timestamptz,
        nullif(b.metadata->>'status_history_loaded_at','')::timestamptz,
        nullif(b.metadata->>'lead_time_loaded_at','')::timestamptz,
        b.imported_at
      ) as ready_at,
      case
        when coalesce(b.metadata->>'csv_row_count','') ~ '^[0-9]+$' then (b.metadata->>'csv_row_count')::integer
        else coalesce(b.row_count,0)::integer
      end as rows_count,
      coalesce(b.metadata->>'remote_path','') as remote_path
    from public.kpi_import_batches b
    join public.kpi_data_sources s on s.id=b.source_id
    where s.kind='ftp'
      and b.imported_at >= now() - make_interval(hours => v_hours)
  ),
  history as (
    select * from raw order by imported_at desc limit v_limit
  ),
  file_summary as (
    select
      filename,
      count(*)::integer as imports,
      max(deposit_at) as last_deposit_at,
      max(imported_at) as last_import_at,
      max(ready_at) as last_ready_at,
      round(avg(extract(epoch from (imported_at-deposit_at))/60.0)::numeric,1) as avg_delay_min,
      round(min(extract(epoch from (imported_at-deposit_at))/60.0)::numeric,1) as min_delay_min,
      round(max(extract(epoch from (imported_at-deposit_at))/60.0)::numeric,1) as max_delay_min
    from raw
    where deposit_at is not null
    group by filename
  ),
  bridges as (
    select started_at,finished_at,status,files_seen,files_imported,details
    from public.kpi_bridge_runs
    where started_at >= now() - make_interval(hours => v_hours)
    order by started_at desc
    limit 40
  )
  select jsonb_build_object(
    'ok',true,
    'generatedAt',now(),
    'windowHours',v_hours,
    'cadenceMinutes',15,
    'history',coalesce((select jsonb_agg(jsonb_build_object(
      'snapshotAt',h.snapshot_at,
      'filename',h.filename,
      'archivedFilename',h.archived_filename,
      'depositAt',h.deposit_at,
      'importedAt',h.imported_at,
      'readyAt',h.ready_at,
      'delayMinutes',case when h.deposit_at is null then null else round((extract(epoch from (h.imported_at-h.deposit_at))/60.0)::numeric,1) end,
      'status',h.status,
      'rows',h.rows_count,
      'remotePath',h.remote_path
    ) order by h.imported_at desc) from history h),'[]'::jsonb),
    'files',coalesce((select jsonb_agg(jsonb_build_object(
      'filename',f.filename,
      'imports',f.imports,
      'lastDepositAt',f.last_deposit_at,
      'lastImportAt',f.last_import_at,
      'lastReadyAt',f.last_ready_at,
      'avgDelayMinutes',f.avg_delay_min,
      'minDelayMinutes',f.min_delay_min,
      'maxDelayMinutes',f.max_delay_min
    ) order by f.last_deposit_at desc nulls last) from file_summary f),'[]'::jsonb),
    'bridgeRuns',coalesce((select jsonb_agg(jsonb_build_object(
      'startedAt',b.started_at,
      'finishedAt',b.finished_at,
      'status',b.status,
      'filesSeen',b.files_seen,
      'filesImported',b.files_imported,
      'protocol',coalesce(b.details->>'protocol','ftp')
    ) order by b.started_at desc) from bridges b),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.kpi_ftp_import_history_get(text,integer,integer) from public;
grant execute on function public.kpi_ftp_import_history_get(text,integer,integer) to anon, authenticated;
