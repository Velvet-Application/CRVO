create table if not exists public.kpi_worktime_daily_validations (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('CRVO','TRANSPHERE')),
  work_date date not null,
  employee_key text not null,
  employee_name text not null,
  team_code text,
  service text,
  sector_key text,
  validation_kind text not null default 'no_event' check (validation_kind in ('no_event')),
  status text not null default 'confirmed' check (status in ('confirmed','revoked')),
  position_key text references public.kpi_worktime_org_positions(position_key),
  validated_by uuid references public.crvo_auth_users(id),
  validated_by_name text not null,
  validated_at timestamptz not null default now(),
  revoked_by uuid references public.crvo_auth_users(id),
  revoked_by_name text,
  revoked_at timestamptz,
  revoke_reason text
);

create unique index if not exists kpi_worktime_daily_validations_active_uq
on public.kpi_worktime_daily_validations(entity,work_date,employee_key)
where status='confirmed';

create index if not exists kpi_worktime_daily_validations_scope_idx
on public.kpi_worktime_daily_validations(entity,work_date,team_code,sector_key,status);

create table if not exists public.kpi_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  entity text,
  work_date date,
  position_key text references public.kpi_worktime_org_positions(position_key),
  team_code text,
  sector_key text,
  source_key text not null unique,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists kpi_notifications_active_idx
on public.kpi_notifications(resolved_at,created_at desc);
create index if not exists kpi_notifications_position_idx
on public.kpi_notifications(position_key,created_at desc);

create table if not exists public.kpi_notification_reads (
  notification_id uuid not null references public.kpi_notifications(id) on delete cascade,
  user_id uuid not null references public.crvo_auth_users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(notification_id,user_id)
);

create or replace function public.kpi_worktime_population_for_date(p_date date)
returns table(employee_key text,employee_name text,matricule text,team_code text,service text,sector_key text)
language sql
stable
security definer
set search_path='public'
as $function$
with latest_staff as (
  select distinct on (d.name_key)
    d.name_key,d.employee_key,d.full_name,d.matricule,d.team_code,d.service,d.active,d.source_updated_at,d.entry_date,d.exit_date
  from public.kpi_rh_staff_dimension d
  where d.name_key is not null
  order by d.name_key,d.active desc,d.source_updated_at desc nulls last,d.entry_date desc nulls last
), historical as (
  select distinct f.person_name_key
  from public.kpi_sql_presence_facts f
  where f.work_date=p_date and f.person_name_key is not null
)
select s.employee_key,s.full_name,s.matricule,s.team_code,s.service,m.sector_key
from latest_staff s
left join public.kpi_worktime_service_sector_map m on m.service_code=s.service
where case
  when p_date >= (now() at time zone 'Europe/Paris')::date then s.active
  else exists(select 1 from historical h where h.person_name_key=s.name_key)
end
$function$;

create or replace function public.kpi_worktime_person_validation_state(p_entity text,p_date date,p_employee_key text)
returns text
language sql
stable
security definer
set search_path='public'
as $function$
select case
  when upper(p_entity)='CRVO' and exists(
    select 1 from public.kpi_worktime_rh_event_source r
    where r.employee_key=p_employee_key and r.start_date=p_date
  ) then 'data_rh'
  when exists(
    select 1 from public.kpi_worktime_events e
    where e.entity=upper(p_entity) and e.employee_key=p_employee_key and e.status<>'cancelled'
      and ((e.event_kind='absence' and p_date between e.start_date and e.end_date) or (e.event_kind<>'absence' and e.start_date=p_date))
  ) then 'event'
  when exists(
    select 1 from public.kpi_worktime_daily_validations v
    where v.entity=upper(p_entity) and v.employee_key=p_employee_key and v.work_date=p_date and v.status='confirmed'
  ) then 'no_event'
  else 'pending'
end
$function$;

create or replace function public.kpi_worktime_position_completion(p_position_key text,p_date date,p_team_override text default null)
returns table(total_people integer,validated_people integer,pending_people integer,complete boolean)
language sql
stable
security definer
set search_path='public'
as $function$
with pos as (
  select * from public.kpi_worktime_org_positions where position_key=p_position_key and active
), roster as (
  select p.employee_key
  from public.kpi_worktime_population_for_date(p_date) p cross join pos
  where
    (p_team_override is null and (pos.all_access or '*'=any(pos.team_codes) or p.team_code=any(pos.team_codes))
      or p_team_override is not null and (p_team_override='J' and '*'=any(pos.team_codes) or p.team_code=p_team_override))
    and (pos.all_access or '*'=any(pos.sector_keys) or p.sector_key=any(pos.sector_keys))
), states as (
  select employee_key,public.kpi_worktime_person_validation_state('CRVO',p_date,employee_key) state from roster
)
select count(*)::int,
       count(*) filter(where state<>'pending')::int,
       count(*) filter(where state='pending')::int,
       (count(*)>0 and count(*) filter(where state='pending')=0)
from states
$function$;

create or replace function public.kpi_worktime_shift_end_local(p_entity text,p_team text,p_work_date date)
returns timestamp
language plpgsql
stable
security definer
set search_path='public'
as $function$
declare s public.kpi_worktime_shift_config%rowtype; v_start time; v_end time; v_weeks integer; v_primary boolean; v_end_date date:=p_work_date;
begin
  select * into s from public.kpi_worktime_shift_config where entity=upper(p_entity) and team_code=p_team and active limit 1;
  if s.team_code is null or s.end_time is null then return null; end if;
  if s.rotation_mode='weekly_alternate' then
    if s.rotation_anchor_monday is null then return null; end if;
    v_weeks:=floor((p_work_date-s.rotation_anchor_monday)::numeric/7)::int;
    v_primary:=((abs(v_weeks)%2=0)=s.rotation_anchor_primary);
    v_start:=case when v_primary then s.start_time else s.alternate_start_time end;
    v_end:=case when v_primary then s.end_time else s.alternate_end_time end;
  else
    v_start:=s.start_time; v_end:=s.end_time;
  end if;
  if v_start is null or v_end is null then return null; end if;
  if v_end<=v_start then v_end_date:=p_work_date+1; end if;
  return v_end_date::timestamp+v_end;
end
$function$;

create or replace function public.kpi_worktime_validation_status(p_session_hash text,p_entity text,p_date date)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_scope record; v_entity text:=upper(p_entity); v_people jsonb; v_scope_summary jsonb; v_position public.kpi_worktime_org_positions%rowtype;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,v_entity) limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if v_entity='CRVO' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'employeeKey',p.employee_key,'state',public.kpi_worktime_person_validation_state(v_entity,p_date,p.employee_key),
      'locked',public.kpi_worktime_person_validation_state(v_entity,p_date,p.employee_key) in ('data_rh','no_event'),
      'source',case public.kpi_worktime_person_validation_state(v_entity,p_date,p.employee_key) when 'data_rh' then 'Data RH' when 'event' then 'Événement saisi' when 'no_event' then 'Présence validée' else 'À valider' end
    ) order by p.employee_name),'[]'::jsonb) into v_people
    from public.kpi_worktime_population_for_date(p_date) p
    where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys));
  else
    select '[]'::jsonb into v_people;
  end if;

  if v_scope.position_key is not null then select * into v_position from public.kpi_worktime_org_positions where position_key=v_scope.position_key; end if;
  if v_position.position_key is not null and v_position.level_code='team_leader' then
    select jsonb_build_object(
      'positionKey',v_position.position_key,'title',v_position.title,'teams',v_position.team_codes,'sectors',v_position.sector_keys,
      'total',x.total_people,'validated',x.validated_people,'pending',x.pending_people,'complete',x.complete
    ) into v_scope_summary
    from public.kpi_worktime_position_completion(v_position.position_key,p_date,null) x;
  else v_scope_summary:=null; end if;

  return jsonb_build_object('date',p_date,'people',v_people,'scope',v_scope_summary,'canConfirm',coalesce(v_scope.level_code,'')='team_leader');
end
$function$;

create or replace function public.kpi_worktime_confirm_presence(p_session_hash text,p_entity text,p_date date,p_employee_key text default null,p_bulk boolean default false)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_scope record; v_entity text:=upper(p_entity); v_position public.kpi_worktime_org_positions%rowtype; v_count integer:=0; v_completion record; v_person record;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,v_entity) limit 1;
  if v_scope is null or coalesce(v_scope.level_code,'')<>'team_leader' then raise exception 'Validation réservée au chef d’équipe.' using errcode='42501'; end if;
  if p_date>(now() at time zone 'Europe/Paris')::date then raise exception 'Impossible de valider une journée future.' using errcode='22023'; end if;
  if v_entity<>'CRVO' then raise exception 'Validation automatique disponible pour le CRVO.' using errcode='22023'; end if;
  if v_scope.position_key is not null then select * into v_position from public.kpi_worktime_org_positions where position_key=v_scope.position_key; end if;

  if p_bulk then
    if v_position.position_key is null then raise exception 'Poste hiérarchique requis pour la validation équipe.' using errcode='42501'; end if;
    insert into public.kpi_worktime_daily_validations(entity,work_date,employee_key,employee_name,team_code,service,sector_key,position_key,validated_by,validated_by_name)
    select v_entity,p_date,p.employee_key,p.employee_name,p.team_code,p.service,p.sector_key,v_position.position_key,v_user.id,v_user.display_name
    from public.kpi_worktime_population_for_date(p_date) p
    where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
      and public.kpi_worktime_person_validation_state(v_entity,p_date,p.employee_key)='pending'
    on conflict do nothing;
    get diagnostics v_count=row_count;
  else
    if coalesce(p_employee_key,'')='' then raise exception 'Collaborateur requis.' using errcode='22023'; end if;
    select p.* into v_person from public.kpi_worktime_population_for_date(p_date) p where p.employee_key=p_employee_key limit 1;
    if v_person.employee_key is null then raise exception 'Collaborateur introuvable sur cette journée.' using errcode='22023'; end if;
    if not (v_scope.all_access or '*'=any(v_scope.team_codes) or v_person.team_code=any(v_scope.team_codes))
       or not (v_scope.all_access or '*'=any(v_scope.sector_keys) or v_person.sector_key=any(v_scope.sector_keys)) then
      raise exception 'Collaborateur hors périmètre.' using errcode='42501';
    end if;
    if public.kpi_worktime_person_validation_state(v_entity,p_date,p_employee_key)<>'pending' then
      return jsonb_build_object('ok',true,'alreadyValidated',true,'state',public.kpi_worktime_person_validation_state(v_entity,p_date,p_employee_key));
    end if;
    insert into public.kpi_worktime_daily_validations(entity,work_date,employee_key,employee_name,team_code,service,sector_key,position_key,validated_by,validated_by_name)
    values(v_entity,p_date,v_person.employee_key,v_person.employee_name,v_person.team_code,v_person.service,v_person.sector_key,v_position.position_key,v_user.id,v_user.display_name)
    on conflict do nothing;
    v_count:=1;
  end if;

  if v_position.position_key is not null then
    select * into v_completion from public.kpi_worktime_position_completion(v_position.position_key,p_date,null);
    if coalesce(v_completion.complete,false) then
      update public.kpi_notifications set resolved_at=coalesce(resolved_at,now())
      where kind='worktime_missing_validation' and position_key=v_position.position_key and work_date=p_date and resolved_at is null;
    end if;
  end if;
  return jsonb_build_object('ok',true,'confirmed',v_count,'completion',case when v_position.position_key is null then null else jsonb_build_object('total',v_completion.total_people,'validated',v_completion.validated_people,'pending',v_completion.pending_people,'complete',v_completion.complete) end);
end
$function$;

create or replace function public.kpi_worktime_reopen_presence(p_session_hash text,p_entity text,p_date date,p_employee_key text,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_count integer;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  if v_user.role<>'admin' and v_user.access_profile<>'hr' then raise exception 'Réouverture réservée RH / admin.' using errcode='42501'; end if;
  update public.kpi_worktime_daily_validations set status='revoked',revoked_by=v_user.id,revoked_by_name=v_user.display_name,revoked_at=now(),revoke_reason=nullif(trim(p_reason),'')
  where entity=upper(p_entity) and work_date=p_date and employee_key=p_employee_key and status='confirmed';
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'reopened',v_count);
end
$function$;

create or replace function public.kpi_worktime_create_event(p_session_hash text, p_entity text, p_employee_key text, p_kind text, p_reason text, p_start date, p_end date, p_event_time time without time zone default null, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_entity text:=upper(p_entity); v_name text; v_team text; v_service text; v_sector text; v_id uuid; v_all boolean; v_teams text[]; v_sectors text[]; v_dummy boolean; v_level text; v_position text; v_just text:='not_required';
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select s.all_access,s.team_codes,s.sector_keys,s.can_close,s.can_config,s.level_code,s.position_key into v_all,v_teams,v_sectors,v_dummy,v_dummy,v_level,v_position from public.kpi_worktime_scope_for_user(v_user.id,v_entity) s limit 1;
  if v_teams is null then raise exception 'Accès interdit.' using errcode='42501'; end if;
  if p_end<p_start or p_end-p_start>92 then raise exception 'Période invalide.' using errcode='22023'; end if;
  if p_kind not in ('absence','late','early_departure') then raise exception 'Type invalide.' using errcode='22023'; end if;
  if p_kind<>'absence' and (p_start<>p_end or p_event_time is null) then raise exception 'Heure requise.' using errcode='22023'; end if;
  if v_entity='CRVO' then
    select d.full_name,d.team_code,d.service,m.sector_key into v_name,v_team,v_service,v_sector from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service where d.active and d.employee_key=p_employee_key limit 1;
  elsif v_entity='TRANSPHERE' then select full_name,team_code,service,'transphere' into v_name,v_team,v_service,v_sector from public.kpi_worktime_people where entity='TRANSPHERE' and active and employee_key=p_employee_key limit 1;
  else raise exception 'Entité invalide.' using errcode='22023'; end if;
  if v_name is null then raise exception 'Collaborateur introuvable.' using errcode='22023'; end if;
  if not (v_all or '*'=any(v_teams) or v_team=any(v_teams)) then raise exception 'Collaborateur hors équipe.' using errcode='42501'; end if;
  if v_entity='CRVO' and not (v_all or '*'=any(v_sectors) or v_sector=any(v_sectors)) then raise exception 'Collaborateur hors secteur.' using errcode='42501'; end if;

  if v_entity='CRVO' and v_user.role<>'admin' and v_user.access_profile<>'hr' then
    if exists(select 1 from public.kpi_worktime_daily_validations v where v.entity=v_entity and v.employee_key=p_employee_key and v.status='confirmed' and v.work_date between p_start and p_end) then
      raise exception 'Présence déjà validée RAS. Une réouverture RH est requise.' using errcode='42501';
    end if;
    if exists(select 1 from public.kpi_worktime_rh_event_source r where r.employee_key=p_employee_key and r.start_date between p_start and p_end) then
      raise exception 'Journée verrouillée automatiquement par Data RH.' using errcode='42501';
    end if;
  elsif v_entity='CRVO' then
    update public.kpi_worktime_daily_validations set status='revoked',revoked_by=v_user.id,revoked_by_name=v_user.display_name,revoked_at=now(),revoke_reason='Réouverture automatique lors d’une saisie RH/admin'
    where entity=v_entity and employee_key=p_employee_key and status='confirmed' and work_date between p_start and p_end;
  end if;

  if p_kind='absence' and exists(select 1 from public.kpi_worktime_events e where e.entity=v_entity and e.employee_key=p_employee_key and e.event_kind='absence' and e.status<>'cancelled' and e.start_date<=p_end and e.end_date>=p_start) then raise exception 'Une absence existe déjà sur cette période.' using errcode='23505'; end if;
  if p_kind<>'absence' and exists(select 1 from public.kpi_worktime_events e where e.entity=v_entity and e.employee_key=p_employee_key and e.event_kind=p_kind and e.status<>'cancelled' and e.start_date=p_start) then raise exception 'Événement déjà déclaré.' using errcode='23505'; end if;
  if p_reason='sick_received' then v_just:='received'; elsif p_reason='sick_pending' then v_just:='pending'; end if;
  insert into public.kpi_worktime_events(entity,employee_key,employee_name,team_code,service,event_kind,reason_code,start_date,end_date,event_time,justification_status,comment,created_by,created_by_name)
  values(v_entity,p_employee_key,v_name,v_team,v_service,p_kind,p_reason,p_start,p_end,p_event_time,v_just,nullif(trim(p_comment),''),v_user.id,v_user.display_name) returning id into v_id;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,after_data) select v_id,'created',v_user.id,v_user.display_name,coalesce(v_position,v_user.access_profile),to_jsonb(e) from public.kpi_worktime_events e where e.id=v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end
$function$;

create or replace function public.kpi_worktime_generate_validation_alerts()
returns integer
language plpgsql
security definer
set search_path='public'
as $function$
declare v_now timestamp:=(now() at time zone 'Europe/Paris'); v_date date; pos record; v_team text; v_end timestamp; c record; v_source text; v_inserted integer:=0; v_sector text;
begin
  for pos in select * from public.kpi_worktime_org_positions where entity='CRVO' and active and level_code='team_leader' loop
    for v_team in
      select x from unnest(case when '*'=any(pos.team_codes) then array[coalesce(pos.shift_group,'J')]::text[] else pos.team_codes end) x
    loop
      foreach v_date in array array[v_now::date,(v_now::date-1)] loop
        v_end:=public.kpi_worktime_shift_end_local('CRVO',v_team,v_date);
        if v_end is null then continue; end if;
        if v_now < v_end-interval '5 minutes' or v_now > v_end+interval '12 hours' then continue; end if;
        select * into c from public.kpi_worktime_position_completion(pos.position_key,v_date,v_team);
        v_source:=concat('worktime_missing:',pos.position_key,':',v_team,':',v_date::text);
        v_sector:=case when '*'=any(pos.sector_keys) then 'Tous secteurs' else array_to_string(pos.sector_keys,' / ') end;
        if coalesce(c.total_people,0)>0 and coalesce(c.pending_people,0)>0 then
          insert into public.kpi_notifications(kind,severity,entity,work_date,position_key,team_code,sector_key,source_key,title,message,metadata)
          values('worktime_missing_validation',case when v_now>=v_end then 'critical' else 'warning' end,'CRVO',v_date,pos.position_key,v_team,v_sector,v_source,
            'Temps de travail non clôturé',
            format('%s · équipe %s · %s : %s/%s collaborateurs validés, %s à traiter.',pos.person_name,v_team,v_sector,c.validated_people,c.total_people,c.pending_people),
            jsonb_build_object('leader',pos.person_name,'title',pos.title,'validated',c.validated_people,'total',c.total_people,'pending',c.pending_people,'shiftEnd',v_end,'preEndAlert',v_now<v_end))
          on conflict(source_key) do update set severity=excluded.severity,message=excluded.message,metadata=excluded.metadata,resolved_at=null;
          if found then v_inserted:=v_inserted+1; end if;
        else
          update public.kpi_notifications set resolved_at=coalesce(resolved_at,now()) where source_key=v_source and resolved_at is null;
        end if;
      end loop;
    end loop;
  end loop;
  return v_inserted;
end
$function$;

create or replace function public.kpi_notification_visible(p_user_id uuid,p_notification_position text)
returns boolean
language sql
stable
security definer
set search_path='public'
as $function$
with recursive me as (
  select u.id,u.role,u.access_profile,up.position_key
  from public.crvo_auth_users u left join public.kpi_worktime_user_position up on up.user_id=u.id
  where u.id=p_user_id and u.is_active
), ancestry as (
  select p.position_key,p.parent_position_key from public.kpi_worktime_org_positions p where p.position_key=p_notification_position
  union all
  select parent.position_key,parent.parent_position_key
  from public.kpi_worktime_org_positions parent join ancestry a on a.parent_position_key=parent.position_key
)
select coalesce((select role='admin' or access_profile in ('hr','service_manager') or position_key=p_notification_position or position_key in (select position_key from ancestry) from me limit 1),false)
$function$;

create or replace function public.kpi_notifications_list(p_session_hash text,p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_rows jsonb; v_unread integer;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'kind',q.kind,'severity',q.severity,'title',q.title,'message',q.message,'workDate',q.work_date,'team',q.team_code,'sector',q.sector_key,
    'createdAt',q.created_at,'resolvedAt',q.resolved_at,'read',q.read_at is not null,'metadata',q.metadata
  ) order by q.created_at desc),'[]'::jsonb) into v_rows
  from (
    select n.*,r.read_at
    from public.kpi_notifications n
    left join public.kpi_notification_reads r on r.notification_id=n.id and r.user_id=v_user.id
    where public.kpi_notification_visible(v_user.id,n.position_key)
    order by n.created_at desc
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) q;
  select count(*) into v_unread from public.kpi_notifications n left join public.kpi_notification_reads r on r.notification_id=n.id and r.user_id=v_user.id
  where n.resolved_at is null and r.notification_id is null and public.kpi_notification_visible(v_user.id,n.position_key);
  return jsonb_build_object('notifications',v_rows,'unread',v_unread);
end
$function$;

create or replace function public.kpi_notifications_mark_read(p_session_hash text,p_notification_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_count integer:=0;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  insert into public.kpi_notification_reads(notification_id,user_id)
  select n.id,v_user.id from public.kpi_notifications n
  where (p_notification_id is null or n.id=p_notification_id) and public.kpi_notification_visible(v_user.id,n.position_key)
  on conflict(notification_id,user_id) do update set read_at=excluded.read_at;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'read',v_count);
end
$function$;

grant execute on function public.kpi_worktime_validation_status(text,text,date) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_confirm_presence(text,text,date,text,boolean) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_reopen_presence(text,text,date,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_notifications_list(text,integer) to anon,authenticated,service_role;
grant execute on function public.kpi_notifications_mark_read(text,uuid) to anon,authenticated,service_role;

do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname='crvo-worktime-validation-alerts' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('crvo-worktime-validation-alerts','* * * * *','select public.kpi_worktime_generate_validation_alerts();');
end $$;
