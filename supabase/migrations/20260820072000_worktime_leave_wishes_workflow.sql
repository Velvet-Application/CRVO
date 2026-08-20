create table if not exists public.kpi_worktime_leave_requests (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO' check (entity in ('CRVO')),
  employee_key text not null,
  employee_name text not null,
  team_code text,
  service text,
  sector_key text,
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending','approved','refused','cancelled')),
  request_comment text,
  requested_by uuid not null references public.crvo_auth_users(id),
  requested_by_name text not null,
  requested_position_key text references public.kpi_worktime_org_positions(position_key),
  approver_position_key text references public.kpi_worktime_org_positions(position_key),
  submitted_at timestamptz not null default now(),
  decision_by uuid references public.crvo_auth_users(id),
  decision_by_name text,
  decision_position_key text references public.kpi_worktime_org_positions(position_key),
  decision_comment text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists kpi_worktime_leave_requests_period_idx on public.kpi_worktime_leave_requests(start_date,end_date,status);
create index if not exists kpi_worktime_leave_requests_scope_idx on public.kpi_worktime_leave_requests(team_code,sector_key,status,start_date);
create index if not exists kpi_worktime_leave_requests_employee_idx on public.kpi_worktime_leave_requests(employee_key,start_date,end_date,status);
create index if not exists kpi_worktime_leave_requests_approver_idx on public.kpi_worktime_leave_requests(approver_position_key,status,submitted_at desc);

create table if not exists public.kpi_worktime_leave_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.kpi_worktime_leave_requests(id) on delete cascade,
  action text not null,
  actor_id uuid references public.crvo_auth_users(id),
  actor_name text,
  actor_profile text,
  comment text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists kpi_worktime_leave_audit_request_idx on public.kpi_worktime_leave_audit(request_id,created_at desc);

create table if not exists public.kpi_worktime_leave_rules (
  entity text not null default 'CRVO',
  team_code text not null default '*',
  sector_key text not null default '*',
  warning_remaining_pct numeric(5,2) not null default 80,
  critical_remaining_pct numeric(5,2) not null default 70,
  updated_at timestamptz not null default now(),
  primary key(entity,team_code,sector_key),
  check (critical_remaining_pct >= 0 and critical_remaining_pct <= 100),
  check (warning_remaining_pct >= critical_remaining_pct and warning_remaining_pct <= 100)
);
insert into public.kpi_worktime_leave_rules(entity,team_code,sector_key,warning_remaining_pct,critical_remaining_pct)
values('CRVO','*','*',80,70)
on conflict(entity,team_code,sector_key) do nothing;

alter table public.kpi_worktime_leave_requests enable row level security;
alter table public.kpi_worktime_leave_audit enable row level security;
alter table public.kpi_worktime_leave_rules enable row level security;
revoke all on public.kpi_worktime_leave_requests from public,anon,authenticated;
revoke all on public.kpi_worktime_leave_audit from public,anon,authenticated;
revoke all on public.kpi_worktime_leave_rules from public,anon,authenticated;
grant select,insert,update,delete on public.kpi_worktime_leave_requests to service_role;
grant select,insert,update,delete on public.kpi_worktime_leave_audit to service_role;
grant select,insert,update,delete on public.kpi_worktime_leave_rules to service_role;
grant usage,select on sequence public.kpi_worktime_leave_audit_id_seq to service_role;

create or replace function public.kpi_worktime_position_is_ancestor(p_ancestor text,p_descendant text)
returns boolean language sql stable security definer set search_path='public' as $$
with recursive chain as (
  select p.position_key,p.parent_position_key from public.kpi_worktime_org_positions p where p.position_key=p_descendant and p.active
  union all
  select p.position_key,p.parent_position_key from public.kpi_worktime_org_positions p join chain c on c.parent_position_key=p.position_key where p.active
)
select coalesce(p_ancestor in (select position_key from chain),false)
$$;

create or replace function public.kpi_worktime_leave_dashboard(p_session_hash text,p_from date,p_to date,p_team text default null,p_sector text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  v_user public.crvo_auth_users%rowtype; v_scope record; v_position public.kpi_worktime_org_positions%rowtype;
  v_from date:=coalesce(p_from,(now() at time zone 'Europe/Paris')::date); v_to date:=coalesce(p_to,v_from);
  v_team text:=nullif(trim(coalesce(p_team,'')),''); v_sector text:=nullif(trim(coalesce(p_sector,'')),'');
  v_people jsonb; v_requests jsonb; v_calendar jsonb; v_compare jsonb:='[]'::jsonb; v_teams jsonb; v_sectors jsonb; v_summary jsonb;
  v_warning numeric:=80; v_critical numeric:=70; v_can_request boolean:=false; v_can_decide boolean:=false; v_prod boolean:=false;
begin
  if v_to<v_from or v_to-v_from>62 then raise exception 'Période invalide (63 jours maximum).' using errcode='22023'; end if;
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if v_scope.position_key is not null then select * into v_position from public.kpi_worktime_org_positions where position_key=v_scope.position_key and active; end if;
  v_can_request := (coalesce(v_scope.level_code,'')='team_leader' or v_user.role='admin');
  v_can_decide := (coalesce(v_scope.level_code,'') in ('supervisor','industrial_manager') or v_user.access_profile='service_manager' or v_user.role='admin');
  if v_team='*' then v_team:=null; end if; if v_sector='*' then v_sector:=null; end if;
  if v_team is not null and not (v_scope.all_access or '*'=any(v_scope.team_codes) or v_team=any(v_scope.team_codes)) then raise exception 'Équipe hors périmètre.' using errcode='42501'; end if;
  if v_sector is not null and not (v_scope.all_access or '*'=any(v_scope.sector_keys) or v_sector=any(v_scope.sector_keys)) then raise exception 'Secteur hors périmètre.' using errcode='42501'; end if;
  select warning_remaining_pct,critical_remaining_pct into v_warning,v_critical from public.kpi_worktime_leave_rules
  where entity='CRVO' and team_code in (coalesce(v_team,'*'),'*') and sector_key in (coalesce(v_sector,'*'),'*')
  order by (team_code<>'*') desc,(sector_key<>'*') desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('employeeKey',d.employee_key,'name',d.full_name,'matricule',d.matricule,'team',d.team_code,'service',d.service,'sector',m.sector_key,'jobTitle',d.job_title) order by d.full_name),'[]'::jsonb) into v_people
  from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service
  where d.active and (v_scope.all_access or '*'=any(v_scope.team_codes) or d.team_code=any(v_scope.team_codes))
    and (v_scope.all_access or '*'=any(v_scope.sector_keys) or m.sector_key=any(v_scope.sector_keys))
    and (v_team is null or d.team_code=v_team) and (v_sector is null or m.sector_key=v_sector);

  select coalesce(jsonb_agg(to_jsonb(q) order by q.start_date,q.employee_name),'[]'::jsonb) into v_requests from (
    select r.id,r.employee_key as "employeeKey",r.employee_name as "employeeName",r.team_code as team,r.service,r.sector_key as sector,
      r.start_date as "startDate",r.end_date as "endDate",r.status,r.request_comment as "requestComment",r.requested_by_name as "requestedBy",
      r.requested_position_key as "requestedPositionKey",r.approver_position_key as "approverPositionKey",r.submitted_at as "submittedAt",
      r.decision_by_name as "decisionBy",r.decision_position_key as "decisionPositionKey",r.decision_comment as "decisionComment",r.decided_at as "decidedAt",
      case when v_user.role='admin' or v_user.access_profile='service_manager' then true
        when coalesce(v_scope.level_code,'')='supervisor' and v_scope.position_key is not null then public.kpi_worktime_position_is_ancestor(v_scope.position_key,r.approver_position_key)
        when coalesce(v_scope.level_code,'')='industrial_manager' and v_scope.position_key is not null then public.kpi_worktime_position_is_ancestor(v_scope.position_key,r.approver_position_key)
        else false end as "canDecide"
    from public.kpi_worktime_leave_requests r
    where r.entity='CRVO' and r.status<>'cancelled' and r.start_date<=v_to and r.end_date>=v_from
      and (v_scope.all_access or '*'=any(v_scope.team_codes) or r.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or r.sector_key=any(v_scope.sector_keys))
      and (v_team is null or r.team_code=v_team) and (v_sector is null or r.sector_key=v_sector)
  ) q;

  with days as (select gs::date as day from generate_series(v_from,v_to,interval '1 day') gs),
  population as (
    select d.day,p.employee_key,p.team_code,p.sector_key from days d cross join lateral public.kpi_worktime_population_for_date(d.day) p
    where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
      and (v_team is null or p.team_code=v_team) and (v_sector is null or p.sector_key=v_sector)
  ), unavailable_raw as (
    select d.day,r.employee_key from days d join public.kpi_worktime_rh_event_source r on r.entity='CRVO' and r.event_kind='absence' and d.day between r.start_date and r.end_date
    union all select d.day,e.employee_key from days d join public.kpi_worktime_events e on e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and d.day between e.start_date and e.end_date
    union all select d.day,l.employee_key from days d join public.kpi_worktime_leave_requests l on l.entity='CRVO' and l.status='approved' and d.day between l.start_date and l.end_date
  ), unavailable as (select distinct u.day,u.employee_key from unavailable_raw u join population p on p.day=u.day and p.employee_key=u.employee_key),
  paid_raw as (
    select d.day,r.employee_key from days d join public.kpi_worktime_rh_event_source r on r.entity='CRVO' and r.event_kind='absence' and r.reason_code='paid_leave' and d.day between r.start_date and r.end_date
    union all select d.day,e.employee_key from days d join public.kpi_worktime_events e on e.entity='CRVO' and e.event_kind='absence' and e.reason_code='paid_leave' and e.status<>'cancelled' and d.day between e.start_date and e.end_date
    union all select d.day,l.employee_key from days d join public.kpi_worktime_leave_requests l on l.entity='CRVO' and l.status='approved' and d.day between l.start_date and l.end_date
  ), paid as (select distinct u.day,u.employee_key from paid_raw u join population p on p.day=u.day and p.employee_key=u.employee_key),
  pending as (
    select distinct d.day,l.employee_key from days d join public.kpi_worktime_leave_requests l on l.entity='CRVO' and l.status='pending' and d.day between l.start_date and l.end_date
    join population p on p.day=d.day and p.employee_key=l.employee_key where not exists(select 1 from unavailable u where u.day=d.day and u.employee_key=l.employee_key)
  ), agg as (
    select d.day,count(distinct p.employee_key)::int total,count(distinct u.employee_key)::int unavailable,count(distinct pl.employee_key)::int paid_leave,count(distinct pe.employee_key)::int pending_leave
    from days d left join population p on p.day=d.day left join unavailable u on u.day=d.day and u.employee_key=p.employee_key
    left join paid pl on pl.day=d.day and pl.employee_key=p.employee_key left join pending pe on pe.day=d.day and pe.employee_key=p.employee_key group by d.day
  )
  select coalesce(jsonb_agg(jsonb_build_object('date',day,'weekend',extract(isodow from day) in (6,7),'total',total,'unavailable',unavailable,'approvedLeave',paid_leave,'pendingLeave',pending_leave,
    'remaining',greatest(total-unavailable,0),'remainingIfAccepted',greatest(total-unavailable-pending_leave,0),
    'remainingPct',case when total=0 then null else round(100.0*greatest(total-unavailable,0)/total,1) end,
    'remainingIfAcceptedPct',case when total=0 then null else round(100.0*greatest(total-unavailable-pending_leave,0)/total,1) end,
    'risk',case when total=0 then 'unknown' when 100.0*greatest(total-unavailable-pending_leave,0)/total < v_critical then 'critical' when 100.0*greatest(total-unavailable-pending_leave,0)/total < v_warning then 'warning' else 'ok' end) order by day),'[]'::jsonb) into v_calendar from agg;

  v_prod := v_sector in ('expertise','mecanique','dsp','carrosserie','preparation','qualite','jantes');
  if v_prod then
    with days as (select gs::date as day from generate_series(v_from,v_to,interval '1 day') gs), shifts(team_code) as (values('A'::text),('B'::text),('C'::text)),
    population as (select d.day,s.team_code,p.employee_key from days d cross join shifts s cross join lateral public.kpi_worktime_population_for_date(d.day) p where p.team_code=s.team_code and p.sector_key=v_sector),
    unavailable_raw as (
      select d.day,r.employee_key from days d join public.kpi_worktime_rh_event_source r on r.entity='CRVO' and r.event_kind='absence' and d.day between r.start_date and r.end_date
      union all select d.day,e.employee_key from days d join public.kpi_worktime_events e on e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and d.day between e.start_date and e.end_date
      union all select d.day,l.employee_key from days d join public.kpi_worktime_leave_requests l on l.entity='CRVO' and l.status='approved' and d.day between l.start_date and l.end_date
    ), unavailable as (select distinct p.day,p.team_code,p.employee_key from population p join unavailable_raw u on u.day=p.day and u.employee_key=p.employee_key),
    pending as (select distinct p.day,p.team_code,p.employee_key from population p join public.kpi_worktime_leave_requests l on l.entity='CRVO' and l.status='pending' and l.employee_key=p.employee_key and p.day between l.start_date and l.end_date where not exists(select 1 from unavailable u where u.day=p.day and u.employee_key=p.employee_key)),
    agg as (select d.day,s.team_code,count(distinct p.employee_key)::int total,count(distinct u.employee_key)::int unavailable,count(distinct pe.employee_key)::int pending from days d cross join shifts s left join population p on p.day=d.day and p.team_code=s.team_code left join unavailable u on u.day=d.day and u.team_code=s.team_code and u.employee_key=p.employee_key left join pending pe on pe.day=d.day and pe.team_code=s.team_code and pe.employee_key=p.employee_key group by d.day,s.team_code)
    select coalesce(jsonb_agg(jsonb_build_object('date',day,'team',team_code,'total',total,'unavailable',unavailable,'pendingLeave',pending,'remaining',greatest(total-unavailable,0),'remainingIfAccepted',greatest(total-unavailable-pending,0),'remainingIfAcceptedPct',case when total=0 then null else round(100.0*greatest(total-unavailable-pending,0)/total,1) end,'risk',case when total=0 then 'unknown' when 100.0*greatest(total-unavailable-pending,0)/total < v_critical then 'critical' when 100.0*greatest(total-unavailable-pending,0)/total < v_warning then 'warning' else 'ok' end) order by day,team_code),'[]'::jsonb) into v_compare from agg;
  end if;

  select coalesce(jsonb_agg(x.team order by x.team),'[]'::jsonb) into v_teams from (select distinct d.team_code as team from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service where d.active and d.team_code is not null and (v_scope.all_access or '*'=any(v_scope.team_codes) or d.team_code=any(v_scope.team_codes)) and (v_scope.all_access or '*'=any(v_scope.sector_keys) or m.sector_key=any(v_scope.sector_keys))) x;
  select coalesce(jsonb_agg(x.sector order by x.sector),'[]'::jsonb) into v_sectors from (select distinct m.sector_key as sector from public.kpi_rh_staff_dimension d join public.kpi_worktime_service_sector_map m on m.service_code=d.service where d.active and m.sector_key is not null and (v_scope.all_access or '*'=any(v_scope.team_codes) or d.team_code=any(v_scope.team_codes)) and (v_scope.all_access or '*'=any(v_scope.sector_keys) or m.sector_key=any(v_scope.sector_keys))) x;
  select jsonb_build_object('pending',count(*) filter(where status='pending'),'approved',count(*) filter(where status='approved'),'refused',count(*) filter(where status='refused')) into v_summary from public.kpi_worktime_leave_requests r where r.entity='CRVO' and r.start_date<=v_to and r.end_date>=v_from and (v_scope.all_access or '*'=any(v_scope.team_codes) or r.team_code=any(v_scope.team_codes)) and (v_scope.all_access or '*'=any(v_scope.sector_keys) or r.sector_key=any(v_scope.sector_keys)) and (v_team is null or r.team_code=v_team) and (v_sector is null or r.sector_key=v_sector);
  return jsonb_build_object('connected',true,'from',v_from,'to',v_to,'team',v_team,'sector',v_sector,'people',v_people,'requests',v_requests,'calendar',v_calendar,'shiftComparison',v_compare,'teamOptions',v_teams,'sectorOptions',v_sectors,'summary',v_summary,'rules',jsonb_build_object('warningRemainingPct',v_warning,'criticalRemainingPct',v_critical),'access',jsonb_build_object('role',v_user.role,'profile',v_user.access_profile,'level',v_scope.level_code,'positionKey',v_scope.position_key,'canRequest',v_can_request,'canDecide',v_can_decide,'teams',v_scope.team_codes,'sectors',v_scope.sector_keys),'organization',case when v_position.position_key is null then null else jsonb_build_object('positionKey',v_position.position_key,'name',v_position.person_name,'title',v_position.title,'parent',v_position.parent_position_key,'teams',v_position.team_codes,'sectors',v_position.sector_keys) end);
end $$;

create or replace function public.kpi_worktime_leave_submit(p_session_hash text,p_employee_key text,p_start date,p_end date,p_comment text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_scope record; v_position public.kpi_worktime_org_positions%rowtype; v_name text; v_team text; v_service text; v_sector text; v_approver text; v_id uuid;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if not (coalesce(v_scope.level_code,'')='team_leader' or v_user.role='admin') then raise exception 'Saisie réservée au chef d’équipe.' using errcode='42501'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then raise exception 'Période invalide.' using errcode='22023'; end if;
  select d.full_name,d.team_code,d.service,m.sector_key into v_name,v_team,v_service,v_sector from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service where d.active and d.employee_key=p_employee_key limit 1;
  if v_name is null then raise exception 'Collaborateur introuvable.' using errcode='22023'; end if;
  if not (v_scope.all_access or '*'=any(v_scope.team_codes) or v_team=any(v_scope.team_codes)) then raise exception 'Collaborateur hors équipe.' using errcode='42501'; end if;
  if not (v_scope.all_access or '*'=any(v_scope.sector_keys) or v_sector=any(v_scope.sector_keys)) then raise exception 'Collaborateur hors secteur.' using errcode='42501'; end if;
  if exists(select 1 from public.kpi_worktime_leave_requests l where l.entity='CRVO' and l.employee_key=p_employee_key and l.status in ('pending','approved') and l.start_date<=p_end and l.end_date>=p_start) then raise exception 'Un souhait de CP existe déjà sur cette période.' using errcode='23505'; end if;
  if exists(select 1 from public.kpi_worktime_rh_event_source r where r.entity='CRVO' and r.employee_key=p_employee_key and r.event_kind='absence' and r.start_date<=p_end and r.end_date>=p_start) then raise exception 'Une absence Data RH existe déjà sur cette période.' using errcode='23505'; end if;
  if exists(select 1 from public.kpi_worktime_events e where e.entity='CRVO' and e.employee_key=p_employee_key and e.event_kind='absence' and e.status<>'cancelled' and e.start_date<=p_end and e.end_date>=p_start) then raise exception 'Une absence est déjà déclarée sur cette période.' using errcode='23505'; end if;
  if v_scope.position_key is not null then select * into v_position from public.kpi_worktime_org_positions where position_key=v_scope.position_key and active; v_approver:=v_position.parent_position_key; end if;
  if v_user.role<>'admin' and v_approver is null then raise exception 'N+1 non configuré dans l’organigramme.' using errcode='22023'; end if;
  insert into public.kpi_worktime_leave_requests(employee_key,employee_name,team_code,service,sector_key,start_date,end_date,request_comment,requested_by,requested_by_name,requested_position_key,approver_position_key)
  values(p_employee_key,v_name,v_team,v_service,v_sector,p_start,p_end,nullif(trim(coalesce(p_comment,'')),''),v_user.id,v_user.display_name,v_scope.position_key,v_approver) returning id into v_id;
  insert into public.kpi_worktime_leave_audit(request_id,action,actor_id,actor_name,actor_profile,comment,snapshot) select v_id,'submitted',v_user.id,v_user.display_name,coalesce(v_scope.position_key,v_user.access_profile),nullif(trim(coalesce(p_comment,'')),''),to_jsonb(r) from public.kpi_worktime_leave_requests r where r.id=v_id;
  insert into public.kpi_notifications(kind,severity,entity,work_date,position_key,team_code,sector_key,source_key,title,message,metadata)
  values('leave_request','warning','CRVO',p_start,v_approver,v_team,v_sector,'leave:'||v_id::text||':submitted','Souhait de CP à valider',v_name||' · du '||to_char(p_start,'DD/MM/YYYY')||' au '||to_char(p_end,'DD/MM/YYYY'),jsonb_build_object('path','/temps-travail/conges','requestId',v_id,'employeeKey',p_employee_key)) on conflict(source_key) do nothing;
  return jsonb_build_object('ok',true,'id',v_id,'status','pending','approverPositionKey',v_approver);
end $$;

create or replace function public.kpi_worktime_leave_decide(p_session_hash text,p_request_id uuid,p_decision text,p_comment text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_scope record; v_request public.kpi_worktime_leave_requests%rowtype; v_status text; v_allowed boolean:=false;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  select * into v_request from public.kpi_worktime_leave_requests where id=p_request_id for update;
  if v_request.id is null then raise exception 'Demande introuvable.' using errcode='22023'; end if;
  if v_request.status<>'pending' then raise exception 'Cette demande est déjà traitée.' using errcode='22023'; end if;
  if lower(p_decision) not in ('approve','refuse') then raise exception 'Décision invalide.' using errcode='22023'; end if;
  if lower(p_decision)='refuse' and nullif(trim(coalesce(p_comment,'')),'') is null then raise exception 'Un commentaire est requis pour un refus.' using errcode='22023'; end if;
  v_allowed := v_user.role='admin' or v_user.access_profile='service_manager';
  if not v_allowed and coalesce(v_scope.level_code,'') in ('supervisor','industrial_manager') and v_scope.position_key is not null then v_allowed := public.kpi_worktime_position_is_ancestor(v_scope.position_key,v_request.approver_position_key); end if;
  if not v_allowed then raise exception 'Validation réservée au superviseur ou au chef de service.' using errcode='42501'; end if;
  v_status:=case when lower(p_decision)='approve' then 'approved' else 'refused' end;
  update public.kpi_worktime_leave_requests set status=v_status,decision_by=v_user.id,decision_by_name=v_user.display_name,decision_position_key=v_scope.position_key,decision_comment=nullif(trim(coalesce(p_comment,'')),''),decided_at=now(),updated_at=now() where id=p_request_id;
  insert into public.kpi_worktime_leave_audit(request_id,action,actor_id,actor_name,actor_profile,comment,snapshot) select p_request_id,v_status,v_user.id,v_user.display_name,coalesce(v_scope.position_key,v_user.access_profile),nullif(trim(coalesce(p_comment,'')),''),to_jsonb(r) from public.kpi_worktime_leave_requests r where r.id=p_request_id;
  update public.kpi_notifications set resolved_at=coalesce(resolved_at,now()) where source_key='leave:'||p_request_id::text||':submitted';
  insert into public.kpi_notifications(kind,severity,entity,work_date,audience_user_id,team_code,sector_key,source_key,title,message,metadata)
  values('leave_request',case when v_status='approved' then 'info' else 'warning' end,'CRVO',v_request.start_date,v_request.requested_by,v_request.team_code,v_request.sector_key,'leave:'||p_request_id::text||':decision:'||v_status,case when v_status='approved' then 'Souhait de CP accepté' else 'Souhait de CP refusé' end,v_request.employee_name||' · du '||to_char(v_request.start_date,'DD/MM/YYYY')||' au '||to_char(v_request.end_date,'DD/MM/YYYY')||coalesce(' · '||nullif(trim(coalesce(p_comment,'')),''),''),jsonb_build_object('path','/temps-travail/conges','requestId',p_request_id,'status',v_status)) on conflict(source_key) do nothing;
  return jsonb_build_object('ok',true,'id',p_request_id,'status',v_status);
end $$;

insert into public.kpi_worktime_user_position(user_id,position_key,assigned_by)
select u.id,'crvo_industrial_piasecki',null from public.crvo_auth_users u where u.username='piasecki' and u.is_active
on conflict(user_id) do update set position_key=excluded.position_key,assigned_at=now(),assigned_by=excluded.assigned_by;

revoke all on function public.kpi_worktime_position_is_ancestor(text,text) from public;
revoke all on function public.kpi_worktime_leave_dashboard(text,date,date,text,text) from public;
revoke all on function public.kpi_worktime_leave_submit(text,text,date,date,text) from public;
revoke all on function public.kpi_worktime_leave_decide(text,uuid,text,text) from public;
grant execute on function public.kpi_worktime_position_is_ancestor(text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_leave_dashboard(text,date,date,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_leave_submit(text,text,date,date,text) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_leave_decide(text,uuid,text,text) to anon,authenticated,service_role;
