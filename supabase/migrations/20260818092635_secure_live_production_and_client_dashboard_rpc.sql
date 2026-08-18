create or replace function public.kpi_production_dev_snapshot(
  p_token_hash text,
  p_vehicle text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth record;
  v_batch uuid;
  v_snapshot date;
  v_source timestamptz;
  v_rows jsonb := '[]'::jsonb;
  v_detail jsonb := null;
  v_selected public.kpi_ftp_vehicle_state%rowtype;
  v_events jsonb := '[]'::jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then
    raise exception 'development sandbox forbidden' using errcode='42501';
  end if;

  select b.id,b.snapshot_at into v_batch,v_snapshot
  from public.kpi_import_batches b
  where b.original_filename='EtatduParc.csv'
    and b.metadata->>'vehicle_state_status'='ready'
  order by b.imported_at desc
  limit 1;

  if v_batch is null then
    return jsonb_build_object('connected',false,'vehicles','[]'::jsonb,'detail',null);
  end if;

  select max(v.source_modified_at) into v_source
  from public.kpi_ftp_vehicle_state v
  where v.import_batch_id=v_batch;

  select coalesce(jsonb_agg(jsonb_build_object(
      'snapshot_at',v.snapshot_at,'source_modified_at',v.source_modified_at,'registration',v.registration,
      'work_order',v.work_order,'client',v.client,'vin',v.vin,'model',v.model,'mileage',v.mileage,
      'status',v.status,'status_at',v.status_at,'status_age_days',v.status_age_days,'factory_age_days',v.factory_age_days,
      'alert',v.alert,'urgency',v.urgency,'mechanics',v.mechanics,'bodywork',v.bodywork,
      'technical_control',v.technical_control,'dsp',v.dsp,'wheels',v.wheels,'part_available',v.part_available,
      'part_ordered_days',v.part_ordered_days,'metadata',v.metadata
    ) order by coalesce(v.factory_age_days,0) desc,coalesce(v.status_age_days,0) desc),'[]'::jsonb)
  into v_rows
  from public.kpi_ftp_vehicle_state v
  where v.import_batch_id=v_batch
    and coalesce(v.metadata->>'type','') !~* '(BCA|VOM)';

  if nullif(trim(coalesce(p_vehicle,'')),'') is not null then
    select v.* into v_selected
    from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch
      and coalesce(v.metadata->>'type','') !~* '(BCA|VOM)'
      and (coalesce(v.vin,'')=p_vehicle or upper(coalesce(v.registration,''))=upper(p_vehicle) or coalesce(v.work_order,'')=p_vehicle)
    order by coalesce(v.factory_age_days,0) desc
    limit 1;

    if found then
      select coalesce(jsonb_agg(to_jsonb(e) order by e.event_date desc,e.event_time desc),'[]'::jsonb)
      into v_events
      from (
        select se.source_modified_at,se.status,se.event_date,se.event_time
        from public.kpi_ftp_status_events se
        where (v_selected.vin is not null and se.vin=v_selected.vin)
           or (v_selected.registration is not null and upper(coalesce(se.registration,''))=upper(v_selected.registration))
           or (v_selected.work_order is not null and se.work_order=v_selected.work_order)
        order by se.event_date desc,se.event_time desc
        limit 80
      ) e;

      v_detail:=jsonb_build_object('vehicle',jsonb_build_object(
        'snapshot_at',v_selected.snapshot_at,'source_modified_at',v_selected.source_modified_at,'registration',v_selected.registration,
        'work_order',v_selected.work_order,'client',v_selected.client,'vin',v_selected.vin,'model',v_selected.model,
        'mileage',v_selected.mileage,'status',v_selected.status,'status_at',v_selected.status_at,
        'status_age_days',v_selected.status_age_days,'factory_age_days',v_selected.factory_age_days,'alert',v_selected.alert,
        'urgency',v_selected.urgency,'mechanics',v_selected.mechanics,'bodywork',v_selected.bodywork,
        'technical_control',v_selected.technical_control,'dsp',v_selected.dsp,'wheels',v_selected.wheels,
        'part_available',v_selected.part_available,'part_ordered_days',v_selected.part_ordered_days,'metadata',v_selected.metadata
      ),'events',v_events);
    end if;
  end if;

  return jsonb_build_object('connected',true,'snapshotAt',v_snapshot,'sourceModifiedAt',v_source,'vehicles',v_rows,'detail',v_detail);
end;
$$;

revoke all on function public.kpi_production_dev_snapshot(text,text) from public;
grant execute on function public.kpi_production_dev_snapshot(text,text) to anon,authenticated;

create or replace function public.kpi_client_dashboard_private(
  p_token_hash text,
  p_client text default null,
  p_bmw boolean default false,
  p_registration text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth record;
  v_client text;
  v_summaries jsonb := '[]'::jsonb;
  v_summary jsonb := null;
  v_vehicles jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_vehicle jsonb := null;
  v_reg text;
  v_or text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) then raise exception 'session required' using errcode='42501'; end if;
  if coalesce(v_auth.role,'') <> 'admin'
     and not ('*'=any(coalesce(v_auth.page_permissions,array[]::text[])) or 'client_dashboard'=any(coalesce(v_auth.page_permissions,array[]::text[]))) then
    raise exception 'client dashboard forbidden' using errcode='42501';
  end if;

  if nullif(trim(coalesce(p_registration,'')),'') is not null then
    select to_jsonb(v),v.registration,v.work_order into v_vehicle,v_reg,v_or
    from public.kpi_client_vehicle_public v
    where upper(coalesce(v.registration,''))=upper(trim(p_registration))
    order by coalesce(v.factory_age_days,v.status_age_days,0) desc limit 1;
    if v_vehicle is null then return jsonb_build_object('found',false); end if;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_date desc,e.event_time desc),'[]'::jsonb) into v_history
    from (select se.event_date,se.event_time,se.status,se.client,se.work_order,se.registration,se.flow
          from public.kpi_ftp_status_events se
          where upper(coalesce(se.registration,''))=upper(coalesce(v_reg,'')) or (v_or is not null and se.work_order=v_or)
          order by se.event_date desc,se.event_time desc limit 250) e;
    return jsonb_build_object('found',true,'vehicle',v_vehicle,'history',v_history);
  end if;

  v_client:=case when p_bmw then 'BMW FRANCE Prestations' else nullif(trim(coalesce(p_client,'')),'') end;
  if v_client is null then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.client),'[]'::jsonb) into v_summaries from public.kpi_client_summary_public s;
    return jsonb_build_object('clients',v_summaries);
  end if;

  select to_jsonb(s) into v_summary from public.kpi_client_summary_public s where s.client=v_client limit 1;
  if v_summary is null then return jsonb_build_object('found',false,'client',v_client); end if;
  select coalesce(jsonb_agg(to_jsonb(v) order by coalesce(v.factory_age_days,v.status_age_days,0) desc),'[]'::jsonb)
  into v_vehicles from public.kpi_client_vehicle_public v where v.client=v_client;

  if p_bmw then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_date desc,e.event_time desc),'[]'::jsonb) into v_history
    from (select se.event_date,se.event_time,se.status,se.client,se.work_order,se.registration,se.flow
          from public.kpi_ftp_status_events se where se.client=v_client
          order by se.event_date desc,se.event_time desc limit 5000) e;
  end if;

  return jsonb_build_object('found',true,'client',v_client,'summary',v_summary,'vehicles',v_vehicles,'history',v_history);
end;
$$;

revoke all on function public.kpi_client_dashboard_private(text,text,boolean,text) from public;
grant execute on function public.kpi_client_dashboard_private(text,text,boolean,text) to anon,authenticated;
