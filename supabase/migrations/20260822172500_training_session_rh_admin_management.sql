-- RH / ADMIN management of scheduled training sessions.
-- Keeps creation available to the existing training profiles, but restricts
-- modification and deletion of programmed sessions to HR and administrators.

create or replace function public.kpi_training_session_save(
  p_session_hash text,
  p_training_session_id uuid,
  p_title text,
  p_track_key text,
  p_trainer_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_status text,
  p_location text,
  p_objective text,
  p_focus_skill_keys text[],
  p_participant_keys text[],
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ctx record;
  rid uuid;
  part text;
  person record;
begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);
  if ctx.user_id is null then
    raise exception 'training_forbidden' using errcode='42501';
  end if;

  if p_training_session_id is not null
     and not (ctx.role='admin' or ctx.access_profile='hr') then
    raise exception 'training_session_manage_forbidden' using errcode='42501';
  end if;

  if nullif(trim(p_title),'') is null then raise exception 'title_required'; end if;
  if p_end_at<=p_start_at then raise exception 'invalid_period'; end if;
  if coalesce(p_status,'') not in ('planned','completed','cancelled') then raise exception 'invalid_status'; end if;
  if not exists(select 1 from public.kpi_training_tracks where key=p_track_key and active) then raise exception 'track_not_found'; end if;

  if p_training_session_id is null then
    insert into public.kpi_training_sessions(
      title,track_key,trainer_id,start_at,end_at,status,location,objective,
      focus_skill_keys,notes,created_by,created_by_name
    ) values(
      trim(p_title),p_track_key,p_trainer_id,p_start_at,p_end_at,p_status,
      nullif(trim(p_location),''),nullif(trim(p_objective),''),
      coalesce(p_focus_skill_keys,array[]::text[]),nullif(trim(p_notes),''),
      ctx.user_id,ctx.display_name
    ) returning id into rid;
  else
    if exists(
      select 1 from public.kpi_training_attendance a
      where a.session_id=p_training_session_id
        and (a.learner_signed_at is not null or a.trainer_signed_at is not null)
    ) then
      raise exception 'training_session_signed_locked';
    end if;

    if exists(
      select 1 from public.kpi_training_afest_dossiers d
      where d.session_id=p_training_session_id
        and d.status in ('ready_edi','submitted','approved','evidence_complete','reimbursed','closed')
    ) then
      raise exception 'training_session_afest_locked';
    end if;

    update public.kpi_training_sessions set
      title=trim(p_title),
      track_key=p_track_key,
      trainer_id=p_trainer_id,
      start_at=p_start_at,
      end_at=p_end_at,
      status=p_status,
      location=nullif(trim(p_location),''),
      objective=nullif(trim(p_objective),''),
      focus_skill_keys=coalesce(p_focus_skill_keys,array[]::text[]),
      notes=nullif(trim(p_notes),''),
      updated_at=now()
    where id=p_training_session_id
    returning id into rid;

    if rid is null then raise exception 'session_not_found'; end if;

    delete from public.kpi_training_session_attendees where session_id=rid;
    delete from public.kpi_training_attendance where session_id=rid;
  end if;

  foreach part in array coalesce(p_participant_keys,array[]::text[]) loop
    select * into person
    from public.kpi_worktime_population_for_date((p_start_at at time zone 'Europe/Paris')::date) p
    where p.employee_key=part and p.sector_key='carrosserie'
    limit 1;

    -- Fall back to the current population if the scheduled date does not have a
    -- population snapshot yet (typical for future sessions).
    if person.employee_key is null then
      select * into person
      from public.kpi_worktime_population_for_date(current_date) p
      where p.employee_key=part and p.sector_key='carrosserie'
      limit 1;
    end if;

    if person.employee_key is not null then
      insert into public.kpi_training_session_attendees(
        session_id,employee_key,employee_name,matricule,team_code,service
      ) values(
        rid,person.employee_key,person.employee_name,person.matricule,person.team_code,person.service
      ) on conflict do nothing;

      insert into public.kpi_training_attendance(session_id,employee_key,employee_name)
      values(rid,person.employee_key,person.employee_name)
      on conflict(session_id,employee_key) do update
        set employee_name=excluded.employee_name,updated_at=now();
    end if;
  end loop;

  insert into public.kpi_training_audit(
    entity_type,entity_id,action,actor_user_id,actor_name,snapshot
  ) values(
    'session',rid::text,
    case when p_training_session_id is null then 'created' else 'updated_by_rh_admin' end,
    ctx.user_id,ctx.display_name,
    jsonb_build_object(
      'title',p_title,'trackKey',p_track_key,'trainerId',p_trainer_id,
      'startAt',p_start_at,'endAt',p_end_at,'status',p_status,
      'participants',p_participant_keys
    )
  );

  return jsonb_build_object('ok',true,'id',rid);
end;
$function$;

create or replace function public.kpi_training_session_delete(
  p_session_hash text,
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ctx record;
  target record;
  snap jsonb;
begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);
  if ctx.user_id is null then
    raise exception 'training_forbidden' using errcode='42501';
  end if;
  if not (ctx.role='admin' or ctx.access_profile='hr') then
    raise exception 'training_session_manage_forbidden' using errcode='42501';
  end if;

  select * into target from public.kpi_training_sessions where id=p_session_id;
  if target.id is null then raise exception 'session_not_found'; end if;
  if target.status<>'planned' then raise exception 'training_session_delete_not_planned'; end if;

  if exists(
    select 1 from public.kpi_training_attendance a
    where a.session_id=p_session_id
      and (a.learner_signed_at is not null or a.trainer_signed_at is not null)
  ) then
    raise exception 'training_session_signed_locked';
  end if;

  if exists(
    select 1 from public.kpi_training_afest_dossiers d
    where d.session_id=p_session_id
      and d.status in ('ready_edi','submitted','approved','evidence_complete','reimbursed','closed')
  ) then
    raise exception 'training_session_afest_locked';
  end if;

  snap=to_jsonb(target) || jsonb_build_object(
    'participants',coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeKey',a.employee_key,
        'employeeName',a.employee_name,
        'service',a.service,
        'team',a.team_code
      ) order by a.employee_name)
      from public.kpi_training_session_attendees a where a.session_id=p_session_id
    ),'[]'::jsonb),
    'afestDossiers',coalesce((
      select jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'title',d.title))
      from public.kpi_training_afest_dossiers d where d.session_id=p_session_id
    ),'[]'::jsonb)
  );

  insert into public.kpi_training_audit(
    entity_type,entity_id,action,actor_user_id,actor_name,snapshot
  ) values(
    'session',p_session_id::text,'deleted_by_rh_admin',ctx.user_id,ctx.display_name,snap
  );

  delete from public.kpi_training_sessions where id=p_session_id;
  return jsonb_build_object('ok',true,'id',p_session_id,'deleted',true);
end;
$function$;
