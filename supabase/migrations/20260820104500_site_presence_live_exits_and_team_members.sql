create or replace function public.kpi_site_presence_capacity_v8(
  p_session_hash text,
  p_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payload jsonb;
  v_target date;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_live_metrics jsonb := '{}'::jsonb;
  v_live_source text;
  v_live_exits numeric;
  v_latest_source timestamptz;
begin
  v_payload := public.kpi_site_presence_capacity_v7(p_session_hash,p_date);
  v_target := coalesce((v_payload->>'date')::date,p_date,v_today);

  if v_target = v_today then
    select h.metrics,h.source_name
      into v_live_metrics,v_live_source
    from public.kpi_ftp_daily_history h
    where h.snapshot_at=v_target
    limit 1;

    v_live_exits := nullif(v_live_metrics->>'exits_vop','')::numeric;

    if v_live_exits is null then
      select max(f.source_modified_at)
        into v_latest_source
      from public.kpi_ftp_factory_production f
      where f.production_date=v_target
        and f.flow in ('VOP EFF','VOP EXT');

      if v_latest_source is not null then
        select coalesce(sum(f.available),0)::numeric
          into v_live_exits
        from public.kpi_ftp_factory_production f
        where f.production_date=v_target
          and f.flow in ('VOP EFF','VOP EXT')
          and f.source_modified_at=v_latest_source;
        v_live_source := 'Factory live · dernière alimentation';
      end if;
    end if;

    if v_live_exits is not null then
      v_payload := jsonb_set(v_payload,'{summary,actualFactoryExits}',to_jsonb(v_live_exits),true);
      v_payload := jsonb_set(v_payload,'{summary,dashboardExits}',to_jsonb(v_live_exits),true);
      v_payload := jsonb_set(v_payload,'{actualSource}',to_jsonb(coalesce(v_live_source,'Factory live') || ' · sorties à ce stade'),true);
    end if;
  end if;

  return v_payload;
end
$function$;

create or replace function public.kpi_site_presence_team_members(
  p_session_hash text,
  p_date date default null::date,
  p_sector text default null,
  p_team text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_access jsonb;
  v_target date := coalesce(p_date,(now() at time zone 'Europe/Paris')::date);
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_members jsonb := '[]'::jsonb;
  v_nominal integer := 0;
  v_present integer := 0;
  v_unavailable integer := 0;
  v_pending integer := 0;
begin
  v_access := public.kpi_site_presence_capacity_access(p_session_hash);
  if not coalesce((v_access->>'allowed')::boolean,false) then
    raise exception 'Accès réservé aux superviseurs, chefs de service et administrateurs.' using errcode='42501';
  end if;

  if p_sector not in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo') then
    raise exception 'Activité invalide.' using errcode='22023';
  end if;
  if p_team not in ('A','B','C') then
    raise exception 'Équipe invalide.' using errcode='22023';
  end if;

  with population as (
    select e.employee_key,e.matricule,e.full_name,e.team_code,e.service,e.job_title,
      case
        when e.primary_population='fixline' then 'carrosserie'
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
    where e.team_code=p_team
      and coalesce(e.entry_date,date '1900-01-01')<=v_target
      and (e.exit_date is null or e.exit_date>=v_target)
      and not coalesce(e.neutralized,false)
  ), scoped_population as (
    select * from population where sector_key=p_sector
  ), absent_raw as (
    select r.employee_key,r.reason_code
    from public.kpi_worktime_rh_event_source r
    join scoped_population p on p.employee_key=r.employee_key
    where r.entity='CRVO' and r.event_kind='absence' and v_target between r.start_date and r.end_date
    union all
    select e.employee_key,e.reason_code
    from public.kpi_worktime_events e
    join scoped_population p on p.employee_key=e.employee_key
    where e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and v_target between e.start_date and e.end_date
    union all
    select l.employee_key,'paid_leave'::text
    from public.kpi_worktime_leave_requests l
    join scoped_population p on p.employee_key=l.employee_key
    where l.entity='CRVO' and l.status='approved' and v_target between l.start_date and l.end_date
  ), absent_class as (
    select p.employee_key,
      case
        when bool_or(a.reason_code in ('paid_leave','rtt_recovery')) then 'leave'
        when bool_or(a.reason_code in ('sick_received','sick_pending','long_absence','work_accident','therapeutic_part_time')) then 'medical'
        else 'other_absence'
      end status,
      string_agg(distinct a.reason_code,', ' order by a.reason_code) reason_codes
    from scoped_population p
    join absent_raw a on a.employee_key=p.employee_key
    group by p.employee_key
  ), pending as (
    select distinct p.employee_key
    from scoped_population p
    join public.kpi_worktime_leave_requests l
      on l.employee_key=p.employee_key
     and l.entity='CRVO'
     and l.status='pending'
     and v_target between l.start_date and l.end_date
    where not exists(select 1 from absent_class a where a.employee_key=p.employee_key)
  ), final as (
    select p.*,
      coalesce(a.status,case when q.employee_key is not null then 'pending_leave' else 'present' end) status,
      a.reason_codes,
      (q.employee_key is not null) pending_leave
    from scoped_population p
    left join absent_class a on a.employee_key=p.employee_key
    left join pending q on q.employee_key=p.employee_key
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'employeeKey',f.employee_key,
      'matricule',f.matricule,
      'name',f.full_name,
      'team',f.team_code,
      'service',f.service,
      'jobTitle',f.job_title,
      'sector',f.sector_key,
      'status',f.status,
      'reasonCodes',f.reason_codes
    ) order by f.full_name),'[]'::jsonb),
    count(*)::int,
    count(*) filter(where f.status='present')::int,
    count(*) filter(where f.status in ('leave','medical','other_absence'))::int,
    count(*) filter(where f.status='pending_leave')::int
  into v_members,v_nominal,v_present,v_unavailable,v_pending
  from final f;

  return jsonb_build_object(
    'connected',true,
    'date',to_char(v_target,'YYYY-MM-DD'),
    'sector',p_sector,
    'team',p_team,
    'nominal',v_nominal,
    'present',v_present,
    'unavailable',v_unavailable,
    'pendingLeave',v_pending,
    'members',v_members
  );
end
$function$;

revoke all on function public.kpi_site_presence_capacity_v8(text,date) from public;
revoke all on function public.kpi_site_presence_team_members(text,date,text,text) from public;
grant execute on function public.kpi_site_presence_capacity_v8(text,date) to anon,authenticated,service_role;
grant execute on function public.kpi_site_presence_team_members(text,date,text,text) to anon,authenticated,service_role;
