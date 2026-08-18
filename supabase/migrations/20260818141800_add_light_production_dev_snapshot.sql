create or replace function public.kpi_production_dev_snapshot_light(p_token_hash text, p_vehicle text default null)
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
  v_rows jsonb := '[]'::jsonb;
  v_detail jsonb := null;
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
    return jsonb_build_object('connected',false,'vehicles','[]'::jsonb,'detail',null,'fifo','[]'::jsonb,'excludedBcaVom',0);
  end if;

  select b.id into v_location_batch
  from public.kpi_import_batches b
  where b.original_filename in ('EtatduParc-Nuit.csv','Etat-du-parc.csv')
    and b.metadata->>'vehicle_state_status'='ready'
  order by b.imported_at desc limit 1;

  select max(v.source_modified_at), count(*) filter(where coalesce(v.metadata->>'type','') ~* '(BCA|VOM)')
    into v_source,v_excluded
  from public.kpi_ftp_vehicle_state v
  where v.import_batch_id=v_batch;

  if v_location_batch is not null then
    select max(v.source_modified_at) into v_location_source
    from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_location_batch;
  end if;

  with live as (
    select v.*,
      case
        when nullif(trim(coalesce(v.vin,'')),'') is not null then 'VIN:'||upper(trim(v.vin))
        when nullif(trim(coalesce(v.registration,'')),'') is not null then 'REG:'||upper(trim(v.registration))
        else 'OR:'||trim(coalesce(v.work_order,''))
      end as vehicle_key
    from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch
      and coalesce(v.metadata->>'type','') !~* '(BCA|VOM)'
  ), loc as (
    select distinct on (vehicle_key)
      vehicle_key,
      nullif(trim(v.metadata->>'position'),'') as location,
      v.source_modified_at as location_source_modified_at,
      nullif(trim(v.metadata->>'site'),'') as site,
      nullif(trim(v.metadata->>'manufacturer'),'') as manufacturer,
      nullif(trim(v.metadata->>'folder_number'),'') as folder_number
    from (
      select v.*,
        case
          when nullif(trim(coalesce(v.vin,'')),'') is not null then 'VIN:'||upper(trim(v.vin))
          when nullif(trim(coalesce(v.registration,'')),'') is not null then 'REG:'||upper(trim(v.registration))
          else 'OR:'||trim(coalesce(v.work_order,''))
        end as vehicle_key
      from public.kpi_ftp_vehicle_state v
      where v.import_batch_id=v_location_batch
        and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null
    ) v
    order by vehicle_key, v.source_modified_at desc nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'snapshot_at',v.snapshot_at,'source_modified_at',v.source_modified_at,'registration',v.registration,'work_order',v.work_order,
      'client',v.client,'vin',v.vin,'model',v.model,'mileage',v.mileage,'status',v.status,'status_at',v.status_at,
      'status_age_days',v.status_age_days,'factory_age_days',v.factory_age_days,'alert',v.alert,'urgency',v.urgency,
      'mechanics',v.mechanics,'bodywork',v.bodywork,'technical_control',v.technical_control,'dsp',v.dsp,'wheels',v.wheels,
      'part_available',v.part_available,'part_ordered_days',v.part_ordered_days,'location',l.location,
      'location_source_modified_at',l.location_source_modified_at,'site',coalesce(nullif(trim(v.metadata->>'site'),''),l.site),
      'manufacturer',coalesce(nullif(trim(v.metadata->>'manufacturer'),''),l.manufacturer),
      'folder_number',coalesce(nullif(trim(v.metadata->>'folder_number'),''),l.folder_number),
      'metadata',jsonb_build_object('type',coalesce(v.metadata->>'type',''))
    ) order by coalesce(v.factory_age_days,0) desc,coalesce(v.status_age_days,0) desc),'[]'::jsonb)
    into v_rows
  from live v left join loc l on l.vehicle_key=v.vehicle_key;

  if nullif(trim(coalesce(p_vehicle,'')),'') is not null then
    with selected as (
      select v.* from public.kpi_ftp_vehicle_state v
      where v.import_batch_id=v_batch
        and coalesce(v.metadata->>'type','') !~* '(BCA|VOM)'
        and (coalesce(v.vin,'')=p_vehicle or upper(coalesce(v.registration,''))=upper(p_vehicle) or coalesce(v.work_order,'')=p_vehicle)
      order by coalesce(v.factory_age_days,0) desc limit 1
    ), selected_loc as (
      select nullif(trim(l.metadata->>'position'),'') as location,l.source_modified_at
      from public.kpi_ftp_vehicle_state l, selected s
      where l.import_batch_id=v_location_batch
        and nullif(trim(coalesce(l.metadata->>'position','')),'') is not null
        and ((s.vin is not null and l.vin=s.vin)
          or (s.registration is not null and upper(coalesce(l.registration,''))=upper(s.registration))
          or (s.work_order is not null and l.work_order=s.work_order))
      order by case when s.vin is not null and l.vin=s.vin then 0 when s.registration is not null and upper(coalesce(l.registration,''))=upper(s.registration) then 1 else 2 end,
               l.source_modified_at desc nulls last limit 1
    )
    select jsonb_build_object(
      'vehicle',jsonb_build_object(
        'snapshot_at',s.snapshot_at,'source_modified_at',s.source_modified_at,'registration',s.registration,'work_order',s.work_order,
        'client',s.client,'vin',s.vin,'model',s.model,'mileage',s.mileage,'status',s.status,'status_at',s.status_at,
        'status_age_days',s.status_age_days,'factory_age_days',s.factory_age_days,'alert',s.alert,'urgency',s.urgency,
        'mechanics',s.mechanics,'bodywork',s.bodywork,'technical_control',s.technical_control,'dsp',s.dsp,'wheels',s.wheels,
        'part_available',s.part_available,'part_ordered_days',s.part_ordered_days,'location',sl.location,
        'location_source_modified_at',sl.source_modified_at,'site',nullif(trim(s.metadata->>'site'),''),
        'manufacturer',nullif(trim(s.metadata->>'manufacturer'),''),'folder_number',nullif(trim(s.metadata->>'folder_number'),''),
        'metadata',jsonb_build_object('type',coalesce(s.metadata->>'type',''))
      ),
      'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.event_date desc,e.event_time desc)
        from (select se.source_modified_at,se.status,se.event_date,se.event_time
              from public.kpi_ftp_status_events se
              where (s.vin is not null and se.vin=s.vin)
                 or (s.registration is not null and upper(coalesce(se.registration,''))=upper(s.registration))
                 or (s.work_order is not null and se.work_order=s.work_order)
              order by se.event_date desc,se.event_time desc limit 80) e),'[]'::jsonb)
    ) into v_detail
    from selected s left join selected_loc sl on true;
  end if;

  return jsonb_build_object('connected',true,'snapshotAt',v_snapshot,'sourceModifiedAt',v_source,
    'locationSourceModifiedAt',v_location_source,'excludedBcaVom',coalesce(v_excluded,0),'vehicles',v_rows,'fifo','[]'::jsonb,'detail',v_detail);
end;
$$;

grant execute on function public.kpi_production_dev_snapshot_light(text,text) to anon, authenticated, service_role;
