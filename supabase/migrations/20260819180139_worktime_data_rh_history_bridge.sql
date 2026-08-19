-- Bridge the certified Data RH history into Temps de travail without duplicating source data.
-- Data RH remains authoritative; the Worktime UI consumes a derived read model.

create or replace view public.kpi_worktime_rh_event_source as
with staff_latest as (
  select distinct on (d.name_key)
    d.name_key,
    d.employee_key,
    d.full_name,
    d.team_code,
    d.service,
    d.active,
    d.source_updated_at,
    d.entry_date,
    d.exit_date
  from public.kpi_rh_staff_dimension d
  where d.name_key is not null
  order by d.name_key,
    d.active desc,
    d.source_updated_at desc nulls last,
    d.entry_date desc nulls last
),
rh as (
  select
    f.work_date,
    f.person_name_key,
    f.time_code,
    max(f.time_description) as time_description,
    round(sum(coalesce(f.time_value,0))::numeric,2) as duration_hours,
    max(f.mechanic_name) as mechanic_name,
    max(f.source_synced_at) as source_synced_at
  from public.kpi_sql_presence_facts f
  where f.source_name='Direct Data RH'
    and f.time_code in (
      'A11','A3','A72','A6','A71','A13','A33','A2','A32','A41','A7','A1','VM','A4','A10','A21','A30','A12','A18','A19'
    )
    and coalesce(f.time_value,0)>0
  group by f.work_date,f.person_name_key,f.time_code
)
select
  'rh:'||md5(concat_ws('|',r.work_date::text,r.person_name_key,r.time_code)) as source_id,
  'CRVO'::text as entity,
  s.employee_key,
  coalesce(s.full_name,r.mechanic_name) as employee_name,
  s.team_code,
  s.service,
  m.sector_key,
  case when r.time_code in ('A12','A18') then 'late'
       when r.time_code='A19' then 'early_departure'
       else 'absence' end::text as event_kind,
  case r.time_code
    when 'A11' then 'paid_leave'
    when 'A3' then 'sick_received'
    when 'A72' then 'long_absence'
    when 'A6' then 'work_accident'
    when 'A71' then 'parental_leave'
    when 'A13' then 'unjustified'
    when 'A21' then 'unjustified'
    when 'A33' then 'training'
    when 'A2' then 'authorized_unpaid'
    when 'A32' then 'rtt_recovery'
    when 'A4' then 'rtt_recovery'
    when 'A41' then 'unpaid_leave'
    when 'A7' then 'family_leave'
    when 'A1' then 'authorized_paid'
    when 'VM' then 'medical_visit'
    when 'A10' then 'pending_qualification'
    when 'A30' then 'therapeutic_part_time'
    when 'A12' then 'late'
    when 'A18' then 'late_night'
    when 'A19' then 'early_departure_night'
    else 'other' end::text as reason_code,
  r.work_date as start_date,
  r.work_date as end_date,
  null::time as event_time,
  r.duration_hours,
  case when r.time_code in ('A3','A6','A72') then 'received'
       when r.time_code='A10' then 'pending'
       else 'not_required' end::text as justification_status,
  concat(r.time_description,' · ',trim(to_char(r.duration_hours,'FM999990D00')),' h issues de Data RH')::text as comment,
  case when r.work_date < (now() at time zone 'Europe/Paris')::date then 'closed' else 'open' end::text as status,
  'Data RH · automatique'::text as created_by_name,
  coalesce(r.source_synced_at,now()) as created_at,
  case when r.work_date < (now() at time zone 'Europe/Paris')::date then 'Data RH' else null end::text as closed_by_name,
  case when r.work_date < (now() at time zone 'Europe/Paris')::date then coalesce(r.source_synced_at,now()) else null end::timestamptz as closed_at,
  'data_rh'::text as source_type
from rh r
join staff_latest s on s.name_key=r.person_name_key
left join public.kpi_worktime_service_sector_map m on m.service_code=s.service;

create index if not exists kpi_presence_workdate_person_code_idx
on public.kpi_sql_presence_facts(work_date,person_name_key,time_code)
include(time_value,time_description,source_synced_at)
where source_name='Direct Data RH';

create or replace function public.kpi_worktime_dashboard(p_session_hash text, p_entity text default 'CRVO'::text, p_from date default current_date, p_to date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user public.crvo_auth_users%rowtype; v_entity text:=upper(coalesce(p_entity,'CRVO')); v_from date:=coalesce(p_from,(now() at time zone 'Europe/Paris')::date); v_to date:=coalesce(p_to,v_from);
  v_all boolean:=false; v_can_close boolean:=false; v_can_config boolean:=false; v_teams text[]:=array[]::text[]; v_sectors text[]:=array[]::text[]; v_level text; v_position text; v_shift_group text;
  v_people jsonb; v_events jsonb; v_shifts jsonb; v_today date:=(now() at time zone 'Europe/Paris')::date;
  v_absent_today integer:=0; v_late_today integer:=0; v_early_today integer:=0; v_pending integer:=0; v_open integer:=0;
begin
  if v_to<v_from or v_to-v_from>366 then raise exception 'Période invalide.' using errcode='22023'; end if;
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select s.all_access,s.team_codes,s.sector_keys,s.can_close,s.can_config,s.level_code,s.position_key into v_all,v_teams,v_sectors,v_can_close,v_can_config,v_level,v_position from public.kpi_worktime_scope_for_user(v_user.id,v_entity) s limit 1;
  if v_teams is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if v_entity not in ('CRVO','TRANSPHERE') then raise exception 'Entité invalide.' using errcode='22023'; end if;
  if v_position is not null then select shift_group into v_shift_group from public.kpi_worktime_org_positions where position_key=v_position; end if;

  if v_entity='CRVO' then
    select coalesce(jsonb_agg(jsonb_build_object('employeeKey',d.employee_key,'matricule',d.matricule,'name',d.full_name,'team',d.team_code,'service',d.service,'jobTitle',d.job_title,'sector',m.sector_key) order by d.full_name),'[]'::jsonb) into v_people
    from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service
    where d.active is true
      and (v_all or '*'=any(v_teams) or d.team_code=any(v_teams))
      and (v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors));
  else
    select coalesce(jsonb_agg(jsonb_build_object('employeeKey',p.employee_key,'matricule',null,'name',p.full_name,'team',p.team_code,'service',p.service,'jobTitle',null,'sector','transphere') order by p.full_name),'[]'::jsonb) into v_people
    from public.kpi_worktime_people p where p.active is true and (v_all or '*'=any(v_teams) or p.team_code=any(v_teams));
  end if;

  with manual_events as (
    select e.id::text id,e.entity,e.employee_key,e.employee_name,e.team_code,e.service,m.sector_key,e.event_kind,e.reason_code,e.start_date,e.end_date,e.event_time,null::numeric duration_hours,e.justification_status,e.comment,e.status,e.created_by_name,e.created_at,e.closed_by_name,e.closed_at,'manual'::text source_type
    from public.kpi_worktime_events e
    left join public.kpi_worktime_service_sector_map m on m.service_code=e.service
    where e.entity=v_entity and e.status<>'cancelled' and e.start_date<=v_to and e.end_date>=v_from
      and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))
      and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors))
  ),
  rh_events as (
    select r.source_id id,r.entity,r.employee_key,r.employee_name,r.team_code,r.service,r.sector_key,r.event_kind,r.reason_code,r.start_date,r.end_date,r.event_time,r.duration_hours,r.justification_status,r.comment,r.status,r.created_by_name,r.created_at,r.closed_by_name,r.closed_at,r.source_type
    from public.kpi_worktime_rh_event_source r
    where v_entity='CRVO' and r.start_date between v_from and v_to
      and (v_all or '*'=any(v_teams) or r.team_code=any(v_teams))
      and (v_all or '*'=any(v_sectors) or r.sector_key=any(v_sectors))
      and not exists (
        select 1 from public.kpi_worktime_events e
        where e.entity='CRVO' and e.status<>'cancelled' and e.employee_key=r.employee_key and e.event_kind=r.event_kind and r.start_date between e.start_date and e.end_date
      )
  ), all_events as (
    select * from manual_events union all select * from rh_events
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'entity',a.entity,'employeeKey',a.employee_key,'employeeName',a.employee_name,'team',a.team_code,'service',a.service,'sector',a.sector_key,
    'kind',a.event_kind,'reason',a.reason_code,'startDate',a.start_date,'endDate',a.end_date,
    'eventTime',case when a.event_time is null then null else to_char(a.event_time,'HH24:MI') end,
    'durationHours',a.duration_hours,'justification',a.justification_status,'comment',a.comment,'status',a.status,
    'createdBy',a.created_by_name,'createdAt',a.created_at,'closedBy',a.closed_by_name,'closedAt',a.closed_at,'source',a.source_type
  ) order by a.start_date desc,a.employee_name),'[]'::jsonb) into v_events
  from all_events a;

  with manual_today as (
    select e.event_kind,e.justification_status,e.status,e.employee_key
    from public.kpi_worktime_events e
    left join public.kpi_worktime_service_sector_map m on m.service_code=e.service
    where e.entity=v_entity and e.status<>'cancelled' and v_today between e.start_date and e.end_date
      and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))
      and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors))
  ), rh_today as (
    select r.event_kind,r.justification_status,r.status,r.employee_key
    from public.kpi_worktime_rh_event_source r
    where v_entity='CRVO' and r.start_date=v_today
      and (v_all or '*'=any(v_teams) or r.team_code=any(v_teams))
      and (v_all or '*'=any(v_sectors) or r.sector_key=any(v_sectors))
      and not exists (
        select 1 from public.kpi_worktime_events e
        where e.entity='CRVO' and e.status<>'cancelled' and e.employee_key=r.employee_key and e.event_kind=r.event_kind and r.start_date between e.start_date and e.end_date
      )
  ), all_today as (
    select * from manual_today union all select * from rh_today
  )
  select
    count(distinct employee_key) filter(where event_kind='absence' and status='open'),
    count(distinct employee_key) filter(where event_kind='late' and status='open'),
    count(distinct employee_key) filter(where event_kind='early_departure' and status='open'),
    count(*) filter(where status='open' and justification_status='pending'),
    count(*) filter(where status='open')
  into v_absent_today,v_late_today,v_early_today,v_pending,v_open
  from all_today;

  select coalesce(jsonb_agg(jsonb_build_object(
    'team',s.team_code,'label',s.label,'rotationMode',s.rotation_mode,
    'startTime',case when s.start_time is null then null else to_char(s.start_time,'HH24:MI') end,
    'endTime',case when s.end_time is null then null else to_char(s.end_time,'HH24:MI') end,
    'breakStart',case when s.break_start is null then null else to_char(s.break_start,'HH24:MI') end,
    'breakEnd',case when s.break_end is null then null else to_char(s.break_end,'HH24:MI') end,
    'alternateStartTime',case when s.alternate_start_time is null then null else to_char(s.alternate_start_time,'HH24:MI') end,
    'alternateEndTime',case when s.alternate_end_time is null then null else to_char(s.alternate_end_time,'HH24:MI') end,
    'rotationAnchorMonday',s.rotation_anchor_monday,'rotationAnchorPrimary',s.rotation_anchor_primary,
    'rotationPending',(s.rotation_mode='weekly_alternate' and s.rotation_anchor_monday is null),
    'currentStartTime',case when s.rotation_mode='fixed' then case when s.start_time is null then null else to_char(s.start_time,'HH24:MI') end when s.rotation_anchor_monday is null then null when (floor((v_today-s.rotation_anchor_monday)::numeric/7)::int % 2 = 0) = s.rotation_anchor_primary then to_char(s.start_time,'HH24:MI') else to_char(s.alternate_start_time,'HH24:MI') end,
    'currentEndTime',case when s.rotation_mode='fixed' then case when s.end_time is null then null else to_char(s.end_time,'HH24:MI') end when s.rotation_anchor_monday is null then null when (floor((v_today-s.rotation_anchor_monday)::numeric/7)::int % 2 = 0) = s.rotation_anchor_primary then to_char(s.end_time,'HH24:MI') else to_char(s.alternate_end_time,'HH24:MI') end
  ) order by s.team_code),'[]'::jsonb) into v_shifts
  from public.kpi_worktime_shift_config s
  where s.entity=v_entity and s.active and (
    v_all or v_shift_group is null and ('*'=any(v_teams) or s.team_code=any(v_teams)) or v_shift_group='AB' and s.team_code in ('A','B') or v_shift_group in ('A','B','C','J','TRANSPHERE') and s.team_code=v_shift_group
  );

  return jsonb_build_object('connected',true,'entity',v_entity,'from',v_from,'to',v_to,'people',v_people,'events',v_events,'shifts',v_shifts,
    'organization',case when v_position is null then null else (select jsonb_build_object('positionKey',p.position_key,'name',p.person_name,'title',p.title,'level',p.level_code,'parent',p.parent_position_key,'teams',p.team_codes,'sectors',p.sector_keys,'shiftGroup',p.shift_group) from public.kpi_worktime_org_positions p where p.position_key=v_position) end,
    'access',jsonb_build_object('profile',v_user.access_profile,'role',v_user.role,'teams',v_teams,'sectors',v_sectors,'canClose',v_can_close,'canConfigure',v_can_config,'canManagePeople',v_can_config,'level',v_level,'positionKey',v_position),
    'summary',jsonb_build_object('absentToday',coalesce(v_absent_today,0),'lateToday',coalesce(v_late_today,0),'earlyToday',coalesce(v_early_today,0),'pendingJustifications',coalesce(v_pending,0),'openEvents',coalesce(v_open,0))
  );
end $function$;

grant select on public.kpi_worktime_rh_event_source to service_role;
grant execute on function public.kpi_worktime_dashboard(text,text,date,date) to anon,authenticated,service_role;
