create or replace function public.kpi_worktime_population_for_date(p_date date)
returns table(employee_key text,employee_name text,matricule text,team_code text,service text,sector_key text)
language sql
stable
security definer
set search_path='public'
as $$
with params as (
  select date '2026-08-17' as cutover,(now() at time zone 'Europe/Paris')::date as today
), authoritative as (
  select
    e.employee_key,
    e.full_name as employee_name,
    e.matricule,
    e.team_code,
    e.service,
    case
      when e.primary_population='fixline' then 'carrosserie'
      when e.primary_sector_key='lavage' then 'preparation'
      when e.primary_sector_key='administratif' then 'admin'
      else e.primary_sector_key
    end as sector_key
  from public.kpi_staff_effective e,params x
  where p_date>=x.cutover
    and not coalesce(e.neutralized,false)
    and coalesce(e.entry_date,date '1900-01-01')<=p_date
    and (e.exit_date is null or e.exit_date>=p_date)
    and (p_date<x.today or e.active or e.exit_date is null or e.exit_date>=p_date)
), latest_staff as (
  select distinct on (d.name_key)
    d.name_key,d.employee_key,d.full_name,d.matricule,d.team_code,d.service,d.active,d.source_updated_at,d.entry_date,d.exit_date
  from public.kpi_rh_staff_dimension d
  where d.name_key is not null
  order by d.name_key,d.active desc,d.source_updated_at desc nulls last,d.entry_date desc nulls last
), historical_presence as (
  select distinct f.person_name_key
  from public.kpi_sql_presence_facts f
  where f.work_date=p_date and f.person_name_key is not null
), legacy as (
  select s.employee_key,s.full_name as employee_name,s.matricule,s.team_code,s.service,m.sector_key
  from latest_staff s
  left join public.kpi_worktime_service_sector_map m on m.service_code=s.service
  where p_date<date '2026-08-17'
    and exists(select 1 from historical_presence h where h.person_name_key=s.name_key)
)
select * from authoritative
union all
select * from legacy
$$;

create or replace function public.kpi_worktime_leave_dashboard_v2(
  p_session_hash text,
  p_from date,
  p_to date,
  p_team text default null,
  p_sector text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_base jsonb;
  v_user public.crvo_auth_users%rowtype;
  v_scope record;
  v_from date:=coalesce(p_from,(now() at time zone 'Europe/Paris')::date);
  v_to date:=coalesce(p_to,v_from);
  v_team text:=nullif(trim(coalesce(p_team,'')),'');
  v_sector text:=nullif(trim(coalesce(p_sector,'')),'');
  v_calendar jsonb:='[]'::jsonb;
  v_people jsonb:='[]'::jsonb;
  v_effective_sector text;
  v_effective_sector_count integer:=0;
  v_productive_sectors text[]:=array['expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo'];
begin
  if v_team='*' then v_team:=null; end if;
  if v_sector='*' then v_sector:=null; end if;
  v_base:=public.kpi_worktime_leave_dashboard(p_session_hash,v_from,v_to,v_team,v_sector);

  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;

  with scoped as (
    select distinct p.sector_key
    from public.kpi_worktime_population_for_date(greatest(v_from,(now() at time zone 'Europe/Paris')::date)) p
    where p.sector_key=any(v_productive_sectors)
      and (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
      and (v_team is null or p.team_code=v_team)
  )
  select count(*),min(sector_key) into v_effective_sector_count,v_effective_sector from scoped;
  if v_sector is not null and v_sector=any(v_productive_sectors) then
    v_effective_sector:=v_sector;
  elsif v_effective_sector_count<>1 then
    v_effective_sector:=null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeKey',p.employee_key,'name',p.employee_name,'matricule',p.matricule,
    'team',p.team_code,'service',p.service,'sector',p.sector_key,'jobTitle',null
  ) order by p.employee_name),'[]'::jsonb)
  into v_people
  from public.kpi_worktime_population_for_date(greatest(v_from,(now() at time zone 'Europe/Paris')::date)) p
  where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
    and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
    and (v_team is null or p.team_code=v_team)
    and (v_sector is null or p.sector_key=v_sector);

  with
  days as (select gs::date as day from generate_series(v_from,v_to,interval '1 day') gs),
  selected_population as (
    select d.day,p.*
    from days d cross join lateral public.kpi_worktime_population_for_date(d.day) p
    where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
      and (v_team is null or p.team_code=v_team)
      and (v_sector is null or p.sector_key=v_sector)
  ),
  global_productive as (
    select d.day,p.employee_key,p.employee_name,p.team_code,p.sector_key
    from days d cross join lateral public.kpi_worktime_population_for_date(d.day) p
    where p.sector_key=any(v_productive_sectors)
  ),
  absence_events as (
    select distinct p.day,p.employee_key,p.employee_name,r.reason_code
    from selected_population p join public.kpi_worktime_rh_event_source r
      on r.entity='CRVO' and r.event_kind='absence' and p.day between r.start_date and r.end_date
     and (r.employee_key=p.employee_key or public.kpi_normalize_person_name(r.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    union
    select distinct p.day,p.employee_key,p.employee_name,e.reason_code
    from selected_population p join public.kpi_worktime_events e
      on e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and p.day between e.start_date and e.end_date
     and (e.employee_key=p.employee_key or public.kpi_normalize_person_name(e.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    union
    select distinct p.day,p.employee_key,p.employee_name,'paid_leave'::text
    from selected_population p join public.kpi_worktime_leave_requests l
      on l.entity='CRVO' and l.status='approved' and p.day between l.start_date and l.end_date
     and (l.employee_key=p.employee_key or public.kpi_normalize_person_name(l.employee_name)=public.kpi_normalize_person_name(p.employee_name))
  ),
  absence_class as (
    select p.day,p.employee_key,bool_or(a.reason_code in ('paid_leave','rtt_recovery')) as is_leave,true as unavailable
    from selected_population p join absence_events a on a.day=p.day and a.employee_key=p.employee_key
    group by p.day,p.employee_key
  ),
  global_absence_events as (
    select distinct p.day,p.employee_key,p.employee_name,r.reason_code
    from global_productive p join public.kpi_worktime_rh_event_source r
      on r.entity='CRVO' and r.event_kind='absence' and p.day between r.start_date and r.end_date
     and (r.employee_key=p.employee_key or public.kpi_normalize_person_name(r.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    union
    select distinct p.day,p.employee_key,p.employee_name,e.reason_code
    from global_productive p join public.kpi_worktime_events e
      on e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and p.day between e.start_date and e.end_date
     and (e.employee_key=p.employee_key or public.kpi_normalize_person_name(e.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    union
    select distinct p.day,p.employee_key,p.employee_name,'paid_leave'::text
    from global_productive p join public.kpi_worktime_leave_requests l
      on l.entity='CRVO' and l.status='approved' and p.day between l.start_date and l.end_date
     and (l.employee_key=p.employee_key or public.kpi_normalize_person_name(l.employee_name)=public.kpi_normalize_person_name(p.employee_name))
  ),
  global_absent as (select distinct day,employee_key from global_absence_events),
  pending as (
    select distinct p.day,p.employee_key
    from selected_population p join public.kpi_worktime_leave_requests l
      on l.entity='CRVO' and l.status='pending' and p.day between l.start_date and l.end_date
     and (l.employee_key=p.employee_key or public.kpi_normalize_person_name(l.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    where not exists(select 1 from absence_class a where a.day=p.day and a.employee_key=p.employee_key)
  ),
  selected_agg as (
    select d.day,
      count(distinct p.employee_key)::int total,
      count(distinct a.employee_key)::int unavailable,
      count(distinct p.employee_key) filter(where a.is_leave)::int paid_leave,
      count(distinct pe.employee_key)::int pending_leave,
      count(distinct p.employee_key) filter(where p.sector_key=any(v_productive_sectors))::int productive_total,
      count(distinct p.employee_key) filter(where p.sector_key=any(v_productive_sectors) and a.employee_key is null)::int productive_present,
      count(distinct pe.employee_key) filter(where p.sector_key=any(v_productive_sectors))::int productive_pending
    from days d left join selected_population p on p.day=d.day
    left join absence_class a on a.day=d.day and a.employee_key=p.employee_key
    left join pending pe on pe.day=d.day and pe.employee_key=p.employee_key
    group by d.day
  ),
  global_agg as (
    select d.day,
      count(distinct p.employee_key)::int global_productive_total,
      count(distinct p.employee_key) filter(where ga.employee_key is null)::int global_productive_present,
      count(distinct p.employee_key) filter(where v_effective_sector is not null and p.sector_key=v_effective_sector)::int global_sector_total
    from days d left join global_productive p on p.day=d.day
    left join global_absent ga on ga.day=d.day and ga.employee_key=p.employee_key
    group by d.day
  ),
  objectives as (
    select d.day,coalesce(
      case when v_effective_sector is not null then (select o.daily_target from public.kpi_monthly_objectives o where o.month=date_trunc('month',d.day)::date and o.sector_key=v_effective_sector limit 1) end,
      (select x.target_value from public.kpi_daily_exit_objectives x where x.target_date=d.day limit 1),
      (select o.daily_target from public.kpi_monthly_objectives o where o.month=date_trunc('month',d.day)::date and o.sector_key='sortie_usine' limit 1)
    )::numeric base_target from days d
  ),
  latest_billed as (
    select b.file_sha256 from public.kpi_ops_import_batches b where b.source_key='billed_time' and b.status='imported'
    order by b.completed_at desc nulls last,b.created_at desc limit 1
  ),
  sector_reference as (
    select d.day,case when v_effective_sector is null then null else (
      select sum(f.labor_hours)::numeric/nullif(count(distinct f.work_order),0)
      from public.kpi_billed_time_facts f
      where f.sector_key=v_effective_sector
        and ((select file_sha256 from latest_billed) is null or f.source_file_sha256=(select file_sha256 from latest_billed))
        and nullif(trim(f.work_order),'') is not null
        and exists(select 1 from public.kpi_invoice_facts i where i.work_order=f.work_order and i.invoice_date between d.day-10 and d.day-1)
    ) end as avg_hours_per_vehicle from days d
  ),
  site_reference as (
    select d.day,
      (with ranked as (
        select s.snapshot_at,s.metrics,row_number() over(partition by s.snapshot_at order by case when s.source_name ilike 'FTP CRVO%' then 0 else 1 end,case when s.source_name ilike '%clôture%' then 0 else 1 end,s.source_name) rn
        from public.kpi_public_dashboard_snapshots s
        where s.snapshot_at between d.day-10 and d.day-1 and extract(isodow from s.snapshot_at) between 1 and 5
      ) select avg(nullif(metrics->>'exits_vop','')::numeric) from ranked where rn=1 and nullif(metrics->>'exits_vop','') is not null) as avg_exits,
      (with presence_daily as (
        select f.work_date,sum(f.time_value)::numeric/7.5 as available_etp
        from public.kpi_sql_presence_facts f join public.kpi_rh_presence_code_map m on m.time_code=f.time_code and m.counts_as_presence and not m.excluded
        where f.work_date between d.day-10 and d.day-1 and extract(isodow from f.work_date) between 1 and 5
          and m.sector_key in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo')
        group by f.work_date
      ) select avg(available_etp) from presence_daily where available_etp>0) as avg_available_etp
    from days d
  ),
  calc as (
    select a.*,g.global_productive_total,g.global_sector_total,o.base_target,sr.avg_hours_per_vehicle,site.avg_exits,site.avg_available_etp,
      greatest(a.total-a.unavailable,0)::int remaining,
      greatest(a.total-a.unavailable-a.pending_leave,0)::int remaining_if_accepted,
      greatest(a.productive_present-a.productive_pending,0)::int productive_remaining_if_accepted,
      case when coalesce(o.base_target,0)<=0 then 0::numeric
        when v_effective_sector is not null then o.base_target*a.productive_total::numeric/nullif(g.global_sector_total,0)
        else o.base_target*a.productive_total::numeric/nullif(g.global_productive_total,0) end as required_volume,
      case when v_effective_sector is not null and sr.avg_hours_per_vehicle>0 then greatest(a.productive_present-a.productive_pending,0)*7.5/sr.avg_hours_per_vehicle
        when v_effective_sector is null and site.avg_available_etp>0 and site.avg_exits is not null then greatest(a.productive_present-a.productive_pending,0)*site.avg_exits/site.avg_available_etp
        else null end as capacity_vehicles
    from selected_agg a join global_agg g using(day) join objectives o using(day) join sector_reference sr using(day) join site_reference site using(day)
  ),
  final as (
    select c.*,
      case when coalesce(c.required_volume,0)<=0 then 0 when coalesce(c.capacity_vehicles,0)<=0 then 100 else least(100,round(100*c.required_volume/c.capacity_vehicles,0)) end::numeric risk_pct,
      case when coalesce(c.required_volume,0)<=0 then 0 when coalesce(c.capacity_vehicles,0)<=0 then 999 else round(100*c.required_volume/c.capacity_vehicles,1) end::numeric load_pct
    from calc c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date',day,'weekend',extract(isodow from day) in (6,7),'total',total,'unavailable',unavailable,'approvedLeave',paid_leave,'pendingLeave',pending_leave,
    'remaining',remaining,'remainingIfAccepted',remaining_if_accepted,
    'remainingPct',case when total=0 then null else round(100.0*remaining/total,1) end,
    'remainingIfAcceptedPct',case when total=0 then null else round(100.0*remaining_if_accepted/total,1) end,
    'productiveTotal',productive_total,'productiveRemainingIfAccepted',productive_remaining_if_accepted,
    'requiredVolume',round(required_volume,1),'capacityVehicles',case when capacity_vehicles is null then null else round(capacity_vehicles,1) end,
    'loadPct',case when load_pct=999 then null else load_pct end,'riskPct',risk_pct,
    'risk',case when risk_pct>=90 then 'critical' when risk_pct>=70 then 'warning' else 'ok' end,
    'riskBasis',case when v_effective_sector is not null then 'activity' else 'site' end,
    'targetSource',case when v_effective_sector is not null then 'Objectif métier mensuel réparti au prorata de l’effectif du filtre' else 'Objectif Sortie usine journalier réparti au prorata de l’effectif productif du filtre' end,
    'capacityReferenceHours',case when avg_hours_per_vehicle is null then null else round(avg_hours_per_vehicle,3) end
  ) order by day),'[]'::jsonb) into v_calendar from final;

  v_base:=jsonb_set(v_base,'{people}',v_people,true);
  v_base:=jsonb_set(v_base,'{calendar}',v_calendar,true);
  v_base:=jsonb_set(v_base,'{volumeRisk}',jsonb_build_object(
    'enabled',true,'effectiveSector',v_effective_sector,
    'method','Risque capacitaire = charge théorique / capacité disponible. 70 % = à surveiller, 90 % = critique. Il s’agit d’un indice de tension, pas d’une probabilité statistique.'
  ),true);
  return v_base;
end
$$;

create or replace function public.kpi_worktime_leave_day_detail(p_session_hash text,p_date date,p_team text default null,p_sector text default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_scope record;
  v_day date:=coalesce(p_date,(now() at time zone 'Europe/Paris')::date);
  v_team text:=nullif(trim(coalesce(p_team,'')),'');
  v_sector text:=nullif(trim(coalesce(p_sector,'')),'');
  v_present jsonb:='[]'::jsonb;v_leave jsonb:='[]'::jsonb;v_other jsonb:='[]'::jsonb;v_pending jsonb:='[]'::jsonb;
begin
  if v_team='*' then v_team:=null; end if;if v_sector='*' then v_sector:=null; end if;
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if v_team is not null and not (v_scope.all_access or '*'=any(v_scope.team_codes) or v_team=any(v_scope.team_codes)) then raise exception 'Équipe hors périmètre.' using errcode='42501'; end if;
  if v_sector is not null and not (v_scope.all_access or '*'=any(v_scope.sector_keys) or v_sector=any(v_scope.sector_keys)) then raise exception 'Secteur hors périmètre.' using errcode='42501'; end if;

  with population as (
    select p.* from public.kpi_worktime_population_for_date(v_day) p
    where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
      and (v_team is null or p.team_code=v_team) and (v_sector is null or p.sector_key=v_sector)
  ), events as (
    select distinct p.employee_key,r.reason_code from population p join public.kpi_worktime_rh_event_source r
      on r.entity='CRVO' and r.event_kind='absence' and v_day between r.start_date and r.end_date
     and (r.employee_key=p.employee_key or public.kpi_normalize_person_name(r.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    union
    select distinct p.employee_key,e.reason_code from population p join public.kpi_worktime_events e
      on e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and v_day between e.start_date and e.end_date
     and (e.employee_key=p.employee_key or public.kpi_normalize_person_name(e.employee_name)=public.kpi_normalize_person_name(p.employee_name))
    union
    select distinct p.employee_key,'paid_leave'::text from population p join public.kpi_worktime_leave_requests l
      on l.entity='CRVO' and l.status='approved' and v_day between l.start_date and l.end_date
     and (l.employee_key=p.employee_key or public.kpi_normalize_person_name(l.employee_name)=public.kpi_normalize_person_name(p.employee_name))
  ), classified as (
    select p.*,coalesce(bool_or(e.reason_code in ('paid_leave','rtt_recovery')),false) is_leave,
      coalesce(bool_or(e.reason_code is not null),false) is_absent,string_agg(distinct e.reason_code,', ' order by e.reason_code) reasons
    from population p left join events e on e.employee_key=p.employee_key
    group by p.employee_key,p.employee_name,p.matricule,p.team_code,p.service,p.sector_key
  ), pending as (
    select distinct p.employee_key from population p join public.kpi_worktime_leave_requests l
      on l.entity='CRVO' and l.status='pending' and v_day between l.start_date and l.end_date
     and (l.employee_key=p.employee_key or public.kpi_normalize_person_name(l.employee_name)=public.kpi_normalize_person_name(p.employee_name))
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('employeeKey',employee_key,'name',employee_name,'matricule',matricule,'team',team_code,'service',service,'sector',sector_key) order by employee_name) filter(where not is_absent),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('employeeKey',employee_key,'name',employee_name,'matricule',matricule,'team',team_code,'service',service,'sector',sector_key,'reason',case when reasons like '%rtt_recovery%' and reasons not like '%paid_leave%' then 'RTT / récupération' else 'CP' end) order by employee_name) filter(where is_leave),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('employeeKey',employee_key,'name',employee_name,'matricule',matricule,'team',team_code,'service',service,'sector',sector_key,'reason',reasons) order by employee_name) filter(where is_absent and not is_leave),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('employeeKey',employee_key,'name',employee_name,'matricule',matricule,'team',team_code,'service',service,'sector',sector_key) order by employee_name) filter(where employee_key in (select employee_key from pending)),'[]'::jsonb)
  into v_present,v_leave,v_other,v_pending from classified;

  return jsonb_build_object('connected',true,'date',v_day,'team',v_team,'sector',v_sector,'present',v_present,'leave',v_leave,'otherAbsences',v_other,'pendingLeave',v_pending,
    'counts',jsonb_build_object('present',jsonb_array_length(v_present),'leave',jsonb_array_length(v_leave),'otherAbsences',jsonb_array_length(v_other),'pendingLeave',jsonb_array_length(v_pending)));
end
$$;

revoke all on function public.kpi_worktime_leave_dashboard_v2(text,date,date,text,text) from public;
revoke all on function public.kpi_worktime_leave_day_detail(text,date,text,text) from public;
grant execute on function public.kpi_worktime_leave_dashboard_v2(text,date,date,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_leave_day_detail(text,date,text,text) to anon,authenticated,service_role;
