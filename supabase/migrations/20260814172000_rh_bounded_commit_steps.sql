alter table public.kpi_rh_import_batches
  add column if not exists committed_rows integer not null default 0 check (committed_rows >= 0);

create index if not exists kpi_rh_presence_staging_batch_date_idx
  on public.kpi_rh_presence_staging(batch_id, work_date, row_index);

create index if not exists kpi_sql_presence_facts_source_date_idx
  on public.kpi_sql_presence_facts(source_name, work_date);

create or replace function public.kpi_rh_batch_commit_step_admin(
  p_session_hash text,
  p_batch_id uuid,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user record;
  v_batch public.kpi_rh_import_batches%rowtype;
  v_received integer;
  v_dates date[];
  v_processed integer := 0;
  v_committed integer := 0;
  v_remaining integer := 0;
  v_staff integer := 0;
  v_now timestamptz := now();
begin
  select * into v_user
  from public.crvo_auth_validate(p_session_hash)
  where ok and role='admin'
  limit 1;
  if v_user is null then
    raise exception 'Accès administrateur CRVO requis.' using errcode='42501';
  end if;

  select * into v_batch
  from public.kpi_rh_import_batches
  where id=p_batch_id
  for update;

  if v_batch.id is null then raise exception 'Lot RH introuvable.'; end if;
  if v_batch.status='imported' then
    return jsonb_build_object(
      'imported', true,
      'rows', v_batch.total_rows,
      'staffSaved', coalesce((v_batch.metadata->>'staff_saved')::integer,0),
      'dateRange', jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date),
      'filename', v_batch.filename,
      'headers', v_batch.headers
    );
  end if;
  if v_batch.status <> 'processing' then raise exception 'Lot RH non finalisable.'; end if;

  select count(*) into v_received
  from public.kpi_rh_presence_staging
  where batch_id=p_batch_id;

  if v_received + v_batch.committed_rows <> v_batch.total_rows then
    raise exception 'Import incomplet : % lignes disponibles sur % attendues.', v_received + v_batch.committed_rows, v_batch.total_rows;
  end if;

  select array_agg(work_date order by work_date) into v_dates
  from (
    select distinct work_date
    from public.kpi_rh_presence_staging
    where batch_id=p_batch_id
    order by work_date
    limit greatest(1,least(coalesce(p_days,30),90))
  ) d;

  if coalesce(array_length(v_dates,1),0) > 0 then
    delete from public.kpi_sql_presence_facts
    where source_name='Direct Data RH'
      and work_date = any(v_dates);

    insert into public.kpi_sql_presence_facts(
      source_row_hash,work_date,mechanic_name,time_code,time_description,time_value,source_name,source_synced_at
    )
    select
      'rh:' || p_batch_id::text || ':' || s.row_index::text,
      s.work_date,
      s.mechanic_name,
      s.time_code,
      s.time_description,
      s.time_value,
      'Direct Data RH',
      v_now
    from public.kpi_rh_presence_staging s
    where s.batch_id=p_batch_id
      and s.work_date = any(v_dates)
    on conflict (source_row_hash) do update set
      work_date=excluded.work_date,
      mechanic_name=excluded.mechanic_name,
      time_code=excluded.time_code,
      time_description=excluded.time_description,
      time_value=excluded.time_value,
      source_name=excluded.source_name,
      source_synced_at=excluded.source_synced_at;

    with raw as (
      select s.*,
        case
          when nullif(btrim(s.matricule),'') is not null then 'matricule:' || lower(btrim(s.matricule))
          else 'nom:' || encode(extensions.digest(lower(btrim(s.mechanic_name)),'sha256'),'hex')
        end as employee_key
      from public.kpi_rh_presence_staging s
      where s.batch_id=p_batch_id
        and s.work_date = any(v_dates)
    ), ranked as (
      select r.*,
        row_number() over (partition by r.employee_key order by r.work_date desc, r.row_index desc) as rn
      from raw r
    ), up as (
      insert into public.kpi_rh_staff_dimension(
        employee_key,matricule,first_name,last_name,full_name,name_key,service,team_code,source_filename,source_updated_at,metadata
      )
      select
        employee_key,
        matricule,
        first_name,
        last_name,
        mechanic_name,
        lower(btrim(mechanic_name)),
        service,
        team_code,
        v_batch.filename,
        v_now,
        jsonb_build_object(
          'delivery_channel','browser_chunked',
          'source_file_sha256',v_batch.file_sha256,
          'source_batch_id',p_batch_id
        )
      from ranked
      where rn=1
      on conflict (employee_key) do update set
        matricule=coalesce(excluded.matricule,public.kpi_rh_staff_dimension.matricule),
        first_name=coalesce(excluded.first_name,public.kpi_rh_staff_dimension.first_name),
        last_name=coalesce(excluded.last_name,public.kpi_rh_staff_dimension.last_name),
        full_name=excluded.full_name,
        name_key=excluded.name_key,
        service=coalesce(excluded.service,public.kpi_rh_staff_dimension.service),
        team_code=coalesce(excluded.team_code,public.kpi_rh_staff_dimension.team_code),
        source_filename=excluded.source_filename,
        source_updated_at=excluded.source_updated_at,
        metadata=excluded.metadata
      returning 1
    )
    select count(*) into v_staff from up;

    delete from public.kpi_rh_presence_staging
    where batch_id=p_batch_id
      and work_date = any(v_dates);
    get diagnostics v_processed = row_count;

    v_committed := v_batch.committed_rows + v_processed;
    update public.kpi_rh_import_batches
    set committed_rows=v_committed,
        metadata = metadata || jsonb_build_object(
          'delivery_channel','browser_chunked',
          'commit_mode','bounded_by_date',
          'last_commit_at',v_now,
          'last_commit_rows',v_processed
        )
    where id=p_batch_id;
  else
    v_committed := v_batch.committed_rows;
  end if;

  select count(*) into v_remaining
  from public.kpi_rh_presence_staging
  where batch_id=p_batch_id;

  if v_remaining=0 and v_committed=v_batch.total_rows then
    select count(*) into v_staff
    from public.kpi_rh_staff_dimension
    where metadata->>'source_batch_id'=p_batch_id::text;

    insert into public.kpi_sql_presence_sync_runs(
      completed_at,status,sync_mode,from_date,rows_fetched,rows_saved,min_work_date,max_work_date,metadata
    ) values (
      v_now,'success','direct_upload',v_batch.min_date,v_batch.total_rows,v_batch.total_rows,v_batch.min_date,v_batch.max_date,
      jsonb_build_object(
        'delivery_channel','browser_chunked',
        'commit_mode','bounded_by_date',
        'source_file_sha256',v_batch.file_sha256,
        'source_filename',v_batch.filename,
        'staff_dimension_rows',v_staff,
        'detected_columns',v_batch.headers
      )
    );

    update public.kpi_rh_import_batches
    set status='imported',
        committed_rows=v_batch.total_rows,
        completed_at=v_now,
        error_message=null,
        metadata=metadata || jsonb_build_object('staff_saved',v_staff,'finalized_at',v_now)
    where id=p_batch_id;

    return jsonb_build_object(
      'imported',true,
      'rows',v_batch.total_rows,
      'committedRows',v_batch.total_rows,
      'remainingRows',0,
      'staffSaved',v_staff,
      'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date),
      'filename',v_batch.filename,
      'headers',v_batch.headers
    );
  end if;

  return jsonb_build_object(
    'imported',false,
    'phase','commit',
    'processedRows',v_processed,
    'committedRows',v_committed,
    'remainingRows',v_remaining,
    'rows',v_batch.total_rows,
    'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date),
    'filename',v_batch.filename
  );
end;
$$;

revoke all on function public.kpi_rh_batch_commit_step_admin(text,uuid,integer) from public;
grant execute on function public.kpi_rh_batch_commit_step_admin(text,uuid,integer) to anon, authenticated, service_role;
