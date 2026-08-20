create or replace function public.kpi_site_presence_capacity_v2(p_session_hash text,p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_payload jsonb;
  v_site_avg numeric;
  v_hours numeric;
  v_hours_pending numeric;
  v_capacity numeric;
  v_capacity_pending numeric;
  v_pressure text;
  v_pressure_pending text;
  v_actual numeric;
begin
  v_payload:=public.kpi_site_presence_capacity(p_session_hash,p_date);

  select sum((x->>'avgBilledHoursPerSiteVehicle10d')::numeric)
  into v_site_avg
  from jsonb_array_elements(coalesce(v_payload->'sectors','[]'::jsonb)) x
  where nullif(x->>'avgBilledHoursPerSiteVehicle10d','') is not null
    and (x->>'avgBilledHoursPerSiteVehicle10d')::numeric>0;

  v_hours:=coalesce((v_payload->'summary'->>'productiveHours')::numeric,0);
  v_hours_pending:=coalesce((v_payload->'summary'->>'productiveHoursIfPendingApproved')::numeric,v_hours);
  if coalesce(v_site_avg,0)>0 then
    v_capacity:=floor(v_hours/v_site_avg);
    v_capacity_pending:=floor(v_hours_pending/v_site_avg);
  end if;

  select x->>'sectorLabel' into v_pressure
  from jsonb_array_elements(coalesce(v_payload->'sectors','[]'::jsonb)) x
  where coalesce((x->>'nominal')::numeric,0)>0
  order by coalesce((x->>'present')::numeric,0)/nullif((x->>'nominal')::numeric,0) asc nulls last
  limit 1;

  select x->>'sectorLabel' into v_pressure_pending
  from jsonb_array_elements(coalesce(v_payload->'sectors','[]'::jsonb)) x
  where coalesce((x->>'nominal')::numeric,0)>0
  order by greatest(coalesce((x->>'present')::numeric,0)-coalesce((x->>'pendingLeave')::numeric,0),0)/nullif((x->>'nominal')::numeric,0) asc nulls last
  limit 1;

  v_actual:=nullif(v_payload->'summary'->>'actualFactoryExits','')::numeric;

  v_payload:=jsonb_set(v_payload,'{reference,siteAvgBilledHoursPerVehicle10d}',to_jsonb(case when v_site_avg is null then null else round(v_site_avg,3) end),true);
  v_payload:=jsonb_set(v_payload,'{summary,siteTheoreticalVehicles}',to_jsonb(v_capacity),true);
  v_payload:=jsonb_set(v_payload,'{summary,siteTheoreticalVehiclesIfPendingApproved}',to_jsonb(v_capacity_pending),true);
  v_payload:=jsonb_set(v_payload,'{summary,bottleneckSector}',to_jsonb(v_pressure),true);
  v_payload:=jsonb_set(v_payload,'{summary,bottleneckSectorIfPendingApproved}',to_jsonb(v_pressure_pending),true);
  v_payload:=jsonb_set(v_payload,'{summary,capacityVsActualPct}',
    case when v_payload->>'mode'='past' and coalesce(v_capacity,0)>0 and v_actual is not null then to_jsonb(round(100*v_actual/v_capacity,1)) else 'null'::jsonb end,true);
  return v_payload;
end
$$;

revoke all on function public.kpi_site_presence_capacity_v2(text,date) from public;
grant execute on function public.kpi_site_presence_capacity_v2(text,date) to anon,authenticated,service_role;
