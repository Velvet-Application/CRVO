-- A timed-out import must be resumable and commit work must stay bounded even if
-- an older client asks PostgreSQL to process several thousand rows at once.

create or replace function public.kpi_ops_batch_start_admin(
  p_session_hash text,
  p_source_key text,
  p_filename text,
  p_file_sha256 text,
  p_byte_size bigint,
  p_min_date date,
  p_max_date date,
  p_total_rows integer,
  p_headers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
set statement_timeout to '30s'
set lock_timeout to '8s'
as $function$
declare
  v_user record;
  v_existing record;
  v_processing record;
  v_id uuid;
begin
  select * into v_user from public.kpi_data_rh_access(p_session_hash) limit 1;
  if v_user is null then
    raise exception 'Droit Data RH requis.' using errcode='42501';
  end if;

  if p_source_key not in ('billed_time','finance','workload') then
    raise exception 'Type d''import invalide.';
  end if;
  if coalesce(btrim(p_filename),'')='' or p_file_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Métadonnées fichier invalides.';
  end if;
  if p_byte_size<=0 or p_byte_size>26214400 or p_total_rows<=0 or p_total_rows>500000 then
    raise exception 'Taille ou nombre de lignes invalide.';
  end if;

  select id,filename,total_rows,min_date,max_date
    into v_existing
    from public.kpi_ops_import_batches
   where source_key=p_source_key
     and file_sha256=p_file_sha256
     and status='imported'
   order by completed_at desc nulls last
   limit 1;

  if found then
    return jsonb_build_object(
      'duplicate',true,
      'batchId',v_existing.id,
      'filename',v_existing.filename,
      'rows',v_existing.total_rows,
      'dateRange',jsonb_build_object('min',v_existing.min_date,'max',v_existing.max_date)
    );
  end if;

  select id,filename,total_rows,min_date,max_date,received_rows,committed_rows
    into v_processing
    from public.kpi_ops_import_batches
   where source_key=p_source_key
     and file_sha256=p_file_sha256
     and status='processing'
   order by created_at desc
   limit 1;

  if found then
    return jsonb_build_object(
      'ready',true,
      'resume',true,
      'batchId',v_processing.id,
      'filename',v_processing.filename,
      'rows',v_processing.total_rows,
      'receivedRows',v_processing.received_rows,
      'committedRows',v_processing.committed_rows,
      'dateRange',jsonb_build_object('min',v_processing.min_date,'max',v_processing.max_date)
    );
  end if;

  insert into public.kpi_ops_import_batches(
    source_key,filename,file_sha256,byte_size,min_date,max_date,total_rows,
    headers,created_by,metadata
  ) values(
    p_source_key,p_filename,p_file_sha256,p_byte_size,p_min_date,p_max_date,
    p_total_rows,coalesce(p_headers,'[]'::jsonb),v_user.display_name,
    jsonb_build_object('delivery_channel','browser_chunked_v2','cleanup_done',false)
  ) returning id into v_id;

  return jsonb_build_object(
    'ready',true,
    'resume',false,
    'batchId',v_id,
    'receivedRows',0,
    'committedRows',0
  );
end
$function$;

-- Keep the proven import implementation intact, but place a stable bounded RPC
-- in front of it. This also protects older deployed clients that still request
-- 3000/5000-row commit steps.
alter function public.kpi_ops_batch_commit_step_admin(text,uuid,integer)
  rename to kpi_ops_batch_commit_step_admin_impl_v2;

create function public.kpi_ops_batch_commit_step_admin(
  p_session_hash text,
  p_batch_id uuid,
  p_limit integer default 1000
)
returns jsonb
language sql
security definer
set search_path to 'public', 'extensions'
set statement_timeout to '60s'
set lock_timeout to '8s'
as $function$
  select public.kpi_ops_batch_commit_step_admin_impl_v2(
    p_session_hash,
    p_batch_id,
    greatest(250, least(coalesce(p_limit,1000),1000))
  );
$function$;

revoke all on function public.kpi_ops_batch_commit_step_admin_impl_v2(text,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.kpi_ops_batch_commit_step_admin_impl_v2(text,uuid,integer)
  to service_role;
grant execute on function public.kpi_ops_batch_commit_step_admin(text,uuid,integer)
  to anon, authenticated, service_role;
