create or replace function public.kpi_site_productive_sector_from_service(p_service text)
returns text
language sql
immutable
set search_path='public'
as $$
  select case upper(trim(coalesce(p_service,'')))
    when 'EXP' then 'expertise'
    when 'MEC' then 'mecanique'
    when 'DSP' then 'dsp'
    when 'JAN' then 'jantes'
    when 'BOX' then 'carrosserie'
    when 'FIX' then 'carrosserie'
    when 'TOL' then 'carrosserie'
    when 'PRE' then 'preparation'
    when 'LAV' then 'preparation'
    when 'QUA' then 'qualite'
    when 'PHO' then 'photo'
    else null
  end
$$;

create or replace function public.kpi_site_presence_capacity_access(p_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path='public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_level text;
  v_position text;
  v_allowed boolean:=false;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then return jsonb_build_object('allowed',false); end if;

  select p.level_code,p.position_key into v_level,v_position
  from public.kpi_worktime_user_position up
  join public.kpi_worktime_org_positions p on p.position_key=up.position_key and p.active and p.entity='CRVO'
  where up.user_id=v_user.id limit 1;

  v_allowed := v_user.role='admin'
    or v_user.access_profile='service_manager'
    or coalesce(v_level,'') in ('supervisor','industrial_manager');

  return jsonb_build_object(
    'allowed',v_allowed,
    'role',v_user.role,
    'profile',v_user.access_profile,
    'level',v_level,
    'positionKey',v_position,
    'displayName',v_user.display_name
  );
end
$$;

create or replace function public.kpi_site_presence_capacity(p_session_hash text,p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_level text;
  v_position text;
  v_target date:=coalesce(p_date,(now() at time zone 'Europe/Paris')::date);
  v_today date:=(now() at time zone 'Europe/Paris')::date;
  v_mode text;
  v_ref_from date:=v_target-10;
  v_ref_to date:=v_target-1;
  v_billed_hash text;
  v_billed_imported_at timestamptz;
  v_site_ref_vehicles integer:=0;
  v_ref_min_invoice date;
  v_ref_max_invoice date;
  v_actual_metrics jsonb:='{}'::jsonb;
  v_actual_source text;
  v_wheels integer;
  v_photos integer;
  v_actual_exits integer;
  v_rows jsonb:='[]'::jsonb;
  v_sectors jsonb:='[]'::jsonb;
  v_shifts jsonb:='[]'::jsonb;
  v_total_nominal integer:=0;
  v_total_present integer:=0;
  v_total_unavailable integer:=0;
  v_total_pending integer:=0;
  v_total_hours numeric:=0;
  v_total_hours_pending numeric:=0;
  v_site_capacity numeric;
  v_site_capacity_pending numeric;
  v_bottleneck text;
  v_bottleneck_pending text;
  v_reference_complete boolean:=false;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  select p.level_code,p.position_key into v_level,v_position
  from public.kpi_worktime_user_position up
  join public.kpi_worktime_org_positions p on p.position_key=up.position_key and p.active and p.entity='CRVO'
  where up.user_id=v_user.id limit 1;

  if not (v_user.role='admin' or v_user.access_profile='service_manager' or coalesce(v_level,'') in ('supervisor','industrial_manager')) then
    raise exception 'Accès réservé aux superviseurs, chefs de service et administrateurs.' using errcode='42501';
  end if;

  if v_target < date '2024-01-01' or v_target > v_today+366 then raise exception 'Date hors plage.' using errcode='22023'; end if;
  v_mode:=case when v_target<v_today then 'past' when v_target=v_today then 'today' else 'future' end;

  select b.file_sha256,b.completed_at into v_billed_hash,v_billed_imported_at
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported'
  order by b.completed_at desc nulls last,b.created_at desc limit 1;

  select count(distinct i.work_order)::int,min(i.invoice_date),max(i.invoice_date)
  into v_site_ref_vehicles,v_ref_min_invoice,v_ref_max_invoice
  from public.kpi_invoice_facts i
  where i.invoice_date between v_ref_from and v_ref_to and nullif(trim(i.work_order),'') is not null;

  select h.metrics,h.source_name into v_actual_metrics,v_actual_source
  from public.kpi_ftp_daily_history h where h.snapshot_at=v_target limit 1;

  with ranked as (
    select f.*,row_number() over(partition by f.production_date,f.flow order by f.source_modified_at desc nulls last,f.created_at desc) rn
    from public.kpi_ftp_factory_production f
    where f.production_date=v_target and f.flow in ('VOP EFF','VOP EXT')
  )
  select coalesce(sum(wheels),0)::int,coalesce(sum(photos),0)::int into v_wheels,v_photos from ranked where rn=1;

  select count(distinct coalesce(nullif(e.vin,''),nullif(e.work_order,''),nullif(e.registration,''),e.id::text))::int into v_actual_exits
  from public.kpi_ftp_status_events e
  where e.event_date=v_target and e.status='Sortie Usine' and e.flow in ('VOP EFF','VOP EXT');

  with
  sector_defs(sector_key,sector_label,sort_order) as (
    values ('expertise','Expertise',1),('mecanique','Mécanique',2),('dsp','DSP',3),('jantes','Jantes',4),('carrosserie','Carrosserie / Fixline',5),('preparation','Préparation',6),('qualite','Qualité',7),('photo','Photo',8)
  ),
  team_defs(team_code,sort_order) as (values('A'::text,1),('B',2),('C',3)),
  staff_latest as (
    select distinct on (d.employee_key) d.employee_key,d.full_name,d.team_code,d.service,d.active,d.entry_date,d.exit_date,d.source_updated_at,
      public.kpi_site_productive_sector_from_service(d.service) sector_key
    from public.kpi_rh_staff_dimension d
    where d.employee_key is not null
    order by d.employee_key,d.active desc,d.source_updated_at desc nulls last,d.entry_date desc nulls last
  ),
  population as (
    select s.employee_key,s.full_name,s.team_code,s.service,s.sector_key
    from staff_latest s
    where s.team_code in ('A','B','C') and s.sector_key is not null
      and coalesce(s.entry_date,date '1900-01-01')<=v_target
      and (s.exit_date is null or s.exit_date>=v_target)
      and (v_target<v_today or s.active)
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
    from population p join absent_raw a on a.employee_key=p.employee_key
    group by p.employee_key
  ),
  pending_leave as (
    select distinct p.employee_key
    from population p join public.kpi_worktime_leave_requests l on l.employee_key=p.employee_key and l.entity='CRVO' and l.status='pending'
      and v_target between l.start_date and l.end_date
    where not exists(select 1 from absent_class a where a.employee_key=p.employee_key)
  ),
  team_capacity as (
    select s.sector_key,s.sector_label,s.sort_order sector_order,t.team_code,t.sort_order team_order,
      count(distinct p.employee_key)::int nominal,
      count(distinct a.employee_key)::int unavailable,
      count(distinct p.employee_key) filter(where a.employee_key is null)::int present,
      count(distinct p.employee_key) filter(where a.reason_group='leave')::int leave_count,
      count(distinct p.employee_key) filter(where a.reason_group='medical')::int medical_count,
      count(distinct p.employee_key) filter(where a.reason_group='other')::int other_absence_count,
      count(distinct pl.employee_key)::int pending_leave,
      (count(distinct p.employee_key) filter(where a.employee_key is null)*7.5)::numeric hours,
      (greatest(count(distinct p.employee_key) filter(where a.employee_key is null)-count(distinct pl.employee_key),0)*7.5)::numeric hours_if_pending
    from sector_defs s cross join team_defs t
    left join population p on p.sector_key=s.sector_key and p.team_code=t.team_code
    left join absent_class a on a.employee_key=p.employee_key
    left join pending_leave pl on pl.employee_key=p.employee_key
    group by s.sector_key,s.sector_label,s.sort_order,t.team_code,t.sort_order
  ),
  inv as (
    select distinct i.work_order
    from public.kpi_invoice_facts i
    where i.invoice_date between v_ref_from and v_ref_to and nullif(trim(i.work_order),'') is not null
  ),
  sector_ref as (
    select d.sector_key,
      coalesce(sum(b.labor_hours),0)::numeric billed_hours,
      count(distinct b.work_order)::int touched_vehicles,
      case when v_site_ref_vehicles>0 then coalesce(sum(b.labor_hours),0)/v_site_ref_vehicles else null end::numeric avg_hours_site_vehicle,
      case when count(distinct b.work_order)>0 then coalesce(sum(b.labor_hours),0)/count(distinct b.work_order) else null end::numeric avg_hours_touched_vehicle
    from sector_defs d
    left join public.kpi_billed_time_facts b on b.sector_key=d.sector_key and (v_billed_hash is null or b.source_file_sha256=v_billed_hash) and exists(select 1 from inv i where i.work_order=b.work_order)
    group by d.sector_key
  ),
  enriched as (
    select tc.*,sr.billed_hours,sr.touched_vehicles,sr.avg_hours_site_vehicle,sr.avg_hours_touched_vehicle,
      case when sr.avg_hours_site_vehicle>0 then tc.hours/sr.avg_hours_site_vehicle else null end theoretical_vehicles,
      case when sr.avg_hours_site_vehicle>0 then tc.hours_if_pending/sr.avg_hours_site_vehicle else null end theoretical_vehicles_pending,
      case when tc.nominal=0 then 'neutral'
        when 100.0*tc.present/tc.nominal<70 then 'critical'
        when 100.0*tc.present/tc.nominal<80 then 'warning'
        else 'ok' end availability_status
    from team_capacity tc left join sector_ref sr using(sector_key)
  ),
  sector_agg as (
    select e.sector_key,max(e.sector_label) sector_label,min(e.sector_order) sector_order,
      sum(e.nominal)::int nominal,sum(e.unavailable)::int unavailable,sum(e.present)::int present,
      sum(e.leave_count)::int leave_count,sum(e.medical_count)::int medical_count,sum(e.other_absence_count)::int other_absence_count,
      sum(e.pending_leave)::int pending_leave,sum(e.hours)::numeric hours,sum(e.hours_if_pending)::numeric hours_if_pending,
      max(e.avg_hours_site_vehicle)::numeric avg_hours_site_vehicle,max(e.avg_hours_touched_vehicle)::numeric avg_hours_touched_vehicle,max(e.touched_vehicles)::int touched_vehicles,
      case when max(e.avg_hours_site_vehicle)>0 then sum(e.hours)/max(e.avg_hours_site_vehicle) else null end theoretical_vehicles,
      case when max(e.avg_hours_site_vehicle)>0 then sum(e.hours_if_pending)/max(e.avg_hours_site_vehicle) else null end theoretical_vehicles_pending
    from enriched e group by e.sector_key
  ),
  actual_sector as (
    select 'expertise'::text sector_key,nullif(v_actual_metrics->>'production_expertise','')::numeric actual union all
    select 'mecanique',nullif(v_actual_metrics->>'production_mechanics','')::numeric union all
    select 'dsp',nullif(v_actual_metrics->>'production_dsp','')::numeric union all
    select 'carrosserie',nullif(v_actual_metrics->>'production_bodywork','')::numeric union all
    select 'preparation',nullif(v_actual_metrics->>'production_preparation','')::numeric union all
    select 'qualite',nullif(v_actual_metrics->>'production_quality','')::numeric union all
    select 'jantes',case when v_wheels is null then null else v_wheels::numeric end union all
    select 'photo',case when v_photos is null then null else v_photos::numeric end
  ),
  sector_final as (
    select s.*,a.actual,
      case when s.theoretical_vehicles>0 and a.actual is not null then round(100*a.actual/s.theoretical_vehicles,1) else null end utilization_pct
    from sector_agg s left join actual_sector a using(sector_key)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
      'sectorKey',e.sector_key,'sectorLabel',e.sector_label,'team',e.team_code,
      'nominal',e.nominal,'present',e.present,'unavailable',e.unavailable,'approvedLeave',e.leave_count,'medicalAbsence',e.medical_count,'otherAbsence',e.other_absence_count,'pendingLeave',e.pending_leave,
      'hours',round(e.hours,1),'hoursIfPendingApproved',round(e.hours_if_pending,1),'availabilityPct',case when e.nominal>0 then round(100.0*e.present/e.nominal,1) else null end,'status',e.availability_status,
      'avgBilledHoursPerSiteVehicle10d',case when e.avg_hours_site_vehicle is null then null else round(e.avg_hours_site_vehicle,3) end,
      'avgBilledHoursPerTouchedVehicle10d',case when e.avg_hours_touched_vehicle is null then null else round(e.avg_hours_touched_vehicle,3) end,
      'referenceTouchedVehicles',e.touched_vehicles,
      'theoreticalVehicles',case when e.theoretical_vehicles is null then null else round(e.theoretical_vehicles,1) end,
      'theoreticalVehiclesIfPendingApproved',case when e.theoretical_vehicles_pending is null then null else round(e.theoretical_vehicles_pending,1) end
    ) order by e.sector_order,e.team_order) from enriched e where e.nominal>0 or e.unavailable>0 or e.pending_leave>0),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'sectorKey',s.sector_key,'sectorLabel',s.sector_label,'nominal',s.nominal,'present',s.present,'unavailable',s.unavailable,'approvedLeave',s.leave_count,'medicalAbsence',s.medical_count,'otherAbsence',s.other_absence_count,'pendingLeave',s.pending_leave,
      'hours',round(s.hours,1),'hoursIfPendingApproved',round(s.hours_if_pending,1),
      'avgBilledHoursPerSiteVehicle10d',case when s.avg_hours_site_vehicle is null then null else round(s.avg_hours_site_vehicle,3) end,
      'avgBilledHoursPerTouchedVehicle10d',case when s.avg_hours_touched_vehicle is null then null else round(s.avg_hours_touched_vehicle,3) end,
      'referenceTouchedVehicles',s.touched_vehicles,
      'theoreticalVehicles',case when s.theoretical_vehicles is null then null else round(s.theoretical_vehicles,1) end,
      'theoreticalVehiclesIfPendingApproved',case when s.theoretical_vehicles_pending is null then null else round(s.theoretical_vehicles_pending,1) end,
      'actualVehicles',s.actual,'utilizationPct',s.utilization_pct
    ) order by s.sector_order) from sector_final s),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('team',x.team_code,'nominal',x.nominal,'present',x.present,'unavailable',x.unavailable,'pendingLeave',x.pending_leave,'hours',round(x.hours,1)) order by x.team_code) from (
      select e.team_code,sum(e.nominal)::int nominal,sum(e.present)::int present,sum(e.unavailable)::int unavailable,sum(e.pending_leave)::int pending_leave,sum(e.hours)::numeric hours from enriched e group by e.team_code
    ) x),'[]'::jsonb),
    coalesce((select sum(nominal)::int from sector_agg),0),coalesce((select sum(present)::int from sector_agg),0),coalesce((select sum(unavailable)::int from sector_agg),0),coalesce((select sum(pending_leave)::int from sector_agg),0),coalesce((select sum(hours)::numeric from sector_agg),0),coalesce((select sum(hours_if_pending)::numeric from sector_agg),0),
    (select floor(min(theoretical_vehicles)) from sector_agg where avg_hours_site_vehicle>0),
    (select floor(min(theoretical_vehicles_pending)) from sector_agg where avg_hours_site_vehicle>0),
    (select sector_label from sector_agg where avg_hours_site_vehicle>0 order by theoretical_vehicles asc nulls last,sector_order limit 1),
    (select sector_label from sector_agg where avg_hours_site_vehicle>0 order by theoretical_vehicles_pending asc nulls last,sector_order limit 1),
    (select count(*)=8 from sector_ref where avg_hours_site_vehicle>0)
  into v_rows,v_sectors,v_shifts,v_total_nominal,v_total_present,v_total_unavailable,v_total_pending,v_total_hours,v_total_hours_pending,v_site_capacity,v_site_capacity_pending,v_bottleneck,v_bottleneck_pending,v_reference_complete;

  return jsonb_build_object(
    'connected',true,
    'date',to_char(v_target,'YYYY-MM-DD'),
    'mode',v_mode,
    'isWeekend',extract(isodow from v_target) in (6,7),
    'access',jsonb_build_object('role',v_user.role,'profile',v_user.access_profile,'level',v_level,'positionKey',v_position,'displayName',v_user.display_name),
    'reference',jsonb_build_object('windowStart',to_char(v_ref_from,'YYYY-MM-DD'),'windowEnd',to_char(v_ref_to,'YYYY-MM-DD'),'invoiceMinDate',v_ref_min_invoice,'invoiceMaxDate',v_ref_max_invoice,'invoicedVehicles',v_site_ref_vehicles,'billedImportedAt',v_billed_imported_at,'complete',v_reference_complete,'method','Heures facturées secteur / véhicules facturés site sur les 10 jours glissants précédents'),
    'hoursPerProductive',7.5,
    'teams',v_rows,
    'sectors',v_sectors,
    'shifts',v_shifts,
    'summary',jsonb_build_object(
      'nominal',v_total_nominal,'present',v_total_present,'unavailable',v_total_unavailable,'pendingLeave',v_total_pending,
      'productiveHours',round(v_total_hours,1),'productiveHoursIfPendingApproved',round(v_total_hours_pending,1),
      'siteTheoreticalVehicles',v_site_capacity,'siteTheoreticalVehiclesIfPendingApproved',v_site_capacity_pending,
      'bottleneckSector',v_bottleneck,'bottleneckSectorIfPendingApproved',v_bottleneck_pending,
      'actualFactoryExits',case when v_mode='future' then null else v_actual_exits end,
      'dashboardExits',case when v_mode='future' then null else nullif(v_actual_metrics->>'exits_vop','')::numeric end,
      'capacityVsActualPct',case when v_mode='past' and coalesce(v_site_capacity,0)>0 then round(100.0*v_actual_exits/v_site_capacity,1) else null end
    ),
    'actualSource',v_actual_source
  );
end
$$;

revoke all on function public.kpi_site_productive_sector_from_service(text) from public;
revoke all on function public.kpi_site_presence_capacity_access(text) from public;
revoke all on function public.kpi_site_presence_capacity(text,date) from public;
grant execute on function public.kpi_site_productive_sector_from_service(text) to anon,authenticated,service_role;
grant execute on function public.kpi_site_presence_capacity_access(text) to anon,authenticated,service_role;
grant execute on function public.kpi_site_presence_capacity(text,date) to anon,authenticated,service_role;

create index if not exists kpi_invoice_date_workorder_idx on public.kpi_invoice_facts(invoice_date,work_order);
create index if not exists kpi_billed_workorder_source_sector_idx on public.kpi_billed_time_facts(work_order,source_file_sha256,sector_key);
create index if not exists kpi_status_events_date_status_idx on public.kpi_ftp_status_events(event_date,status);
