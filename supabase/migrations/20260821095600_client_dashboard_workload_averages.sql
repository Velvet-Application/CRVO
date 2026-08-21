create or replace function public.kpi_client_dashboard_private(
  p_token_hash text,
  p_client text default null::text,
  p_bmw boolean default false,
  p_registration text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_auth record;
  v_client text;
  v_summaries jsonb := '[]'::jsonb;
  v_summary jsonb := null;
  v_vehicles jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_vehicle jsonb := null;
  v_workload_metrics jsonb := jsonb_build_object(
    'fre_average', null,
    'time_average_hours', null,
    'matched_vehicle_count', 0,
    'total_vehicle_count', 0,
    'snapshot_at', null
  );
  v_reg text;
  v_or text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) then
    raise exception 'session required' using errcode='42501';
  end if;
  if coalesce(v_auth.role,'') <> 'admin'
     and not ('*'=any(coalesce(v_auth.page_permissions,array[]::text[]))
              or 'client_dashboard'=any(coalesce(v_auth.page_permissions,array[]::text[]))) then
    raise exception 'client dashboard forbidden' using errcode='42501';
  end if;

  if nullif(trim(coalesce(p_registration,'')),'') is not null then
    select to_jsonb(v),v.registration,v.work_order
      into v_vehicle,v_reg,v_or
    from public.kpi_client_vehicle_public v
    where upper(coalesce(v.registration,''))=upper(trim(p_registration))
    order by coalesce(v.factory_age_days,v.status_age_days,0) desc
    limit 1;

    if v_vehicle is null then
      return jsonb_build_object('found',false);
    end if;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_date desc,e.event_time desc),'[]'::jsonb)
      into v_history
    from (
      select se.event_date,se.event_time,se.status,se.client,se.work_order,se.registration,se.flow
      from public.kpi_ftp_status_events se
      where upper(coalesce(se.registration,''))=upper(coalesce(v_reg,''))
         or (v_or is not null and se.work_order=v_or)
      order by se.event_date desc,se.event_time desc
      limit 250
    ) e;

    return jsonb_build_object('found',true,'vehicle',v_vehicle,'history',v_history);
  end if;

  v_client:=case when p_bmw then 'BMW FRANCE Prestations' else nullif(trim(coalesce(p_client,'')),'') end;

  if v_client is null then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.client),'[]'::jsonb)
      into v_summaries
    from public.kpi_client_summary_public s;
    return jsonb_build_object('clients',v_summaries);
  end if;

  select to_jsonb(s) into v_summary
  from public.kpi_client_summary_public s
  where s.client=v_client
  limit 1;

  if v_summary is null then
    return jsonb_build_object('found',false,'client',v_client);
  end if;

  select coalesce(jsonb_agg(to_jsonb(v) order by coalesce(v.factory_age_days,v.status_age_days,0) desc),'[]'::jsonb)
    into v_vehicles
  from public.kpi_client_vehicle_public v
  where v.client=v_client;

  with latest_workload as (
    select w.*
    from public.kpi_vehicle_workload w
    where w.source_name='SQL OR encours CRVO'
      and w.snapshot_at=(
        select max(x.snapshot_at)
        from public.kpi_vehicle_workload x
        where x.source_name='SQL OR encours CRVO'
      )
  ),
  per_vehicle_workload as (
    select
      v.registration,
      v.work_order,
      sum(coalesce(w.potential_revenue_total,0))::numeric as fre_total,
      sum(coalesce(w.remaining_minutes,w.estimated_total_minutes,0))::numeric as minutes_total
    from public.kpi_client_vehicle_public v
    join latest_workload w
      on (
        nullif(trim(coalesce(v.work_order,'')),'') is not null
        and nullif(trim(coalesce(w.work_order,'')),'') is not null
        and trim(v.work_order)=trim(w.work_order)
      )
      or (
        nullif(trim(coalesce(v.registration,'')),'') is not null
        and nullif(trim(coalesce(w.registration,'')),'') is not null
        and upper(trim(v.registration))=upper(trim(w.registration))
      )
    where v.client=v_client
    group by v.registration,v.work_order
  )
  select jsonb_build_object(
    'fre_average', round(avg(fre_total),2),
    'time_average_hours', round(avg(minutes_total)/60.0,2),
    'matched_vehicle_count', count(*),
    'total_vehicle_count', (select count(*) from public.kpi_client_vehicle_public v where v.client=v_client),
    'snapshot_at', (
      select max(x.snapshot_at)
      from public.kpi_vehicle_workload x
      where x.source_name='SQL OR encours CRVO'
    )
  )
  into v_workload_metrics
  from per_vehicle_workload;

  if p_bmw then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.event_date desc,e.event_time desc),'[]'::jsonb)
      into v_history
    from (
      select se.event_date,se.event_time,se.status,se.client,se.work_order,se.registration,se.flow
      from public.kpi_ftp_status_events se
      where se.client=v_client
      order by se.event_date desc,se.event_time desc
      limit 5000
    ) e;
  end if;

  return jsonb_build_object(
    'found',true,
    'client',v_client,
    'summary',v_summary,
    'vehicles',v_vehicles,
    'history',v_history,
    'workload_metrics',v_workload_metrics
  );
end;
$function$;
