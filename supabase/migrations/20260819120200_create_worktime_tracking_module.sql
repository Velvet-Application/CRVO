-- Suivi du temps de travail - CRVO / Transphere
-- Production migration applied on 2026-08-19.

alter table public.crvo_auth_users drop constraint if exists crvo_auth_users_access_profile_chk;
alter table public.crvo_auth_users add constraint crvo_auth_users_access_profile_chk check (access_profile = any (array['admin','service_manager','team_manager','custom','transphere','transphere_manager','hr']::text[]));

create table if not exists public.kpi_worktime_shift_config (
  entity text not null check (entity in ('CRVO','TRANSPHERE')),
  team_code text not null,
  label text not null,
  start_time time null,
  end_time time null,
  active boolean not null default true,
  updated_by uuid null references public.crvo_auth_users(id),
  updated_at timestamptz not null default now(),
  primary key(entity,team_code)
);

create table if not exists public.kpi_worktime_people (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('TRANSPHERE')),
  employee_key text not null,
  full_name text not null,
  team_code text not null default 'TRANSPHERE',
  service text null,
  active boolean not null default true,
  created_by uuid null references public.crvo_auth_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity,employee_key)
);

create table if not exists public.kpi_worktime_events (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('CRVO','TRANSPHERE')),
  employee_key text not null,
  employee_name text not null,
  team_code text null,
  service text null,
  event_kind text not null check (event_kind in ('absence','late','early_departure')),
  reason_code text not null,
  start_date date not null,
  end_date date not null,
  event_time time null,
  justification_status text not null default 'not_required' check (justification_status in ('received','pending','not_required')),
  comment text null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  created_by uuid not null references public.crvo_auth_users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_by uuid null references public.crvo_auth_users(id),
  updated_at timestamptz not null default now(),
  closed_by uuid null references public.crvo_auth_users(id),
  closed_by_name text null,
  closed_at timestamptz null,
  constraint kpi_worktime_event_dates_ck check (end_date >= start_date),
  constraint kpi_worktime_event_time_ck check ((event_kind='absence') or (start_date=end_date and event_time is not null))
);

create table if not exists public.kpi_worktime_audit (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.kpi_worktime_events(id),
  action text not null,
  actor_id uuid not null references public.crvo_auth_users(id),
  actor_name text not null,
  actor_profile text not null,
  before_data jsonb null,
  after_data jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists kpi_worktime_events_period_idx on public.kpi_worktime_events(entity,start_date,end_date);
create index if not exists kpi_worktime_events_employee_idx on public.kpi_worktime_events(entity,employee_key,start_date);
create index if not exists kpi_worktime_events_team_idx on public.kpi_worktime_events(entity,team_code,start_date);
create index if not exists kpi_worktime_events_status_idx on public.kpi_worktime_events(status,start_date);
create index if not exists kpi_worktime_audit_event_idx on public.kpi_worktime_audit(event_id,created_at);

insert into public.kpi_worktime_shift_config(entity,team_code,label) values
('CRVO','A','Equipe A'),('CRVO','B','Equipe B'),('CRVO','C','Equipe C'),('CRVO','J','Journée / transverse'),('TRANSPHERE','TRANSPHERE','Transphère')
on conflict(entity,team_code) do nothing;

revoke all on table public.kpi_worktime_shift_config, public.kpi_worktime_people, public.kpi_worktime_events, public.kpi_worktime_audit from anon, authenticated;

create or replace function public.kpi_worktime_dashboard(p_session_hash text,p_entity text default 'CRVO',p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  v_user public.crvo_auth_users%rowtype; v_entity text:=upper(coalesce(p_entity,'CRVO')); v_from date:=coalesce(p_from,current_date); v_to date:=coalesce(p_to,current_date);
  v_all boolean:=false; v_can_close boolean:=false; v_can_config boolean:=false; v_teams text[]:=array[]::text[]; v_people jsonb; v_events jsonb; v_shifts jsonb; v_today date:=(now() at time zone 'Europe/Paris')::date;
begin
  if v_to<v_from or v_to-v_from>366 then raise exception 'Période invalide.' using errcode='22023'; end if;
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  if v_user.role='admin' or v_user.access_profile='hr' then v_all:=true; v_can_close:=true; v_can_config:=true;
  elsif v_user.access_profile='team_manager' then if v_entity<>'CRVO' then raise exception 'Entité interdite.' using errcode='42501'; end if; v_teams:=coalesce(v_user.team_scopes,array[]::text[]);
  elsif v_user.access_profile='transphere_manager' then if v_entity<>'TRANSPHERE' then raise exception 'Entité interdite.' using errcode='42501'; end if; v_teams:=coalesce(nullif(v_user.team_scopes,array[]::text[]),array['TRANSPHERE']);
  elsif 'worktime'=any(coalesce(v_user.page_permissions,array[]::text[])) then v_teams:=coalesce(v_user.team_scopes,array[]::text[]); v_all:='*'=any(v_teams);
  else raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if v_entity not in ('CRVO','TRANSPHERE') then raise exception 'Entité invalide.' using errcode='22023'; end if;

  if v_entity='CRVO' then
    select coalesce(jsonb_agg(jsonb_build_object('employeeKey',coalesce(nullif(matricule,''),name_key),'matricule',matricule,'name',full_name,'team',team_code,'service',service,'jobTitle',job_title) order by full_name),'[]'::jsonb) into v_people
    from public.kpi_rh_staff_dimension d where d.active is true and (v_all or '*'=any(v_teams) or d.team_code=any(v_teams));
  else
    select coalesce(jsonb_agg(jsonb_build_object('employeeKey',employee_key,'matricule',null,'name',full_name,'team',team_code,'service',service,'jobTitle',null) order by full_name),'[]'::jsonb) into v_people
    from public.kpi_worktime_people p where p.active is true and (v_all or '*'=any(v_teams) or p.team_code=any(v_teams));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entity',e.entity,'employeeKey',e.employee_key,'employeeName',e.employee_name,'team',e.team_code,'service',e.service,'kind',e.event_kind,'reason',e.reason_code,'startDate',e.start_date,'endDate',e.end_date,'eventTime',case when e.event_time is null then null else to_char(e.event_time,'HH24:MI') end,'justification',e.justification_status,'comment',e.comment,'status',e.status,'createdBy',e.created_by_name,'createdAt',e.created_at,'closedBy',e.closed_by_name,'closedAt',e.closed_at) order by e.start_date desc,e.employee_name),'[]'::jsonb) into v_events
  from public.kpi_worktime_events e where e.entity=v_entity and e.status<>'cancelled' and e.start_date<=v_to and e.end_date>=v_from and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams));

  select coalesce(jsonb_agg(jsonb_build_object('team',s.team_code,'label',s.label,'startTime',case when s.start_time is null then null else to_char(s.start_time,'HH24:MI') end,'endTime',case when s.end_time is null then null else to_char(s.end_time,'HH24:MI') end) order by s.team_code),'[]'::jsonb) into v_shifts
  from public.kpi_worktime_shift_config s where s.entity=v_entity and s.active and (v_all or '*'=any(v_teams) or s.team_code=any(v_teams));

  return jsonb_build_object('connected',true,'entity',v_entity,'from',v_from,'to',v_to,'people',v_people,'events',v_events,'shifts',v_shifts,
    'access',jsonb_build_object('profile',v_user.access_profile,'role',v_user.role,'teams',case when v_all then array['*']::text[] else v_teams end,'canClose',v_can_close,'canConfigure',v_can_config,'canManagePeople',v_can_config),
    'summary',jsonb_build_object(
      'absentToday',(select count(*) from public.kpi_worktime_events e where e.entity=v_entity and e.status='open' and e.event_kind='absence' and v_today between e.start_date and e.end_date and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))),
      'lateToday',(select count(*) from public.kpi_worktime_events e where e.entity=v_entity and e.status='open' and e.event_kind='late' and e.start_date=v_today and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))),
      'earlyToday',(select count(*) from public.kpi_worktime_events e where e.entity=v_entity and e.status='open' and e.event_kind='early_departure' and e.start_date=v_today and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))),
      'pendingJustifications',(select count(*) from public.kpi_worktime_events e where e.entity=v_entity and e.status='open' and e.justification_status='pending' and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))),
      'openEvents',(select count(*) from public.kpi_worktime_events e where e.entity=v_entity and e.status='open' and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams)))
    ));
end $$;

create or replace function public.kpi_worktime_create_event(p_session_hash text,p_entity text,p_employee_key text,p_kind text,p_reason text,p_start date,p_end date,p_event_time time default null,p_comment text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_entity text:=upper(p_entity); v_name text; v_team text; v_service text; v_id uuid; v_teams text[]; v_just text:='not_required';
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  if p_end<p_start or p_end-p_start>92 then raise exception 'Période invalide.' using errcode='22023'; end if;
  if p_kind not in ('absence','late','early_departure') then raise exception 'Type invalide.' using errcode='22023'; end if;
  if p_kind<>'absence' and (p_start<>p_end or p_event_time is null) then raise exception 'Heure requise.' using errcode='22023'; end if;
  if v_user.access_profile='team_manager' and v_entity<>'CRVO' then raise exception 'Entité interdite.' using errcode='42501'; end if;
  if v_user.access_profile='transphere_manager' and v_entity<>'TRANSPHERE' then raise exception 'Entité interdite.' using errcode='42501'; end if;
  if not (v_user.role='admin' or v_user.access_profile in ('hr','team_manager','transphere_manager') or 'worktime'=any(coalesce(v_user.page_permissions,array[]::text[]))) then raise exception 'Accès interdit.' using errcode='42501'; end if;
  v_teams:=coalesce(v_user.team_scopes,array[]::text[]);
  if v_entity='CRVO' then select full_name,team_code,service into v_name,v_team,v_service from public.kpi_rh_staff_dimension where active and coalesce(nullif(matricule,''),name_key)=p_employee_key limit 1;
  elsif v_entity='TRANSPHERE' then select full_name,team_code,service into v_name,v_team,v_service from public.kpi_worktime_people where entity='TRANSPHERE' and active and employee_key=p_employee_key limit 1;
  else raise exception 'Entité invalide.' using errcode='22023'; end if;
  if v_name is null then raise exception 'Collaborateur introuvable.' using errcode='22023'; end if;
  if v_user.role<>'admin' and v_user.access_profile<>'hr' and not ('*'=any(v_teams) or v_team=any(v_teams)) then raise exception 'Collaborateur hors périmètre.' using errcode='42501'; end if;
  if p_kind='absence' and exists(select 1 from public.kpi_worktime_events e where e.entity=v_entity and e.employee_key=p_employee_key and e.event_kind='absence' and e.status<>'cancelled' and e.start_date<=p_end and e.end_date>=p_start) then raise exception 'Une absence existe déjà sur cette période.' using errcode='23505'; end if;
  if p_kind<>'absence' and exists(select 1 from public.kpi_worktime_events e where e.entity=v_entity and e.employee_key=p_employee_key and e.event_kind=p_kind and e.status<>'cancelled' and e.start_date=p_start) then raise exception 'Événement déjà déclaré.' using errcode='23505'; end if;
  if p_reason='sick_received' then v_just:='received'; elsif p_reason='sick_pending' then v_just:='pending'; end if;
  insert into public.kpi_worktime_events(entity,employee_key,employee_name,team_code,service,event_kind,reason_code,start_date,end_date,event_time,justification_status,comment,created_by,created_by_name)
  values(v_entity,p_employee_key,v_name,v_team,v_service,p_kind,p_reason,p_start,p_end,p_event_time,v_just,nullif(trim(p_comment),''),v_user.id,v_user.display_name) returning id into v_id;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,after_data) select v_id,'created',v_user.id,v_user.display_name,v_user.access_profile,to_jsonb(e) from public.kpi_worktime_events e where e.id=v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.kpi_worktime_update_event(p_session_hash text,p_event_id uuid,p_reason text,p_start date,p_end date,p_event_time time default null,p_comment text default null,p_justification text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_event public.kpi_worktime_events%rowtype; v_before jsonb; v_teams text[];
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  select * into v_event from public.kpi_worktime_events where id=p_event_id for update;
  if v_event.id is null then raise exception 'Événement introuvable.' using errcode='22023'; end if;
  if v_event.status<>'open' then raise exception 'Événement verrouillé.' using errcode='42501'; end if;
  v_teams:=coalesce(v_user.team_scopes,array[]::text[]);
  if not (v_user.role='admin' or v_user.access_profile='hr' or ((v_user.access_profile in ('team_manager','transphere_manager') or 'worktime'=any(coalesce(v_user.page_permissions,array[]::text[]))) and ('*'=any(v_teams) or v_event.team_code=any(v_teams)))) then raise exception 'Accès interdit.' using errcode='42501'; end if;
  if p_end<p_start or p_end-p_start>92 then raise exception 'Période invalide.' using errcode='22023'; end if;
  if v_event.event_kind<>'absence' and (p_start<>p_end or p_event_time is null) then raise exception 'Heure requise.' using errcode='22023'; end if;
  v_before:=to_jsonb(v_event);
  update public.kpi_worktime_events set reason_code=p_reason,start_date=p_start,end_date=p_end,event_time=p_event_time,comment=nullif(trim(p_comment),''),justification_status=coalesce(nullif(p_justification,''),justification_status),updated_by=v_user.id,updated_at=now() where id=p_event_id;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,before_data,after_data) select p_event_id,'updated',v_user.id,v_user.display_name,v_user.access_profile,v_before,to_jsonb(e) from public.kpi_worktime_events e where e.id=p_event_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.kpi_worktime_set_status(p_session_hash text,p_event_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_event public.kpi_worktime_events%rowtype; v_before jsonb; v_teams text[];
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  select * into v_event from public.kpi_worktime_events where id=p_event_id for update;
  if v_event.id is null then raise exception 'Événement introuvable.' using errcode='22023'; end if;
  v_teams:=coalesce(v_user.team_scopes,array[]::text[]); v_before:=to_jsonb(v_event);
  if p_action='close' then
    if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Clôture RH requise.' using errcode='42501'; end if;
    update public.kpi_worktime_events set status='closed',closed_by=v_user.id,closed_by_name=v_user.display_name,closed_at=now(),updated_by=v_user.id,updated_at=now() where id=p_event_id and status='open';
  elsif p_action='reopen' then
    if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Réouverture RH requise.' using errcode='42501'; end if;
    update public.kpi_worktime_events set status='open',closed_by=null,closed_by_name=null,closed_at=null,updated_by=v_user.id,updated_at=now() where id=p_event_id and status='closed';
  elsif p_action='cancel' then
    if v_event.status<>'open' then raise exception 'Événement verrouillé.' using errcode='42501'; end if;
    if not (v_user.role='admin' or v_user.access_profile='hr' or ((v_user.access_profile in ('team_manager','transphere_manager') or 'worktime'=any(coalesce(v_user.page_permissions,array[]::text[]))) and ('*'=any(v_teams) or v_event.team_code=any(v_teams)))) then raise exception 'Accès interdit.' using errcode='42501'; end if;
    update public.kpi_worktime_events set status='cancelled',updated_by=v_user.id,updated_at=now() where id=p_event_id;
  else raise exception 'Action invalide.' using errcode='22023'; end if;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,before_data,after_data) select p_event_id,p_action,v_user.id,v_user.display_name,v_user.access_profile,v_before,to_jsonb(e) from public.kpi_worktime_events e where e.id=p_event_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.kpi_worktime_set_shift(p_session_hash text,p_entity text,p_team text,p_label text,p_start time,p_end time)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Paramétrage RH requis.' using errcode='42501'; end if;
  insert into public.kpi_worktime_shift_config(entity,team_code,label,start_time,end_time,updated_by,updated_at) values(upper(p_entity),upper(p_team),p_label,p_start,p_end,v_user.id,now()) on conflict(entity,team_code) do update set label=excluded.label,start_time=excluded.start_time,end_time=excluded.end_time,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.kpi_worktime_upsert_person(p_session_hash text,p_employee_key text,p_name text,p_team text default 'TRANSPHERE',p_service text default null,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Gestion RH requise.' using errcode='42501'; end if;
  insert into public.kpi_worktime_people(entity,employee_key,full_name,team_code,service,active,created_by) values('TRANSPHERE',trim(p_employee_key),trim(p_name),upper(coalesce(nullif(trim(p_team),''),'TRANSPHERE')),nullif(trim(p_service),''),p_active,v_user.id)
  on conflict(entity,employee_key) do update set full_name=excluded.full_name,team_code=excluded.team_code,service=excluded.service,active=excluded.active,updated_at=now();
  return jsonb_build_object('ok',true);
end $$;

grant execute on function public.kpi_worktime_dashboard(text,text,date,date), public.kpi_worktime_create_event(text,text,text,text,text,date,date,time,text), public.kpi_worktime_update_event(text,uuid,text,date,date,time,text,text), public.kpi_worktime_set_status(text,uuid,text), public.kpi_worktime_set_shift(text,text,text,text,time,time), public.kpi_worktime_upsert_person(text,text,text,text,text,boolean) to anon,authenticated,service_role;
