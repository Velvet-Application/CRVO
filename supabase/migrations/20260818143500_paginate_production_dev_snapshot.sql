-- Keep the development production mirror responsive under the PostgREST statement timeout.
-- Vehicle and location data are exposed in small authenticated pages; FIFO remains independent.

create or replace function public.kpi_production_dev_meta(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth record;
  v_batch uuid;
  v_snapshot date;
  v_source timestamptz;
  v_location_batch uuid;
  v_location_source timestamptz;
  v_total int := 0;
  v_location_total int := 0;
  v_excluded int := 0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then
    raise exception 'development sandbox forbidden' using errcode='42501';
  end if;

  select b.id,b.snapshot_at into v_batch,v_snapshot
  from public.kpi_import_batches b
  where b.original_filename='EtatduParc.csv'
    and b.metadata->>'vehicle_state_status'='ready'
  order by b.imported_at desc limit 1;

  if v_batch is null then
    return jsonb_build_object('connected',false,'totalRows',0,'locationRows',0,'excludedBcaVom',0);
  end if;

  select max(v.source_modified_at),
         count(*) filter(where coalesce(v.metadata->>'type','') !~* '(BCA|VOM)'),
         count(*) filter(where coalesce(v.metadata->>'type','') ~* '(BCA|VOM)')
    into v_source,v_total,v_excluded
  from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_batch;

  select b.id into v_location_batch
  from public.kpi_import_batches b
  where b.original_filename in ('EtatduParc-Nuit.csv','Etat-du-parc.csv')
    and b.metadata->>'vehicle_state_status'='ready'
  order by b.imported_at desc limit 1;

  if v_location_batch is not null then
    select max(v.source_modified_at),
           count(*) filter(where nullif(trim(coalesce(v.metadata->>'position','')),'') is not null)
      into v_location_source,v_location_total
    from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_location_batch;
  end if;

  return jsonb_build_object(
    'connected',true,'snapshotAt',v_snapshot,'sourceModifiedAt',v_source,
    'locationSourceModifiedAt',v_location_source,'totalRows',coalesce(v_total,0),
    'locationRows',coalesce(v_location_total,0),'excludedBcaVom',coalesce(v_excluded,0)
  );
end;
$$;
grant execute on function public.kpi_production_dev_meta(text) to anon, authenticated, service_role;

create or replace function public.kpi_production_dev_vehicle_page(p_token_hash text,p_offset integer default 0,p_limit integer default 400)
returns setof public.kpi_ftp_vehicle_state
language plpgsql security definer set search_path = public
as $$
declare v_auth record; v_batch uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then raise exception 'development sandbox forbidden' using errcode='42501'; end if;
  select b.id into v_batch from public.kpi_import_batches b
    where b.original_filename='EtatduParc.csv' and b.metadata->>'vehicle_state_status'='ready'
    order by b.imported_at desc limit 1;
  if v_batch is null then return; end if;
  return query select v.* from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch and coalesce(v.metadata->>'type','') !~* '(BCA|VOM)'
    order by v.id offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,400),1),500);
end;
$$;
grant execute on function public.kpi_production_dev_vehicle_page(text,integer,integer) to anon, authenticated, service_role;

create or replace function public.kpi_production_dev_location_page(p_token_hash text,p_offset integer default 0,p_limit integer default 500)
returns setof public.kpi_ftp_vehicle_state
language plpgsql security definer set search_path = public
as $$
declare v_auth record; v_batch uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then raise exception 'development sandbox forbidden' using errcode='42501'; end if;
  select b.id into v_batch from public.kpi_import_batches b
    where b.original_filename in ('EtatduParc-Nuit.csv','Etat-du-parc.csv') and b.metadata->>'vehicle_state_status'='ready'
    order by b.imported_at desc limit 1;
  if v_batch is null then return; end if;
  return query select v.* from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null
    order by v.source_modified_at desc nulls last,v.id
    offset greatest(coalesce(p_offset,0),0) limit least(greatest(coalesce(p_limit,500),1),500);
end;
$$;
grant execute on function public.kpi_production_dev_location_page(text,integer,integer) to anon, authenticated, service_role;

create or replace function public.kpi_production_dev_vehicle_find(p_token_hash text,p_vehicle text)
returns setof public.kpi_ftp_vehicle_state
language plpgsql security definer set search_path = public
as $$
declare v_auth record; v_batch uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then raise exception 'development sandbox forbidden' using errcode='42501'; end if;
  select b.id into v_batch from public.kpi_import_batches b
    where b.original_filename='EtatduParc.csv' and b.metadata->>'vehicle_state_status'='ready'
    order by b.imported_at desc limit 1;
  if v_batch is null or nullif(trim(coalesce(p_vehicle,'')),'') is null then return; end if;
  return query select v.* from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch and coalesce(v.metadata->>'type','') !~* '(BCA|VOM)'
      and (coalesce(v.vin,'')=p_vehicle or upper(coalesce(v.registration,''))=upper(p_vehicle) or coalesce(v.work_order,'')=p_vehicle)
    order by coalesce(v.factory_age_days,0) desc,v.id limit 1;
end;
$$;
grant execute on function public.kpi_production_dev_vehicle_find(text,text) to anon, authenticated, service_role;

create or replace function public.kpi_production_dev_location_find(p_token_hash text,p_vin text default null,p_registration text default null,p_work_order text default null)
returns setof public.kpi_ftp_vehicle_state
language plpgsql security definer set search_path = public
as $$
declare v_auth record; v_batch uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then raise exception 'development sandbox forbidden' using errcode='42501'; end if;
  select b.id into v_batch from public.kpi_import_batches b
    where b.original_filename in ('EtatduParc-Nuit.csv','Etat-du-parc.csv') and b.metadata->>'vehicle_state_status'='ready'
    order by b.imported_at desc limit 1;
  if v_batch is null then return; end if;
  if nullif(trim(coalesce(p_vin,'')),'') is not null then
    return query select v.* from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_batch and v.vin=p_vin and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null order by v.source_modified_at desc nulls last limit 1;
    if found then return; end if;
  end if;
  if nullif(trim(coalesce(p_registration,'')),'') is not null then
    return query select v.* from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_batch and upper(coalesce(v.registration,''))=upper(p_registration) and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null order by v.source_modified_at desc nulls last limit 1;
    if found then return; end if;
  end if;
  if nullif(trim(coalesce(p_work_order,'')),'') is not null then
    return query select v.* from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_batch and v.work_order=p_work_order and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null order by v.source_modified_at desc nulls last limit 1;
  end if;
end;
$$;
grant execute on function public.kpi_production_dev_location_find(text,text,text,text) to anon, authenticated, service_role;

create or replace function public.kpi_production_dev_events(p_token_hash text,p_vin text default null,p_registration text default null,p_work_order text default null)
returns table(source_modified_at timestamptz,status text,event_date date,event_time time)
language plpgsql security definer set search_path = public
as $$
declare v_auth record;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then raise exception 'development sandbox forbidden' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_work_order,'')),'') is not null then
    return query select e.source_modified_at,e.status,e.event_date,e.event_time from public.kpi_ftp_status_events e where e.work_order=p_work_order order by e.event_date desc,e.event_time desc limit 80; return;
  end if;
  if nullif(trim(coalesce(p_registration,'')),'') is not null then
    return query select e.source_modified_at,e.status,e.event_date,e.event_time from public.kpi_ftp_status_events e where upper(coalesce(e.registration,''))=upper(p_registration) order by e.event_date desc,e.event_time desc limit 80; return;
  end if;
  if nullif(trim(coalesce(p_vin,'')),'') is not null then
    return query select e.source_modified_at,e.status,e.event_date,e.event_time from public.kpi_ftp_status_events e where e.vin=p_vin order by e.event_date desc,e.event_time desc limit 80;
  end if;
end;
$$;
grant execute on function public.kpi_production_dev_events(text,text,text,text) to anon, authenticated, service_role;
