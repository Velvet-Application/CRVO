create or replace function public.kpi_site_presence_capacity_v3(p_session_hash text,p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_payload jsonb;
  v_target date;
  v_today date:=(now() at time zone 'Europe/Paris')::date;
  v_cutover date;
  v_rows jsonb:='[]'::jsonb;
  v_sectors jsonb:='[]'::jsonb;
  v_shifts jsonb:='[]'::jsonb;
  v_nominal int:=0; v_present int:=0; v_unavailable int:=0; v_pending int:=0;
  v_hours numeric:=0; v_hours_pending numeric:=0; v_site_avg numeric;
  v_capacity numeric; v_capacity_pending numeric; v_pressure text; v_pressure_pending text; v_actual numeric;
begin
  v_payload:=public.kpi_site_presence_capacity_v2(p_session_hash,p_date);
  v_target:=(v_payload->>'date')::date;
  select min((source_updated_at at time zone 'Europe/Paris')::date) into v_cutover from public.kpi_rh_staff_dimension where active and source_updated_at is not null;

  with
  sector_defs(sector_key,sector_label,sort_order) as (
    values ('expertise','Expertise',1),('mecanique','Mécanique',2),('dsp','DSP',3),('jantes','Jantes',4),('carrosserie','Carrosserie / Fixline',5),('preparation','Préparation',6),('qualite','Qualité',7),('photo','Photo',8)
  ), team_defs(team_code,sort_order) as (values('A'::text,1),('B',2),('C',3)),
  latest_by_name as (
    select distinct on(d.name_key) d.name_key,d.employee_key,d.full_name,d.team_code,d.service,d.active,d.entry_date,d.exit_date,d.source_updated_at,
      public.kpi_site_productive_sector_from_service(d.service) sector_key
    from public.kpi_rh_staff_dimension d where d.name_key is not null
    order by d.name_key,d.active desc,d.source_updated_at desc nulls last,d.entry_date desc nulls last
  ), population as (
    select s.employee_key,s.full_name,s.team_code,s.service,s.sector_key
    from latest_by_name s
    where s.team_code in ('A','B','C') and s.sector_key is not null
      and coalesce(s.entry_date,date '1900-01-01')<=v_target
      and (
        s.active
        or (not s.active and s.exit_date is not null and v_cutover is not null and s.exit_date>v_cutover and v_target<=s.exit_date)
      )
  ), absent_raw as (
    select r.employee_key,r.reason_code from public.kpi_worktime_rh_event_source r where r.entity='CRVO' and r.event_kind='absence' and v_target between r.start_date and r.end_date
    union all select e.employee_key,e.reason_code from public.kpi_worktime_events e where e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and v_target between e.start_date and e.end_date
    union all select l.employee_key,'paid_leave'::text from public.kpi_worktime_leave_requests l where l.entity='CRVO' and l.status='approved' and v_target between l.start_date and l.end_date
  ), absent_class as (
    select p.employee_key,case when bool_or(a.reason_code in ('paid_leave','rtt_recovery')) then 'leave' when bool_or(a.reason_code in ('sick_received','sick_pending','long_absence','work_accident','therapeutic_part_time')) then 'medical' else 'other' end reason_group
    from population p join absent_raw a on a.employee_key=p.employee_key group by p.employee_key
  ), pending_leave as (
    select distinct p.employee_key from population p join public.kpi_worktime_leave_requests l on l.employee_key=p.employee_key and l.entity='CRVO' and l.status='pending' and v_target between l.start_date and l.end_date
    where not exists(select 1 from absent_class a where a.employee_key=p.employee_key)
  ), refs as (
    select x->>'sectorKey' sector_key,x->>'sectorLabel' sector_label,
      nullif(x->>'avgBilledHoursPerSiteVehicle10d','')::numeric avg_site,
      nullif(x->>'avgBilledHoursPerTouchedVehicle10d','')::numeric avg_touched,
      coalesce(nullif(x->>'referenceTouchedVehicles','')::int,0) touched,
      nullif(x->>'actualVehicles','')::numeric actual
    from jsonb_array_elements(coalesce(v_payload->'sectors','[]'::jsonb)) x
  ), team_capacity as (
    select s.sector_key,s.sector_label,s.sort_order sector_order,t.team_code,t.sort_order team_order,
      count(distinct p.employee_key)::int nominal,count(distinct a.employee_key)::int unavailable,
      count(distinct p.employee_key) filter(where a.employee_key is null)::int present,
      count(distinct p.employee_key) filter(where a.reason_group='leave')::int leave_count,
      count(distinct p.employee_key) filter(where a.reason_group='medical')::int medical_count,
      count(distinct p.employee_key) filter(where a.reason_group='other')::int other_absence_count,
      count(distinct pl.employee_key)::int pending_leave,
      (count(distinct p.employee_key) filter(where a.employee_key is null)*7.5)::numeric hours,
      (greatest(count(distinct p.employee_key) filter(where a.employee_key is null)-count(distinct pl.employee_key),0)*7.5)::numeric hours_if_pending,
      r.avg_site,r.avg_touched,r.touched,r.actual
    from sector_defs s cross join team_defs t
    left join population p on p.sector_key=s.sector_key and p.team_code=t.team_code
    left join absent_class a on a.employee_key=p.employee_key
    left join pending_leave pl on pl.employee_key=p.employee_key
    left join refs r on r.sector_key=s.sector_key
    group by s.sector_key,s.sector_label,s.sort_order,t.team_code,t.sort_order,r.avg_site,r.avg_touched,r.touched,r.actual
  ), enriched as (
    select tc.*,
      case when avg_site>0 then hours/avg_site else null end theoretical,
      case when avg_site>0 then hours_if_pending/avg_site else null end theoretical_pending,
      case when nominal=0 then 'neutral' when 100.0*present/nominal<70 then 'critical' when 100.0*present/nominal<80 then 'warning' else 'ok' end status
    from team_capacity tc
  ), sector_agg as (
    select sector_key,max(sector_label) sector_label,min(sector_order) sector_order,sum(nominal)::int nominal,sum(unavailable)::int unavailable,sum(present)::int present,
      sum(leave_count)::int leave_count,sum(medical_count)::int medical_count,sum(other_absence_count)::int other_absence_count,sum(pending_leave)::int pending_leave,
      sum(hours)::numeric hours,sum(hours_if_pending)::numeric hours_if_pending,max(avg_site)::numeric avg_site,max(avg_touched)::numeric avg_touched,max(touched)::int touched,max(actual)::numeric actual,
      case when max(avg_site)>0 then sum(hours)/max(avg_site) else null end theoretical,case when max(avg_site)>0 then sum(hours_if_pending)/max(avg_site) else null end theoretical_pending
    from enriched group by sector_key
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('sectorKey',e.sector_key,'sectorLabel',e.sector_label,'team',e.team_code,'nominal',e.nominal,'present',e.present,'unavailable',e.unavailable,
      'approvedLeave',e.leave_count,'medicalAbsence',e.medical_count,'otherAbsence',e.other_absence_count,'pendingLeave',e.pending_leave,'hours',round(e.hours,1),'hoursIfPendingApproved',round(e.hours_if_pending,1),
      'availabilityPct',case when e.nominal>0 then round(100.0*e.present/e.nominal,1) else null end,'status',e.status,'avgBilledHoursPerSiteVehicle10d',case when e.avg_site is null then null else round(e.avg_site,3) end,
      'avgBilledHoursPerTouchedVehicle10d',case when e.avg_touched is null then null else round(e.avg_touched,3) end,'referenceTouchedVehicles',e.touched,
      'theoreticalVehicles',case when e.theoretical is null then null else round(e.theoretical,1) end,'theoreticalVehiclesIfPendingApproved',case when e.theoretical_pending is null then null else round(e.theoretical_pending,1) end)
      order by e.sector_order,e.team_order) from enriched e where e.nominal>0 or e.unavailable>0 or e.pending_leave>0),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('sectorKey',s.sector_key,'sectorLabel',s.sector_label,'nominal',s.nominal,'present',s.present,'unavailable',s.unavailable,
      'approvedLeave',s.leave_count,'medicalAbsence',s.medical_count,'otherAbsence',s.other_absence_count,'pendingLeave',s.pending_leave,'hours',round(s.hours,1),'hoursIfPendingApproved',round(s.hours_if_pending,1),
      'avgBilledHoursPerSiteVehicle10d',case when s.avg_site is null then null else round(s.avg_site,3) end,'avgBilledHoursPerTouchedVehicle10d',case when s.avg_touched is null then null else round(s.avg_touched,3) end,
      'referenceTouchedVehicles',s.touched,'theoreticalVehicles',case when s.theoretical is null then null else round(s.theoretical,1) end,
      'theoreticalVehiclesIfPendingApproved',case when s.theoretical_pending is null then null else round(s.theoretical_pending,1) end,'actualVehicles',s.actual,
      'utilizationPct',case when s.theoretical>0 and s.actual is not null then round(100*s.actual/s.theoretical,1) else null end) order by s.sector_order) from sector_agg s),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('team',q.team_code,'nominal',q.nominal,'present',q.present,'unavailable',q.unavailable,'pendingLeave',q.pending,'hours',round(q.hours,1)) order by q.team_code) from (
      select team_code,sum(nominal)::int nominal,sum(present)::int present,sum(unavailable)::int unavailable,sum(pending_leave)::int pending,sum(hours)::numeric hours from enriched group by team_code) q),'[]'::jsonb),
    coalesce((select sum(nominal)::int from sector_agg),0),coalesce((select sum(present)::int from sector_agg),0),coalesce((select sum(unavailable)::int from sector_agg),0),coalesce((select sum(pending_leave)::int from sector_agg),0),coalesce((select sum(hours) from sector_agg),0),coalesce((select sum(hours_if_pending) from sector_agg),0),
    (select sum(avg_site) from sector_agg where avg_site>0),
    (select sector_label from sector_agg where nominal>0 order by present::numeric/nullif(nominal,0) asc nulls last,sector_order limit 1),
    (select sector_label from sector_agg where nominal>0 order by greatest(present-pending_leave,0)::numeric/nullif(nominal,0) asc nulls last,sector_order limit 1)
  into v_rows,v_sectors,v_shifts,v_nominal,v_present,v_unavailable,v_pending,v_hours,v_hours_pending,v_site_avg,v_pressure,v_pressure_pending;

  if coalesce(v_site_avg,0)>0 then v_capacity:=floor(v_hours/v_site_avg);v_capacity_pending:=floor(v_hours_pending/v_site_avg); end if;
  v_actual:=nullif(v_payload->'summary'->>'actualFactoryExits','')::numeric;

  v_payload:=jsonb_set(v_payload,'{teams}',v_rows,true);
  v_payload:=jsonb_set(v_payload,'{sectors}',v_sectors,true);
  v_payload:=jsonb_set(v_payload,'{shifts}',v_shifts,true);
  v_payload:=jsonb_set(v_payload,'{reference,rosterCutoverDate}',to_jsonb(v_cutover),true);
  v_payload:=jsonb_set(v_payload,'{reference,rosterApproximate}',to_jsonb(v_cutover is not null and v_target<v_cutover),true);
  v_payload:=jsonb_set(v_payload,'{reference,siteAvgBilledHoursPerVehicle10d}',to_jsonb(case when v_site_avg is null then null else round(v_site_avg,3) end),true);
  v_payload:=jsonb_set(v_payload,'{summary,nominal}',to_jsonb(v_nominal),true);
  v_payload:=jsonb_set(v_payload,'{summary,present}',to_jsonb(v_present),true);
  v_payload:=jsonb_set(v_payload,'{summary,unavailable}',to_jsonb(v_unavailable),true);
  v_payload:=jsonb_set(v_payload,'{summary,pendingLeave}',to_jsonb(v_pending),true);
  v_payload:=jsonb_set(v_payload,'{summary,productiveHours}',to_jsonb(round(v_hours,1)),true);
  v_payload:=jsonb_set(v_payload,'{summary,productiveHoursIfPendingApproved}',to_jsonb(round(v_hours_pending,1)),true);
  v_payload:=jsonb_set(v_payload,'{summary,siteTheoreticalVehicles}',to_jsonb(v_capacity),true);
  v_payload:=jsonb_set(v_payload,'{summary,siteTheoreticalVehiclesIfPendingApproved}',to_jsonb(v_capacity_pending),true);
  v_payload:=jsonb_set(v_payload,'{summary,bottleneckSector}',to_jsonb(v_pressure),true);
  v_payload:=jsonb_set(v_payload,'{summary,bottleneckSectorIfPendingApproved}',to_jsonb(v_pressure_pending),true);
  v_payload:=jsonb_set(v_payload,'{summary,capacityVsActualPct}',case when v_payload->>'mode'='past' and coalesce(v_capacity,0)>0 and v_actual is not null then to_jsonb(round(100*v_actual/v_capacity,1)) else 'null'::jsonb end,true);
  return v_payload;
end
$$;

revoke all on function public.kpi_site_presence_capacity_v3(text,date) from public;
grant execute on function public.kpi_site_presence_capacity_v3(text,date) to anon,authenticated,service_role;
