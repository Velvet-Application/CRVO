do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.kpi_site_presence_capacity_v5(text,date)'::regprocedure);
  v_def := replace(v_def,'kpi_site_presence_capacity_v5','kpi_site_presence_capacity_v6');
  v_def := replace(
    v_def,
    'when e.primary_population=''productif'' then case',
    E'when e.primary_population=''fixline'' then ''carrosserie''\n        when e.primary_population=''productif'' then case'
  );
  v_def := replace(
    v_def,
    'kpi_staff_effective · population productif autoritaire',
    'kpi_staff_effective · productifs directs + Fixline'
  );
  execute v_def;
end
$$;

revoke all on function public.kpi_site_presence_capacity_v6(text,date) from public;
grant execute on function public.kpi_site_presence_capacity_v6(text,date) to anon,authenticated,service_role;

create or replace function public.kpi_site_presence_capacity_v7(p_session_hash text,p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_payload jsonb;
  v_target date;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_ref_end date;
  v_ref_start date;
  v_business_days numeric := 0;
  v_presence_hours numeric := 0;
  v_reference_etp numeric;
  v_reference_exits numeric;
  v_present numeric := 0;
  v_pending numeric := 0;
  v_capacity numeric;
  v_capacity_pending numeric;
  v_actual numeric;
begin
  v_payload := public.kpi_site_presence_capacity_v6(p_session_hash,p_date);
  v_target := coalesce((v_payload->>'date')::date,p_date,v_today);
  v_ref_end := least(v_target-1,v_today-1);
  v_ref_start := v_ref_end-9;

  select count(*)::numeric
  into v_business_days
  from generate_series(v_ref_start,v_ref_end,interval '1 day') g(day)
  where extract(isodow from g.day) between 1 and 5;

  select coalesce(sum(f.time_value),0)::numeric
  into v_presence_hours
  from public.kpi_sql_presence_facts f
  join public.kpi_rh_presence_code_map m
    on m.time_code=f.time_code
   and m.counts_as_presence
   and not m.excluded
  where f.work_date between v_ref_start and v_ref_end
    and extract(isodow from f.work_date) between 1 and 5
    and m.sector_key in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo');

  if coalesce(v_business_days,0)>0 and coalesce(v_presence_hours,0)>0 then
    v_reference_etp := v_presence_hours/(v_business_days*7.5);
  end if;

  with daily as (
    select s.snapshot_at,
      max(nullif(s.metrics->>'exits_vop','')::numeric) exits
    from public.kpi_public_dashboard_snapshots s
    where s.snapshot_at between v_ref_start and v_ref_end
      and extract(isodow from s.snapshot_at) between 1 and 5
      and s.source_name like 'FTP CRVO%'
    group by s.snapshot_at
  )
  select avg(exits)::numeric into v_reference_exits
  from daily
  where exits is not null;

  v_present := coalesce((v_payload->'summary'->>'present')::numeric,0);
  v_pending := coalesce((v_payload->'summary'->>'pendingLeave')::numeric,0);

  if coalesce(v_reference_etp,0)>0 and coalesce(v_reference_exits,0)>0 then
    v_capacity := round(v_reference_exits*v_present/v_reference_etp);
    v_capacity_pending := round(v_reference_exits*greatest(v_present-v_pending,0)/v_reference_etp);

    v_payload := jsonb_set(v_payload,'{summary,siteTheoreticalVehicles}',to_jsonb(v_capacity),true);
    v_payload := jsonb_set(v_payload,'{summary,siteTheoreticalVehiclesIfPendingApproved}',to_jsonb(v_capacity_pending),true);

    v_actual := nullif(v_payload->'summary'->>'actualFactoryExits','')::numeric;
    v_payload := jsonb_set(
      v_payload,
      '{summary,capacityVsActualPct}',
      case when v_payload->>'mode'='past' and coalesce(v_capacity,0)>0 and v_actual is not null
        then to_jsonb(round(100*v_actual/v_capacity,1))
        else 'null'::jsonb end,
      true
    );
  end if;

  v_payload := jsonb_set(v_payload,'{reference,siteCapacityWindowStart}',to_jsonb(v_ref_start),true);
  v_payload := jsonb_set(v_payload,'{reference,siteCapacityWindowEnd}',to_jsonb(v_ref_end),true);
  v_payload := jsonb_set(v_payload,'{reference,siteReferenceAvailableEtp}',case when v_reference_etp is null then 'null'::jsonb else to_jsonb(round(v_reference_etp,2)) end,true);
  v_payload := jsonb_set(v_payload,'{reference,siteReferenceExitsPerDay}',case when v_reference_exits is null then 'null'::jsonb else to_jsonb(round(v_reference_exits,2)) end,true);
  v_payload := jsonb_set(v_payload,'{reference,siteCapacityMethod}',to_jsonb('Projection site = moyenne Sorties Usine FTP des jours ouvrés de la fenêtre × productifs disponibles / ETP disponibles moyens de la même fenêtre. Les capacités activité restent calculées avec les temps facturés moyens par VO traité.'::text),true);
  v_payload := jsonb_set(v_payload,'{reference,rosterSource}',to_jsonb('kpi_staff_effective · productifs directs + Fixline'::text),true);
  return v_payload;
end
$$;

revoke all on function public.kpi_site_presence_capacity_v7(text,date) from public;
grant execute on function public.kpi_site_presence_capacity_v7(text,date) to anon,authenticated,service_role;
