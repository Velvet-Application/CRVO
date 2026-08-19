-- Enforce the organization-derived team + sector perimeter on every worktime operation.
-- Also exposes the A/B weekly rotation and allows RH/Admin to anchor the first week.

create or replace function public.kpi_worktime_dashboard(p_session_hash text,p_entity text default 'CRVO',p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  v_user public.crvo_auth_users%rowtype; v_entity text:=upper(coalesce(p_entity,'CRVO')); v_from date:=coalesce(p_from,(now() at time zone 'Europe/Paris')::date); v_to date:=coalesce(p_to,v_from);
  v_all boolean:=false; v_can_close boolean:=false; v_can_config boolean:=false; v_teams text[]:=array[]::text[]; v_sectors text[]:=array[]::text[]; v_level text; v_position text; v_shift_group text;
  v_people jsonb; v_events jsonb; v_shifts jsonb; v_today date:=(now() at time zone 'Europe/Paris')::date;
begin
  if v_to<v_from or v_to-v_from>366 then raise exception 'Période invalide.' using errcode='22023'; end if;
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select s.all_access,s.team_codes,s.sector_keys,s.can_close,s.can_config,s.level_code,s.position_key into v_all,v_teams,v_sectors,v_can_close,v_can_config,v_level,v_position from public.kpi_worktime_scope_for_user(v_user.id,v_entity) s limit 1;
  if v_teams is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
  if v_entity not in ('CRVO','TRANSPHERE') then raise exception 'Entité invalide.' using errcode='22023'; end if;
  if v_position is not null then select shift_group into v_shift_group from public.kpi_worktime_org_positions where position_key=v_position; end if;

  if v_entity='CRVO' then
    select coalesce(jsonb_agg(jsonb_build_object('employeeKey',coalesce(nullif(d.matricule,''),d.name_key),'matricule',d.matricule,'name',d.full_name,'team',d.team_code,'service',d.service,'jobTitle',d.job_title,'sector',m.sector_key) order by d.full_name),'[]'::jsonb) into v_people
    from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service
    where d.active is true and (v_all or '*'=any(v_teams) or d.team_code=any(v_teams)) and (v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors));
  else
    select coalesce(jsonb_agg(jsonb_build_object('employeeKey',p.employee_key,'matricule',null,'name',p.full_name,'team',p.team_code,'service',p.service,'jobTitle',null,'sector','transphere') order by p.full_name),'[]'::jsonb) into v_people
    from public.kpi_worktime_people p where p.active is true and (v_all or '*'=any(v_teams) or p.team_code=any(v_teams));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entity',e.entity,'employeeKey',e.employee_key,'employeeName',e.employee_name,'team',e.team_code,'service',e.service,'sector',m.sector_key,'kind',e.event_kind,'reason',e.reason_code,'startDate',e.start_date,'endDate',e.end_date,'eventTime',case when e.event_time is null then null else to_char(e.event_time,'HH24:MI') end,'justification',e.justification_status,'comment',e.comment,'status',e.status,'createdBy',e.created_by_name,'createdAt',e.created_at,'closedBy',e.closed_by_name,'closedAt',e.closed_at) order by e.start_date desc,e.employee_name),'[]'::jsonb) into v_events
  from public.kpi_worktime_events e left join public.kpi_worktime_service_sector_map m on m.service_code=e.service
  where e.entity=v_entity and e.status<>'cancelled' and e.start_date<=v_to and e.end_date>=v_from
    and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams))
    and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors));

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
  where s.entity=v_entity and s.active and (v_all or v_shift_group is null and ('*'=any(v_teams) or s.team_code=any(v_teams)) or v_shift_group='AB' and s.team_code in ('A','B') or v_shift_group in ('A','B','C','J','TRANSPHERE') and s.team_code=v_shift_group);

  return jsonb_build_object('connected',true,'entity',v_entity,'from',v_from,'to',v_to,'people',v_people,'events',v_events,'shifts',v_shifts,
    'organization',case when v_position is null then null else (select jsonb_build_object('positionKey',p.position_key,'name',p.person_name,'title',p.title,'level',p.level_code,'parent',p.parent_position_key,'teams',p.team_codes,'sectors',p.sector_keys,'shiftGroup',p.shift_group) from public.kpi_worktime_org_positions p where p.position_key=v_position) end,
    'access',jsonb_build_object('profile',v_user.access_profile,'role',v_user.role,'teams',v_teams,'sectors',v_sectors,'canClose',v_can_close,'canConfigure',v_can_config,'canManagePeople',v_can_config,'level',v_level,'positionKey',v_position),
    'summary',jsonb_build_object(
      'absentToday',(select count(*) from public.kpi_worktime_events e left join public.kpi_worktime_service_sector_map m on m.service_code=e.service where e.entity=v_entity and e.status='open' and e.event_kind='absence' and v_today between e.start_date and e.end_date and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams)) and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors))),
      'lateToday',(select count(*) from public.kpi_worktime_events e left join public.kpi_worktime_service_sector_map m on m.service_code=e.service where e.entity=v_entity and e.status='open' and e.event_kind='late' and e.start_date=v_today and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams)) and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors))),
      'earlyToday',(select count(*) from public.kpi_worktime_events e left join public.kpi_worktime_service_sector_map m on m.service_code=e.service where e.entity=v_entity and e.status='open' and e.event_kind='early_departure' and e.start_date=v_today and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams)) and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors))),
      'pendingJustifications',(select count(*) from public.kpi_worktime_events e left join public.kpi_worktime_service_sector_map m on m.service_code=e.service where e.entity=v_entity and e.status='open' and e.justification_status='pending' and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams)) and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors))),
      'openEvents',(select count(*) from public.kpi_worktime_events e left join public.kpi_worktime_service_sector_map m on m.service_code=e.service where e.entity=v_entity and e.status='open' and (v_all or '*'=any(v_teams) or e.team_code=any(v_teams)) and (v_entity='TRANSPHERE' or v_all or '*'=any(v_sectors) or m.sector_key=any(v_sectors)))
    ));
end $$;

create or replace function public.kpi_worktime_create_event(p_session_hash text,p_entity text,p_employee_key text,p_kind text,p_reason text,p_start date,p_end date,p_event_time time default null,p_comment text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_entity text:=upper(p_entity); v_name text; v_team text; v_service text; v_sector text; v_id uuid; v_all boolean; v_teams text[]; v_sectors text[]; v_dummy boolean; v_level text; v_position text; v_just text:='not_required';
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select s.all_access,s.team_codes,s.sector_keys,s.can_close,s.can_config,s.level_code,s.position_key into v_all,v_teams,v_sectors,v_dummy,v_dummy,v_level,v_position from public.kpi_worktime_scope_for_user(v_user.id,v_entity) s limit 1;
  if v_teams is null then raise exception 'Accès interdit.' using errcode='42501'; end if;
  if p_end<p_start or p_end-p_start>92 then raise exception 'Période invalide.' using errcode='22023'; end if;
  if p_kind not in ('absence','late','early_departure') then raise exception 'Type invalide.' using errcode='22023'; end if;
  if p_kind<>'absence' and (p_start<>p_end or p_event_time is null) then raise exception 'Heure requise.' using errcode='22023'; end if;
  if v_entity='CRVO' then select d.full_name,d.team_code,d.service,m.sector_key into v_name,v_team,v_service,v_sector from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service where d.active and coalesce(nullif(d.matricule,''),d.name_key)=p_employee_key limit 1;
  elsif v_entity='TRANSPHERE' then select full_name,team_code,service,'transphere' into v_name,v_team,v_service,v_sector from public.kpi_worktime_people where entity='TRANSPHERE' and active and employee_key=p_employee_key limit 1;
  else raise exception 'Entité invalide.' using errcode='22023'; end if;
  if v_name is null then raise exception 'Collaborateur introuvable.' using errcode='22023'; end if;
  if not (v_all or '*'=any(v_teams) or v_team=any(v_teams)) then raise exception 'Collaborateur hors équipe.' using errcode='42501'; end if;
  if v_entity='CRVO' and not (v_all or '*'=any(v_sectors) or v_sector=any(v_sectors)) then raise exception 'Collaborateur hors secteur.' using errcode='42501'; end if;
  if p_kind='absence' and exists(select 1 from public.kpi_worktime_events e where e.entity=v_entity and e.employee_key=p_employee_key and e.event_kind='absence' and e.status<>'cancelled' and e.start_date<=p_end and e.end_date>=p_start) then raise exception 'Une absence existe déjà sur cette période.' using errcode='23505'; end if;
  if p_kind<>'absence' and exists(select 1 from public.kpi_worktime_events e where e.entity=v_entity and e.employee_key=p_employee_key and e.event_kind=p_kind and e.status<>'cancelled' and e.start_date=p_start) then raise exception 'Événement déjà déclaré.' using errcode='23505'; end if;
  if p_reason='sick_received' then v_just:='received'; elsif p_reason='sick_pending' then v_just:='pending'; end if;
  insert into public.kpi_worktime_events(entity,employee_key,employee_name,team_code,service,event_kind,reason_code,start_date,end_date,event_time,justification_status,comment,created_by,created_by_name)
  values(v_entity,p_employee_key,v_name,v_team,v_service,p_kind,p_reason,p_start,p_end,p_event_time,v_just,nullif(trim(p_comment),''),v_user.id,v_user.display_name) returning id into v_id;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,after_data) select v_id,'created',v_user.id,v_user.display_name,coalesce(v_position,v_user.access_profile),to_jsonb(e) from public.kpi_worktime_events e where e.id=v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.kpi_worktime_update_event(p_session_hash text,p_event_id uuid,p_reason text,p_start date,p_end date,p_event_time time default null,p_comment text default null,p_justification text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_event public.kpi_worktime_events%rowtype; v_before jsonb; v_all boolean; v_teams text[]; v_sectors text[]; v_can_close boolean; v_can_config boolean; v_level text; v_position text; v_sector text;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  select * into v_event from public.kpi_worktime_events where id=p_event_id for update;
  if v_event.id is null then raise exception 'Événement introuvable.' using errcode='22023'; end if;
  if v_event.status<>'open' then raise exception 'Événement verrouillé.' using errcode='42501'; end if;
  select s.all_access,s.team_codes,s.sector_keys,s.can_close,s.can_config,s.level_code,s.position_key into v_all,v_teams,v_sectors,v_can_close,v_can_config,v_level,v_position from public.kpi_worktime_scope_for_user(v_user.id,v_event.entity) s limit 1;
  if v_teams is null then raise exception 'Accès interdit.' using errcode='42501'; end if;
  select sector_key into v_sector from public.kpi_worktime_service_sector_map where service_code=v_event.service;
  if not (v_all or '*'=any(v_teams) or v_event.team_code=any(v_teams)) then raise exception 'Événement hors équipe.' using errcode='42501'; end if;
  if v_event.entity='CRVO' and not (v_all or '*'=any(v_sectors) or v_sector=any(v_sectors)) then raise exception 'Événement hors secteur.' using errcode='42501'; end if;
  if p_end<p_start or p_end-p_start>92 then raise exception 'Période invalide.' using errcode='22023'; end if;
  if v_event.event_kind<>'absence' and (p_start<>p_end or p_event_time is null) then raise exception 'Heure requise.' using errcode='22023'; end if;
  v_before:=to_jsonb(v_event);
  update public.kpi_worktime_events set reason_code=p_reason,start_date=p_start,end_date=p_end,event_time=p_event_time,comment=nullif(trim(p_comment),''),justification_status=coalesce(nullif(p_justification,''),justification_status),updated_by=v_user.id,updated_at=now() where id=p_event_id;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,before_data,after_data) select p_event_id,'updated',v_user.id,v_user.display_name,coalesce(v_position,v_user.access_profile),v_before,to_jsonb(e) from public.kpi_worktime_events e where e.id=p_event_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.kpi_worktime_set_status(p_session_hash text,p_event_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_event public.kpi_worktime_events%rowtype; v_before jsonb; v_all boolean; v_teams text[]; v_sectors text[]; v_can_close boolean; v_can_config boolean; v_level text; v_position text; v_sector text;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  select * into v_event from public.kpi_worktime_events where id=p_event_id for update;
  if v_event.id is null then raise exception 'Événement introuvable.' using errcode='22023'; end if;
  select s.all_access,s.team_codes,s.sector_keys,s.can_close,s.can_config,s.level_code,s.position_key into v_all,v_teams,v_sectors,v_can_close,v_can_config,v_level,v_position from public.kpi_worktime_scope_for_user(v_user.id,v_event.entity) s limit 1;
  if v_teams is null then raise exception 'Accès interdit.' using errcode='42501'; end if;
  select sector_key into v_sector from public.kpi_worktime_service_sector_map where service_code=v_event.service;
  if not (v_all or '*'=any(v_teams) or v_event.team_code=any(v_teams)) then raise exception 'Événement hors équipe.' using errcode='42501'; end if;
  if v_event.entity='CRVO' and not (v_all or '*'=any(v_sectors) or v_sector=any(v_sectors)) then raise exception 'Événement hors secteur.' using errcode='42501'; end if;
  v_before:=to_jsonb(v_event);
  if p_action='close' then if not v_can_close then raise exception 'Clôture RH requise.' using errcode='42501'; end if; update public.kpi_worktime_events set status='closed',closed_by=v_user.id,closed_by_name=v_user.display_name,closed_at=now(),updated_by=v_user.id,updated_at=now() where id=p_event_id and status='open';
  elsif p_action='reopen' then if not v_can_close then raise exception 'Réouverture RH requise.' using errcode='42501'; end if; update public.kpi_worktime_events set status='open',closed_by=null,closed_by_name=null,closed_at=null,updated_by=v_user.id,updated_at=now() where id=p_event_id and status='closed';
  elsif p_action='cancel' then if v_event.status<>'open' then raise exception 'Événement verrouillé.' using errcode='42501'; end if; update public.kpi_worktime_events set status='cancelled',updated_by=v_user.id,updated_at=now() where id=p_event_id;
  else raise exception 'Action invalide.' using errcode='22023'; end if;
  insert into public.kpi_worktime_audit(event_id,action,actor_id,actor_name,actor_profile,before_data,after_data) select p_event_id,p_action,v_user.id,v_user.display_name,coalesce(v_position,v_user.access_profile),v_before,to_jsonb(e) from public.kpi_worktime_events e where e.id=p_event_id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.kpi_worktime_set_rotation_anchor(p_session_hash text,p_anchor_monday date,p_a_morning boolean)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_monday date;
begin
  select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Paramétrage RH requis.' using errcode='42501'; end if;
  v_monday:=p_anchor_monday - ((extract(isodow from p_anchor_monday)::int)-1);
  update public.kpi_worktime_shift_config set rotation_anchor_monday=v_monday,rotation_anchor_primary=p_a_morning,updated_by=v_user.id,updated_at=now() where entity='CRVO' and team_code in ('A','B');
  return jsonb_build_object('ok',true,'anchorMonday',v_monday,'aMorning',p_a_morning);
end $$;

grant execute on function public.kpi_worktime_dashboard(text,text,date,date),public.kpi_worktime_create_event(text,text,text,text,text,date,date,time,text),public.kpi_worktime_update_event(text,uuid,text,date,date,time,text,text),public.kpi_worktime_set_status(text,uuid,text),public.kpi_worktime_set_rotation_anchor(text,date,boolean) to anon,authenticated,service_role;
