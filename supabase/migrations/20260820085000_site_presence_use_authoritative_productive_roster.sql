create or replace function public.kpi_site_presence_capacity_v5(p_session_hash text, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_payload jsonb;
  v_target date;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_teams jsonb := '[]'::jsonb;
  v_sectors jsonb := '[]'::jsonb;
  v_shifts jsonb := '[]'::jsonb;
  v_nominal integer := 0;
  v_present integer := 0;
  v_unavailable integer := 0;
  v_pending integer := 0;
  v_hours numeric := 0;
  v_hours_pending numeric := 0;
  v_site_avg numeric;
  v_site_capacity numeric;
  v_site_capacity_pending numeric;
  v_actual numeric;
  v_bottleneck text;
  v_bottleneck_pending text;
begin
  v_payload := public.kpi_site_presence_capacity_v4(p_session_hash, p_date);
  v_target := coalesce((v_payload->>'date')::date, p_date, v_today);

  with
  sector_defs(sector_key,sector_label,sort_order) as (
    values ('expertise','Expertise',1),('mecanique','Mécanique',2),('dsp','DSP',3),('jantes','Jantes',4),('carrosserie','Carrosserie / Fixline',5),('preparation','Préparation',6),('qualite','Qualité',7),('photo','Photo',8)
  ),
  team_defs(team_code,sort_order) as (values('A'::text,1),('B',2),('C',3)),
  population as (
    select e.employee_key,e.full_name,e.team_code,
      case
        when e.primary_population='productif' then case
          when e.primary_sector_key='lavage' then 'preparation'
          when e.primary_sector_key in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo') then e.primary_sector_key
          else null end
        when not e.active and v_target < v_today then case upper(trim(coalesce(e.service,'')))
          when 'EXP' then 'expertise' when 'MEC' then 'mecanique' when 'DSP' then 'dsp' when 'JAN' then 'jantes'
          when 'BOX' then 'carrosserie' when 'FIX' then 'carrosserie' when 'TOL' then 'carrosserie'
          when 'PRE' then 'preparation' when 'PREPA' then 'preparation' when 'LAV' then 'preparation'
          when 'QUA' then 'qualite' when 'PHO' then 'photo' else null end
        else null
      end sector_key
    from public.kpi_staff_effective e
    where e.team_code in ('A','B','C')
      and coalesce(e.entry_date,date '1900-01-01')<=v_target
      and (e.exit_date is null or e.exit_date>=v_target)
      and not coalesce(e.neutralized,false)
  ),
  productive_population as (
    select * from population where sector_key is not null
  ),
  absent_raw as (
    select r.employee_key,r.reason_code from public.kpi_worktime_rh_event_source r
      where r.entity='CRVO' and r.event_kind='absence' and v_target between r.start_date and r.end_date
    union all
    select e.employee_key,e.reason_code from public.kpi_worktime_events e
      where e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and v_target between e.start_date and e.end_date
    union all
    select l.employee_key,'paid_leave'::text from public.kpi_worktime_leave_requests l
      where l.entity='CRVO' and l.status='approved' and v_target between l.start_date and l.end_date
  ),
  absent_class as (
    select p.employee_key,
      case
        when bool_or(a.reason_code in ('paid_leave','rtt_recovery')) then 'leave'
        when bool_or(a.reason_code in ('sick_received','sick_pending','long_absence','work_accident','therapeutic_part_time')) then 'medical'
        else 'other'
      end reason_group
    from productive_population p join absent_raw a on a.employee_key=p.employee_key
    group by p.employee_key
  ),
  pending_leave as (
    select distinct p.employee_key
    from productive_population p
    join public.kpi_worktime_leave_requests l on l.employee_key=p.employee_key and l.entity='CRVO' and l.status='pending' and v_target between l.start_date and l.end_date
    where not exists(select 1 from absent_class a where a.employee_key=p.employee_key)
  ),
  counts as (
    select s.sector_key,s.sector_label,s.sort_order sector_order,t.team_code,t.sort_order team_order,
      count(distinct p.employee_key)::int nominal,
      count(distinct a.employee_key)::int unavailable,
      count(distinct p.employee_key) filter(where a.employee_key is null)::int present,
      count(distinct p.employee_key) filter(where a.reason_group='leave')::int leave_count,
      count(distinct p.employee_key) filter(where a.reason_group='medical')::int medical_count,
      count(distinct p.employee_key) filter(where a.reason_group='other')::int other_count,
      count(distinct pl.employee_key)::int pending_leave
    from sector_defs s cross join team_defs t
    left join productive_population p on p.sector_key=s.sector_key and p.team_code=t.team_code
    left join absent_class a on a.employee_key=p.employee_key
    left join pending_leave pl on pl.employee_key=p.employee_key
    group by s.sector_key,s.sector_label,s.sort_order,t.team_code,t.sort_order
  ),
  merged as (
    select c.*,
      (c.present*7.5)::numeric hours,
      (greatest(c.present-c.pending_leave,0)*7.5)::numeric hours_pending,
      old.item old_item,
      nullif(old.item->>'capacityReferenceHours10d','')::numeric ref_hours
    from counts c
    left join lateral (
      select x.item
      from jsonb_array_elements(coalesce(v_payload->'teams','[]'::jsonb)) x(item)
      where x.item->>'sectorKey'=c.sector_key and x.item->>'team'=c.team_code
      limit 1
    ) old on true
  )
  select coalesce(jsonb_agg(
    coalesce(m.old_item,jsonb_build_object('sectorKey',m.sector_key,'sectorLabel',m.sector_label,'team',m.team_code)) ||
    jsonb_build_object(
      'nominal',m.nominal,'present',m.present,'unavailable',m.unavailable,
      'approvedLeave',m.leave_count,'medicalAbsence',m.medical_count,'otherAbsence',m.other_count,'pendingLeave',m.pending_leave,
      'hours',round(m.hours,1),'hoursIfPendingApproved',round(m.hours_pending,1),
      'availabilityPct',case when m.nominal>0 then round(100.0*m.present/m.nominal,1) else null end,
      'status',case when m.nominal=0 then 'neutral' when 100.0*m.present/m.nominal<70 then 'critical' when 100.0*m.present/m.nominal<80 then 'warning' else 'ok' end,
      'theoreticalVehicles',case when m.ref_hours>0 then round(m.hours/m.ref_hours,1) else null end,
      'theoreticalVehiclesIfPendingApproved',case when m.ref_hours>0 then round(m.hours_pending/m.ref_hours,1) else null end
    ) order by m.sector_order,m.team_order
  ) filter(where m.nominal>0 or m.unavailable>0 or m.pending_leave>0),'[]'::jsonb)
  into v_teams
  from merged m;

  with sector_defs(sector_key,sector_label,sort_order) as (
    values ('expertise','Expertise',1),('mecanique','Mécanique',2),('dsp','DSP',3),('jantes','Jantes',4),('carrosserie','Carrosserie / Fixline',5),('preparation','Préparation',6),('qualite','Qualité',7),('photo','Photo',8)
  ), team_items as (
    select x.item from jsonb_array_elements(v_teams) x(item)
  ), agg as (
    select d.sector_key,d.sector_label,d.sort_order,
      coalesce(sum((t.item->>'nominal')::int),0)::int nominal,
      coalesce(sum((t.item->>'present')::int),0)::int present,
      coalesce(sum((t.item->>'unavailable')::int),0)::int unavailable,
      coalesce(sum((t.item->>'approvedLeave')::int),0)::int leave_count,
      coalesce(sum((t.item->>'medicalAbsence')::int),0)::int medical_count,
      coalesce(sum((t.item->>'otherAbsence')::int),0)::int other_count,
      coalesce(sum((t.item->>'pendingLeave')::int),0)::int pending_leave,
      coalesce(sum((t.item->>'hours')::numeric),0)::numeric hours,
      coalesce(sum((t.item->>'hoursIfPendingApproved')::numeric),0)::numeric hours_pending
    from sector_defs d left join team_items t on t.item->>'sectorKey'=d.sector_key
    group by d.sector_key,d.sector_label,d.sort_order
  ), merged as (
    select a.*,old.item old_item,nullif(old.item->>'capacityReferenceHours10d','')::numeric ref_hours
    from agg a
    left join lateral (
      select x.item from jsonb_array_elements(coalesce(v_payload->'sectors','[]'::jsonb)) x(item)
      where x.item->>'sectorKey'=a.sector_key limit 1
    ) old on true
  )
  select coalesce(jsonb_agg(
    coalesce(m.old_item,jsonb_build_object('sectorKey',m.sector_key,'sectorLabel',m.sector_label)) ||
    jsonb_build_object(
      'nominal',m.nominal,'present',m.present,'unavailable',m.unavailable,
      'approvedLeave',m.leave_count,'medicalAbsence',m.medical_count,'otherAbsence',m.other_count,'pendingLeave',m.pending_leave,
      'hours',round(m.hours,1),'hoursIfPendingApproved',round(m.hours_pending,1),
      'theoreticalVehicles',case when m.ref_hours>0 then round(m.hours/m.ref_hours,1) else null end,
      'theoreticalVehiclesIfPendingApproved',case when m.ref_hours>0 then round(m.hours_pending/m.ref_hours,1) else null end,
      'utilizationPct',case when m.hours>0 and m.ref_hours>0 and nullif(m.old_item->>'actualVehicles','')::numeric is not null then round(100*nullif(m.old_item->>'actualVehicles','')::numeric/(m.hours/m.ref_hours),1) else null end
    ) order by m.sort_order
  ) filter(where m.nominal>0 or m.unavailable>0 or m.pending_leave>0),'[]'::jsonb)
  into v_sectors
  from merged m;

  with team_items as (select x.item from jsonb_array_elements(v_teams) x(item)), team_defs(team_code,sort_order) as (values('A'::text,1),('B',2),('C',3))
  select coalesce(jsonb_agg(jsonb_build_object(
    'team',d.team_code,
    'nominal',coalesce(a.nominal,0),'present',coalesce(a.present,0),'unavailable',coalesce(a.unavailable,0),'pendingLeave',coalesce(a.pending,0),'hours',round(coalesce(a.hours,0),1)
  ) order by d.sort_order),'[]'::jsonb)
  into v_shifts
  from team_defs d
  left join lateral (
    select sum((t.item->>'nominal')::int)::int nominal,sum((t.item->>'present')::int)::int present,sum((t.item->>'unavailable')::int)::int unavailable,sum((t.item->>'pendingLeave')::int)::int pending,sum((t.item->>'hours')::numeric)::numeric hours
    from team_items t where t.item->>'team'=d.team_code
  ) a on true;

  select coalesce(sum((x.item->>'nominal')::int),0),coalesce(sum((x.item->>'present')::int),0),coalesce(sum((x.item->>'unavailable')::int),0),coalesce(sum((x.item->>'pendingLeave')::int),0),coalesce(sum((x.item->>'hours')::numeric),0),coalesce(sum((x.item->>'hoursIfPendingApproved')::numeric),0)
  into v_nominal,v_present,v_unavailable,v_pending,v_hours,v_hours_pending
  from jsonb_array_elements(v_sectors) x(item);

  v_site_avg := nullif(v_payload->'reference'->>'siteAvgBilledHoursPerVehicle10d','')::numeric;
  if coalesce(v_site_avg,0)>0 then
    v_site_capacity := floor(v_hours/v_site_avg);
    v_site_capacity_pending := floor(v_hours_pending/v_site_avg);
  end if;

  select x.item->>'sectorLabel' into v_bottleneck
  from jsonb_array_elements(v_sectors) x(item)
  where coalesce((x.item->>'nominal')::numeric,0)>0
  order by coalesce((x.item->>'present')::numeric,0)/nullif((x.item->>'nominal')::numeric,0) asc nulls last
  limit 1;

  select x.item->>'sectorLabel' into v_bottleneck_pending
  from jsonb_array_elements(v_sectors) x(item)
  where coalesce((x.item->>'nominal')::numeric,0)>0
  order by greatest(coalesce((x.item->>'present')::numeric,0)-coalesce((x.item->>'pendingLeave')::numeric,0),0)/nullif((x.item->>'nominal')::numeric,0) asc nulls last
  limit 1;

  v_actual := nullif(v_payload->'summary'->>'actualFactoryExits','')::numeric;

  v_payload := jsonb_set(v_payload,'{teams}',v_teams,true);
  v_payload := jsonb_set(v_payload,'{sectors}',v_sectors,true);
  v_payload := jsonb_set(v_payload,'{shifts}',v_shifts,true);
  v_payload := jsonb_set(v_payload,'{summary,nominal}',to_jsonb(v_nominal),true);
  v_payload := jsonb_set(v_payload,'{summary,present}',to_jsonb(v_present),true);
  v_payload := jsonb_set(v_payload,'{summary,unavailable}',to_jsonb(v_unavailable),true);
  v_payload := jsonb_set(v_payload,'{summary,pendingLeave}',to_jsonb(v_pending),true);
  v_payload := jsonb_set(v_payload,'{summary,productiveHours}',to_jsonb(round(v_hours,1)),true);
  v_payload := jsonb_set(v_payload,'{summary,productiveHoursIfPendingApproved}',to_jsonb(round(v_hours_pending,1)),true);
  v_payload := jsonb_set(v_payload,'{summary,siteTheoreticalVehicles}',case when v_site_capacity is null then 'null'::jsonb else to_jsonb(v_site_capacity) end,true);
  v_payload := jsonb_set(v_payload,'{summary,siteTheoreticalVehiclesIfPendingApproved}',case when v_site_capacity_pending is null then 'null'::jsonb else to_jsonb(v_site_capacity_pending) end,true);
  v_payload := jsonb_set(v_payload,'{summary,bottleneckSector}',to_jsonb(v_bottleneck),true);
  v_payload := jsonb_set(v_payload,'{summary,bottleneckSectorIfPendingApproved}',to_jsonb(v_bottleneck_pending),true);
  v_payload := jsonb_set(v_payload,'{summary,capacityVsActualPct}',case when v_payload->>'mode'='past' and coalesce(v_site_capacity,0)>0 and v_actual is not null then to_jsonb(round(100*v_actual/v_site_capacity,1)) else 'null'::jsonb end,true);
  v_payload := jsonb_set(v_payload,'{reference,rosterSource}',to_jsonb('kpi_staff_effective · population productif autoritaire'::text),true);
  return v_payload;
end
$$;

revoke all on function public.kpi_site_presence_capacity_v5(text,date) from public;
grant execute on function public.kpi_site_presence_capacity_v5(text,date) to anon,authenticated,service_role;
