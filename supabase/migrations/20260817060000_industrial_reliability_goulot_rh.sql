-- Reliability hardening for the industrial dashboard.
-- 1) Read bottleneck data through one authenticated RPC instead of three REST calls.
-- 2) Keep RH consolidation in small bounded transactions to avoid statement timeouts.

create or replace function public.kpi_bottlenecks_get(
  p_token_hash text,
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_days integer := greatest(7, least(coalesce(p_days,30), 60));
  v_cutoff date;
  v_month date;
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
    raise exception 'Session CRVO requise.' using errcode='42501';
  end if;

  v_cutoff := v_today - (v_days - 1);
  v_month := date_trunc('month',v_today)::date;

  return jsonb_build_object(
    'ok',true,
    'today',v_today,
    'cutoff',v_cutoff,
    'month',v_month,
    'frozenRows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'snapshot_date',d.snapshot_date,
        'sector_key',d.sector_key,
        'sector_label',d.sector_label,
        'vehicle_count',d.vehicle_count,
        'source_modified_at',d.source_modified_at,
        'frozen_at',d.frozen_at
      ) order by d.snapshot_date,d.sector_key)
      from public.kpi_bottleneck_daily_snapshots d
      where d.snapshot_date between v_cutoff and v_today
    ),'[]'::jsonb),
    'liveRows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'snapshot_date',d.snapshot_date,
        'sector_key',d.sector_key,
        'sector_label',d.sector_label,
        'vehicle_count',d.vehicle_count,
        'source_modified_at',d.source_modified_at,
        'frozen',d.frozen_at > '1970-01-02 00:00:00+00'::timestamptz
      ) order by d.sector_key)
      from public.kpi_bottleneck_daily_snapshots d
      where d.snapshot_date=v_today
    ),'[]'::jsonb),
    'objectiveRows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sector_key',o.sector_key,
        'sector_label',o.sector_label,
        'daily_target',o.daily_target,
        'max_threshold',o.max_threshold
      ) order by o.sector_key)
      from public.kpi_monthly_objectives o
      where o.month=v_month
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.kpi_bottlenecks_get(text,integer) from public;
grant execute on function public.kpi_bottlenecks_get(text,integer) to anon, authenticated;

create or replace function public.kpi_rh_batch_commit_step_admin(
  p_session_hash text,
  p_batch_id uuid,
  p_days integer default 7
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user record;
  v_batch public.kpi_rh_import_batches%rowtype;
  v_dates date[];
  v_processed integer:=0;
  v_committed integer:=0;
  v_remaining integer:=0;
  v_staff integer:=0;
  v_now timestamptz:=now();
  v_step_days integer:=greatest(1,least(coalesce(p_days,7),14));
begin
  select * into v_user from public.kpi_data_rh_access(p_session_hash) limit 1;
  if v_user is null then raise exception 'Droit Data RH requis.' using errcode='42501'; end if;

  select * into v_batch from public.kpi_rh_import_batches where id=p_batch_id for update;
  if v_batch.id is null then raise exception 'Lot RH introuvable.'; end if;
  if v_batch.status='imported' then
    return jsonb_build_object('imported',true,'rows',v_batch.total_rows,'staffSaved',coalesce((v_batch.metadata->>'staff_saved')::integer,0),'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date),'filename',v_batch.filename,'headers',v_batch.headers);
  end if;
  if v_batch.status<>'processing' then raise exception 'Lot RH non finalisable.'; end if;

  if v_batch.committed_rows=0 and coalesce(v_batch.received_rows,0)<>v_batch.total_rows then
    raise exception 'Import incomplet : % lignes reçues sur % attendues.',coalesce(v_batch.received_rows,0),v_batch.total_rows;
  end if;

  select array_agg(work_date order by work_date) into v_dates
  from (
    select distinct work_date
    from public.kpi_rh_presence_staging
    where batch_id=p_batch_id
    order by work_date
    limit v_step_days
  ) d;

  if coalesce(array_length(v_dates,1),0)>0 then
    delete from public.kpi_sql_presence_facts
    where source_name='Direct Data RH' and work_date=any(v_dates);

    insert into public.kpi_sql_presence_facts(source_row_hash,work_date,mechanic_name,time_code,time_description,time_value,source_name,source_synced_at)
    select 'rh:'||p_batch_id::text||':'||s.row_index::text,s.work_date,s.mechanic_name,s.time_code,s.time_description,s.time_value,'Direct Data RH',v_now
    from public.kpi_rh_presence_staging s
    where s.batch_id=p_batch_id and s.work_date=any(v_dates)
    on conflict(source_row_hash) do update set
      work_date=excluded.work_date,mechanic_name=excluded.mechanic_name,time_code=excluded.time_code,time_description=excluded.time_description,
      time_value=excluded.time_value,source_name=excluded.source_name,source_synced_at=excluded.source_synced_at;

    with raw as (
      select s.*,
        case when nullif(btrim(s.matricule),'') is not null then 'matricule:'||lower(btrim(s.matricule))
             else 'nom:'||encode(extensions.digest(public.kpi_normalize_person_name(public.kpi_rh_base_name(s.mechanic_name)),'sha256'),'hex') end employee_key
      from public.kpi_rh_presence_staging s
      where s.batch_id=p_batch_id and s.work_date=any(v_dates)
    ), ranked as (
      select r.*,row_number() over(partition by r.employee_key order by r.work_date desc,r.row_index desc) rn
      from raw r
    ), up as (
      insert into public.kpi_rh_staff_dimension(employee_key,matricule,first_name,last_name,full_name,name_key,service,team_code,source_filename,source_updated_at,metadata)
      select employee_key,
        coalesce(nullif(btrim(matricule),''),public.kpi_rh_matricule_from_name(mechanic_name)),
        first_name,last_name,
        public.kpi_rh_base_name(mechanic_name),
        public.kpi_normalize_person_name(public.kpi_rh_base_name(mechanic_name)),
        coalesce(nullif(btrim(service),''),public.kpi_rh_service_from_name(mechanic_name)),
        coalesce(case when upper(coalesce(team_code,'')) in ('A','B','C') then upper(team_code) else null end,public.kpi_rh_team_from_name(mechanic_name)),
        v_batch.filename,v_now,
        jsonb_build_object('delivery_channel','browser_chunked','source_file_sha256',v_batch.file_sha256,'source_batch_id',p_batch_id)
      from ranked where rn=1
      on conflict(employee_key) do update set
        matricule=coalesce(excluded.matricule,public.kpi_rh_staff_dimension.matricule),
        first_name=coalesce(excluded.first_name,public.kpi_rh_staff_dimension.first_name),
        last_name=coalesce(excluded.last_name,public.kpi_rh_staff_dimension.last_name),
        full_name=excluded.full_name,name_key=excluded.name_key,
        service=coalesce(excluded.service,public.kpi_rh_staff_dimension.service),
        team_code=coalesce(excluded.team_code,public.kpi_rh_staff_dimension.team_code),
        source_filename=excluded.source_filename,source_updated_at=excluded.source_updated_at,metadata=excluded.metadata
      returning 1
    ) select count(*) into v_staff from up;

    delete from public.kpi_rh_presence_staging where batch_id=p_batch_id and work_date=any(v_dates);
    get diagnostics v_processed=row_count;
    v_committed:=v_batch.committed_rows+v_processed;
    update public.kpi_rh_import_batches set committed_rows=v_committed,
      metadata=metadata||jsonb_build_object('delivery_channel','browser_chunked','commit_mode','bounded_by_date','last_commit_at',v_now,'last_commit_rows',v_processed,'commit_step_days',v_step_days)
    where id=p_batch_id;
  else
    v_committed:=v_batch.committed_rows;
  end if;

  v_remaining:=greatest(v_batch.total_rows-v_committed,0);
  if v_remaining=0 and v_committed=v_batch.total_rows then
    select count(*) into v_staff from public.kpi_rh_staff_dimension where metadata->>'source_batch_id'=p_batch_id::text;
    insert into public.kpi_sql_presence_sync_runs(completed_at,status,sync_mode,from_date,rows_fetched,rows_saved,min_work_date,max_work_date,metadata)
    values(v_now,'success','direct_upload',v_batch.min_date,v_batch.total_rows,v_batch.total_rows,v_batch.min_date,v_batch.max_date,
      jsonb_build_object('delivery_channel','browser_chunked','commit_mode','bounded_by_date','source_file_sha256',v_batch.file_sha256,'source_filename',v_batch.filename,'staff_dimension_rows',v_staff,'detected_columns',v_batch.headers));
    update public.kpi_rh_import_batches set status='imported',committed_rows=v_batch.total_rows,completed_at=v_now,error_message=null,
      metadata=metadata||jsonb_build_object('staff_saved',v_staff,'finalized_at',v_now)
    where id=p_batch_id;
    return jsonb_build_object('imported',true,'rows',v_batch.total_rows,'committedRows',v_batch.total_rows,'remainingRows',0,'staffSaved',v_staff,'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date),'filename',v_batch.filename,'headers',v_batch.headers,'stepDays',v_step_days);
  end if;

  return jsonb_build_object('imported',false,'phase','commit','processedRows',v_processed,'committedRows',v_committed,'remainingRows',v_remaining,'rows',v_batch.total_rows,'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date),'filename',v_batch.filename,'stepDays',v_step_days);
end;
$$;

revoke all on function public.kpi_rh_batch_commit_step_admin(text,uuid,integer) from public;
grant execute on function public.kpi_rh_batch_commit_step_admin(text,uuid,integer) to anon, authenticated, service_role;
