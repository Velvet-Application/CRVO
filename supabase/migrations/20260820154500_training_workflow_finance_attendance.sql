-- Formation V2: demandes superviseur, validation RH/Admin, coûts, émargement et intégration capacitaire.

alter table public.kpi_training_sessions add column if not exists workflow_status text not null default 'pending';
alter table public.kpi_training_sessions add column if not exists workflow_decision_by uuid references public.crvo_auth_users(id) on delete set null;
alter table public.kpi_training_sessions add column if not exists workflow_decision_name text;
alter table public.kpi_training_sessions add column if not exists workflow_decision_comment text;
alter table public.kpi_training_sessions add column if not exists workflow_decided_at timestamptz;
alter table public.kpi_training_sessions add column if not exists funding_status text not null default 'draft';
alter table public.kpi_training_sessions add column if not exists funding_body text;
alter table public.kpi_training_sessions add column if not exists funding_reference text;
alter table public.kpi_training_sessions add column if not exists material_cost numeric(12,2) not null default 0;
alter table public.kpi_training_sessions add column if not exists external_cost numeric(12,2) not null default 0;
alter table public.kpi_training_sessions add column if not exists other_cost numeric(12,2) not null default 0;

do $$ begin
  alter table public.kpi_training_sessions add constraint kpi_training_sessions_workflow_ck check(workflow_status in ('pending','approved','refused','cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.kpi_training_sessions add constraint kpi_training_sessions_funding_ck check(funding_status in ('draft','requested','approved','refused','paid'));
exception when duplicate_object then null; end $$;

create table if not exists public.kpi_training_requests (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null,
  employee_name text not null,
  matricule text,
  team_code text,
  service text,
  sector_key text not null default 'carrosserie',
  requested_track_key text references public.kpi_training_tracks(key) on delete set null,
  difficulties text not null,
  acquired_skills text,
  requested_skills text,
  operational_context text,
  urgency text not null default 'normal' check(urgency in ('critical','high','normal','low')),
  status text not null default 'pending' check(status in ('pending','approved','refused','cancelled')),
  requested_by uuid references public.crvo_auth_users(id) on delete set null,
  requested_by_name text,
  requested_by_position text,
  created_at timestamptz not null default now(),
  decided_by uuid references public.crvo_auth_users(id) on delete set null,
  decided_by_name text,
  decision_comment text,
  decided_at timestamptz,
  linked_session_id uuid references public.kpi_training_sessions(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists kpi_training_requests_status_idx on public.kpi_training_requests(status,created_at desc);
create index if not exists kpi_training_requests_employee_idx on public.kpi_training_requests(employee_key,created_at desc);

create table if not exists public.kpi_training_attendance (
  session_id uuid not null references public.kpi_training_sessions(id) on delete cascade,
  employee_key text not null,
  employee_name text not null,
  attendance_status text not null default 'planned' check(attendance_status in ('planned','present','partial','absent')),
  arrival_at timestamptz,
  departure_at timestamptz,
  learner_signed_at timestamptz,
  learner_signature_name text,
  learner_signature_mark text,
  trainer_signed_at timestamptz,
  trainer_signature_name text,
  trainer_signature_mark text,
  attestation_version text not null default 'v1',
  updated_at timestamptz not null default now(),
  primary key(session_id,employee_key)
);

create table if not exists public.kpi_training_finance_settings (
  key text primary key default 'CRVO',
  trainer_loaded_hourly_cost numeric(12,2) not null default 0,
  learner_default_loaded_hourly_cost numeric(12,2) not null default 0,
  admin_loaded_hourly_cost numeric(12,2) not null default 0,
  room_hourly_cost numeric(12,2) not null default 0,
  equipment_hourly_cost numeric(12,2) not null default 0,
  consumables_per_learner numeric(12,2) not null default 0,
  default_funding_body text,
  accounting_notes text,
  updated_by uuid references public.crvo_auth_users(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
insert into public.kpi_training_finance_settings(key) values('CRVO') on conflict(key) do nothing;

create table if not exists public.kpi_training_cost_profiles (
  employee_key text primary key,
  employee_name text not null,
  profile_kind text not null default 'learner' check(profile_kind in ('trainer','learner')),
  monthly_gross_salary numeric(12,2),
  loaded_hourly_cost numeric(12,2),
  effective_from date not null default current_date,
  notes text,
  updated_by uuid references public.crvo_auth_users(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

create or replace function public.kpi_training_is_finance_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists(select 1 from public.crvo_auth_users u where u.id=p_user_id and u.is_active and (u.role='admin' or u.access_profile='hr'));
$$;

create or replace function public.kpi_training_employee_detail(p_session_hash text,p_employee_key text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare ctx record; person jsonb;
begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);
  if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501'; end if;
  select jsonb_build_object('employeeKey',p.employee_key,'employeeName',p.employee_name,'matricule',p.matricule,'team',p.team_code,'service',p.service)
    into person from public.kpi_worktime_population_for_date(current_date) p where p.employee_key=p_employee_key and p.sector_key='carrosserie' limit 1;
  if person is null then raise exception 'employee_not_found'; end if;
  return jsonb_build_object(
    'person',person,
    'evaluations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'employeeKey',e.employee_key,'employeeName',e.employee_name,'trackKey',e.track_key,'evaluationDate',e.evaluation_date,'kind',e.kind,'sessionId',e.session_id,'overallScore',e.overall_score,'overallPct',e.overall_pct,'pilotageLevel',e.pilotage_level,'summary',e.summary,'evaluatorName',e.evaluator_name,'createdAt',e.created_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('skillId',i.skill_id,'skillKey',s.skill_key,'skillLabel',s.label,'blockKey',s.block_key,'score',i.score,'observation',i.observation) order by b.sort_order,s.sort_order) from public.kpi_training_evaluation_items i join public.kpi_training_skills s on s.id=i.skill_id join public.kpi_training_blocks b on b.key=s.block_key where i.evaluation_id=e.id),'[]'::jsonb)
    ) order by e.evaluation_date desc,e.created_at desc) from public.kpi_training_evaluations e where e.employee_key=p_employee_key),'[]'::jsonb),
    'legacySnapshots',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'employeeKey',l.employee_key,'employeeName',l.employee_name,'teamLabel',l.team_label,'trackKey',l.track_key,'blockScores',l.block_scores,'overallPoints',l.overall_points,'overallPct',l.overall_pct,'legacyStatus',l.legacy_status,'comments',l.comments,'sourceSheet',l.source_sheet,'sourceEvaluationDate',l.source_evaluation_date,'importedAt',l.imported_at
    ) order by l.track_key) from public.kpi_training_legacy_snapshots l where l.employee_key=p_employee_key),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',pl.id,'trackKey',pl.track_key,'status',pl.status,'priority',pl.priority,'targetDate',pl.target_date,'objective',pl.objective,'trainerId',pl.trainer_id,'trainerName',tr.display_name,'createdByName',pl.created_by_name,'createdAt',pl.created_at,'updatedAt',pl.updated_at) order by pl.updated_at desc) from public.kpi_training_plans pl left join public.kpi_training_trainers tr on tr.id=pl.trainer_id where pl.employee_key=p_employee_key),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',se.id,'title',se.title,'trackKey',se.track_key,'startAt',se.start_at,'endAt',se.end_at,'status',se.status,'workflowStatus',se.workflow_status,'trainerName',tr.display_name,'attendeeStatus',a.status,'preEvaluationId',a.pre_evaluation_id,'postEvaluationId',a.post_evaluation_id) order by se.start_at desc) from public.kpi_training_session_attendees a join public.kpi_training_sessions se on se.id=a.session_id left join public.kpi_training_trainers tr on tr.id=se.trainer_id where a.employee_key=p_employee_key),'[]'::jsonb),
    'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'category',o.category,'content',o.content,'sessionId',o.session_id,'trackKey',o.track_key,'createdByName',o.created_by_name,'createdAt',o.created_at) order by o.created_at desc) from public.kpi_training_observations o where o.employee_key=p_employee_key),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'urgency',r.urgency,'trackKey',r.requested_track_key,'difficulties',r.difficulties,'acquiredSkills',r.acquired_skills,'requestedSkills',r.requested_skills,'operationalContext',r.operational_context,'requestedByName',r.requested_by_name,'createdAt',r.created_at,'decisionComment',r.decision_comment,'decidedByName',r.decided_by_name,'decidedAt',r.decided_at,'linkedSessionId',r.linked_session_id) order by r.created_at desc) from public.kpi_training_requests r where r.employee_key=p_employee_key),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(jsonb_build_object('sessionId',a.session_id,'attendanceStatus',a.attendance_status,'arrivalAt',a.arrival_at,'departureAt',a.departure_at,'learnerSignedAt',a.learner_signed_at,'learnerSignatureName',a.learner_signature_name,'trainerSignedAt',a.trainer_signed_at,'trainerSignatureName',a.trainer_signature_name) order by se.start_at desc) from public.kpi_training_attendance a join public.kpi_training_sessions se on se.id=a.session_id where a.employee_key=p_employee_key),'[]'::jsonb)
  );
end;$$;

create or replace function public.kpi_training_session_save_v2(
  p_session_hash text,p_training_session_id uuid,p_title text,p_track_key text,p_trainer_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_status text,p_location text,p_objective text,p_focus_skill_keys text[],p_participant_keys text[],p_notes text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare ctx record;rid uuid;part text;person record;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash); if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'title_required'; end if; if p_end_at<=p_start_at then raise exception 'invalid_period'; end if;
  if coalesce(p_status,'') not in ('planned','completed','cancelled') then raise exception 'invalid_status'; end if;
  if not exists(select 1 from public.kpi_training_tracks where key=p_track_key and active) then raise exception 'track_not_found'; end if;
  if coalesce(array_length(p_participant_keys,1),0)=0 then raise exception 'participant_required'; end if;
  if p_training_session_id is null then
    insert into public.kpi_training_sessions(title,track_key,trainer_id,start_at,end_at,status,workflow_status,location,objective,focus_skill_keys,notes,created_by,created_by_name)
    values(trim(p_title),p_track_key,p_trainer_id,p_start_at,p_end_at,p_status,'pending',nullif(trim(p_location),''),nullif(trim(p_objective),''),coalesce(p_focus_skill_keys,array[]::text[]),nullif(trim(p_notes),''),ctx.user_id,ctx.display_name) returning id into rid;
  else
    update public.kpi_training_sessions set title=trim(p_title),track_key=p_track_key,trainer_id=p_trainer_id,start_at=p_start_at,end_at=p_end_at,status=p_status,location=nullif(trim(p_location),''),objective=nullif(trim(p_objective),''),focus_skill_keys=coalesce(p_focus_skill_keys,array[]::text[]),notes=nullif(trim(p_notes),''),updated_at=now() where id=p_training_session_id and workflow_status in ('pending','approved') returning id into rid;
    if rid is null then raise exception 'session_not_found'; end if; delete from public.kpi_training_session_attendees where session_id=rid;
  end if;
  foreach part in array p_participant_keys loop
    select * into person from public.kpi_worktime_population_for_date((p_start_at at time zone 'Europe/Paris')::date) p where p.employee_key=part and p.sector_key='carrosserie' limit 1;
    if person.employee_key is null then raise exception 'participant_not_found'; end if;
    insert into public.kpi_training_session_attendees(session_id,employee_key,employee_name,matricule,team_code,service) values(rid,person.employee_key,person.employee_name,person.matricule,person.team_code,person.service);
    insert into public.kpi_training_attendance(session_id,employee_key,employee_name) values(rid,person.employee_key,person.employee_name) on conflict(session_id,employee_key) do update set employee_name=excluded.employee_name,updated_at=now();
  end loop;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('session',rid::text,case when p_training_session_id is null then 'created_pending_approval' else 'updated' end,ctx.user_id,ctx.display_name,jsonb_build_object('title',p_title,'trackKey',p_track_key,'startAt',p_start_at,'endAt',p_end_at,'participants',p_participant_keys,'workflowStatus','pending'));
  return jsonb_build_object('ok',true,'id',rid,'workflowStatus','pending');
end;$$;

create or replace function public.kpi_training_session_decide(p_session_hash text,p_session_id uuid,p_decision text,p_comment text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare ctx record;rid uuid;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash); if ctx.user_id is null or not public.kpi_training_is_finance_user(ctx.user_id) then raise exception 'training_decision_forbidden' using errcode='42501'; end if;
  if p_decision not in ('approve','refuse','cancel') then raise exception 'invalid_decision'; end if;
  if p_decision in ('refuse','cancel') and nullif(trim(coalesce(p_comment,'')),'') is null then raise exception 'decision_comment_required'; end if;
  update public.kpi_training_sessions set workflow_status=case p_decision when 'approve' then 'approved' when 'refuse' then 'refused' else 'cancelled' end,status=case when p_decision in ('refuse','cancel') then 'cancelled' else status end,workflow_decision_by=ctx.user_id,workflow_decision_name=ctx.display_name,workflow_decision_comment=nullif(trim(p_comment),''),workflow_decided_at=now(),updated_at=now() where id=p_session_id returning id into rid;
  if rid is null then raise exception 'session_not_found'; end if;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('session',rid::text,p_decision,ctx.user_id,ctx.display_name,jsonb_build_object('comment',p_comment));
  return jsonb_build_object('ok',true,'id',rid,'workflowStatus',case p_decision when 'approve' then 'approved' when 'refuse' then 'refused' else 'cancelled' end);
end;$$;

create or replace function public.kpi_training_request_submit(p_session_hash text,p_employee_key text,p_track_key text,p_difficulties text,p_acquired_skills text,p_requested_skills text,p_operational_context text,p_urgency text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare uid uuid;uname text;scope record;person record;rid uuid;begin
  select u.id,u.display_name into uid,uname from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if uid is null then raise exception 'training_request_forbidden' using errcode='42501'; end if;
  select * into scope from public.kpi_worktime_scope_for_user(uid,'CRVO');
  if coalesce(scope.level_code,'') not in ('supervisor','industrial_manager') and not exists(select 1 from public.crvo_auth_users where id=uid and (role='admin' or access_profile in ('service_manager','hr'))) then raise exception 'training_request_forbidden' using errcode='42501'; end if;
  select * into person from public.kpi_worktime_population_for_date(current_date) p where p.employee_key=p_employee_key and p.sector_key='carrosserie' and (scope.all_access or p.team_code=any(scope.team_codes)) limit 1;
  if person.employee_key is null then raise exception 'employee_not_in_scope'; end if;
  if nullif(trim(p_difficulties),'') is null then raise exception 'difficulties_required'; end if;
  if p_urgency not in ('critical','high','normal','low') then raise exception 'invalid_priority'; end if;
  insert into public.kpi_training_requests(employee_key,employee_name,matricule,team_code,service,requested_track_key,difficulties,acquired_skills,requested_skills,operational_context,urgency,requested_by,requested_by_name,requested_by_position)
  values(person.employee_key,person.employee_name,person.matricule,person.team_code,person.service,nullif(p_track_key,''),trim(p_difficulties),nullif(trim(p_acquired_skills),''),nullif(trim(p_requested_skills),''),nullif(trim(p_operational_context),''),p_urgency,uid,uname,scope.position_key) returning id into rid;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('request',rid::text,'submitted',uid,uname,jsonb_build_object('employeeKey',person.employee_key,'urgency',p_urgency,'difficulties',p_difficulties));
  return jsonb_build_object('ok',true,'id',rid);
end;$$;

create or replace function public.kpi_training_request_decide(p_session_hash text,p_request_id uuid,p_decision text,p_comment text default null,p_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare ctx record;rid uuid;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash); if ctx.user_id is null or not public.kpi_training_is_finance_user(ctx.user_id) then raise exception 'training_decision_forbidden' using errcode='42501'; end if;
  if p_decision not in ('approve','refuse','cancel') then raise exception 'invalid_decision'; end if;
  if p_decision in ('refuse','cancel') and nullif(trim(coalesce(p_comment,'')),'') is null then raise exception 'decision_comment_required'; end if;
  update public.kpi_training_requests set status=case p_decision when 'approve' then 'approved' when 'refuse' then 'refused' else 'cancelled' end,decision_comment=nullif(trim(p_comment),''),decided_by=ctx.user_id,decided_by_name=ctx.display_name,decided_at=now(),linked_session_id=coalesce(p_session_id,linked_session_id),updated_at=now() where id=p_request_id returning id into rid;
  if rid is null then raise exception 'request_not_found'; end if;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('request',rid::text,p_decision,ctx.user_id,ctx.display_name,jsonb_build_object('comment',p_comment,'sessionId',p_session_id));
  return jsonb_build_object('ok',true,'id',rid);
end;$$;

create or replace function public.kpi_training_attendance_sign(p_session_hash text,p_session_id uuid,p_employee_key text,p_attendance_status text,p_signature_name text,p_signature_mark text,p_signer text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare ctx record;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash); if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501'; end if;
  if p_attendance_status not in ('present','partial','absent') then raise exception 'invalid_attendance'; end if;
  if p_signer not in ('learner','trainer') then raise exception 'invalid_signer'; end if;
  update public.kpi_training_attendance set attendance_status=p_attendance_status,
    learner_signed_at=case when p_signer='learner' then now() else learner_signed_at end,
    learner_signature_name=case when p_signer='learner' then nullif(trim(p_signature_name),'') else learner_signature_name end,
    learner_signature_mark=case when p_signer='learner' then nullif(p_signature_mark,'') else learner_signature_mark end,
    trainer_signed_at=case when p_signer='trainer' then now() else trainer_signed_at end,
    trainer_signature_name=case when p_signer='trainer' then coalesce(nullif(trim(p_signature_name),''),ctx.display_name) else trainer_signature_name end,
    trainer_signature_mark=case when p_signer='trainer' then nullif(p_signature_mark,'') else trainer_signature_mark end,updated_at=now()
  where session_id=p_session_id and employee_key=p_employee_key;
  if not found then raise exception 'attendance_not_found'; end if;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('attendance',p_session_id::text||':'||p_employee_key,'signed_'||p_signer,ctx.user_id,ctx.display_name,jsonb_build_object('attendanceStatus',p_attendance_status,'signatureName',p_signature_name,'signedAt',now()));
  return jsonb_build_object('ok',true,'signedAt',now());
end;$$;

create or replace function public.kpi_training_finance_dashboard(p_session_hash text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare uid uuid;begin
  select u.id into uid from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if uid is null or not public.kpi_training_is_finance_user(uid) then raise exception 'training_finance_forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'settings',(select jsonb_build_object('trainerLoadedHourlyCost',s.trainer_loaded_hourly_cost,'learnerDefaultLoadedHourlyCost',s.learner_default_loaded_hourly_cost,'adminLoadedHourlyCost',s.admin_loaded_hourly_cost,'roomHourlyCost',s.room_hourly_cost,'equipmentHourlyCost',s.equipment_hourly_cost,'consumablesPerLearner',s.consumables_per_learner,'defaultFundingBody',s.default_funding_body,'accountingNotes',s.accounting_notes,'updatedByName',s.updated_by_name,'updatedAt',s.updated_at) from public.kpi_training_finance_settings s where key='CRVO'),
    'costProfiles',coalesce((select jsonb_agg(jsonb_build_object('employeeKey',c.employee_key,'employeeName',c.employee_name,'profileKind',c.profile_kind,'monthlyGrossSalary',c.monthly_gross_salary,'loadedHourlyCost',c.loaded_hourly_cost,'effectiveFrom',c.effective_from,'notes',c.notes,'updatedAt',c.updated_at) order by c.employee_name) from public.kpi_training_cost_profiles c),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'startAt',s.start_at,'endAt',s.end_at,'workflowStatus',s.workflow_status,'fundingStatus',s.funding_status,'fundingBody',s.funding_body,'fundingReference',s.funding_reference,'materialCost',s.material_cost,'externalCost',s.external_cost,'otherCost',s.other_cost,'trainerId',s.trainer_id,'trainerName',t.display_name,'participants',(select count(*) from public.kpi_training_session_attendees a where a.session_id=s.id)) order by s.start_at desc) from public.kpi_training_sessions s left join public.kpi_training_trainers t on t.id=s.trainer_id),'[]'::jsonb)
  );
end;$$;

create or replace function public.kpi_training_finance_save(p_session_hash text,p_settings jsonb,p_profile jsonb default null,p_session_finance jsonb default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare uid uuid;uname text;begin
  select u.id,u.display_name into uid,uname from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if uid is null or not public.kpi_training_is_finance_user(uid) then raise exception 'training_finance_forbidden' using errcode='42501'; end if;
  if p_settings is not null then update public.kpi_training_finance_settings set trainer_loaded_hourly_cost=coalesce((p_settings->>'trainerLoadedHourlyCost')::numeric,trainer_loaded_hourly_cost),learner_default_loaded_hourly_cost=coalesce((p_settings->>'learnerDefaultLoadedHourlyCost')::numeric,learner_default_loaded_hourly_cost),admin_loaded_hourly_cost=coalesce((p_settings->>'adminLoadedHourlyCost')::numeric,admin_loaded_hourly_cost),room_hourly_cost=coalesce((p_settings->>'roomHourlyCost')::numeric,room_hourly_cost),equipment_hourly_cost=coalesce((p_settings->>'equipmentHourlyCost')::numeric,equipment_hourly_cost),consumables_per_learner=coalesce((p_settings->>'consumablesPerLearner')::numeric,consumables_per_learner),default_funding_body=coalesce(nullif(p_settings->>'defaultFundingBody',''),default_funding_body),accounting_notes=coalesce(nullif(p_settings->>'accountingNotes',''),accounting_notes),updated_by=uid,updated_by_name=uname,updated_at=now() where key='CRVO'; end if;
  if p_profile is not null then insert into public.kpi_training_cost_profiles(employee_key,employee_name,profile_kind,monthly_gross_salary,loaded_hourly_cost,effective_from,notes,updated_by,updated_by_name) values(p_profile->>'employeeKey',p_profile->>'employeeName',coalesce(nullif(p_profile->>'profileKind',''),'learner'),nullif(p_profile->>'monthlyGrossSalary','')::numeric,nullif(p_profile->>'loadedHourlyCost','')::numeric,coalesce(nullif(p_profile->>'effectiveFrom','')::date,current_date),nullif(p_profile->>'notes',''),uid,uname) on conflict(employee_key) do update set employee_name=excluded.employee_name,profile_kind=excluded.profile_kind,monthly_gross_salary=excluded.monthly_gross_salary,loaded_hourly_cost=excluded.loaded_hourly_cost,effective_from=excluded.effective_from,notes=excluded.notes,updated_by=uid,updated_by_name=uname,updated_at=now(); end if;
  if p_session_finance is not null then update public.kpi_training_sessions set funding_status=coalesce(nullif(p_session_finance->>'fundingStatus',''),funding_status),funding_body=coalesce(nullif(p_session_finance->>'fundingBody',''),funding_body),funding_reference=coalesce(nullif(p_session_finance->>'fundingReference',''),funding_reference),material_cost=coalesce(nullif(p_session_finance->>'materialCost','')::numeric,material_cost),external_cost=coalesce(nullif(p_session_finance->>'externalCost','')::numeric,external_cost),other_cost=coalesce(nullif(p_session_finance->>'otherCost','')::numeric,other_cost),updated_at=now() where id=(p_session_finance->>'sessionId')::uuid; end if;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('finance','CRVO','updated',uid,uname,jsonb_build_object('settings',p_settings,'profile',p_profile,'sessionFinance',p_session_finance));
  return jsonb_build_object('ok',true);
end;$$;

create or replace function public.kpi_training_worktime_events(p_session_hash text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare uid uuid;begin
  select u.id into uid from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if uid is null then raise exception 'training_forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id','training:'||s.id::text||':'||a.employee_key,'entity','CRVO','employeeKey',a.employee_key,'employeeName',a.employee_name,'team',a.team_code,'service',a.service,'sector','carrosserie','kind','absence','reason','training','startDate',(s.start_at at time zone 'Europe/Paris')::date,'endDate',(s.end_at at time zone 'Europe/Paris')::date,'eventTime',to_char(s.start_at at time zone 'Europe/Paris','HH24:MI'),'durationHours',round((extract(epoch from (s.end_at-s.start_at))/3600.0)::numeric,2),'source','training','justification','not_required','comment',s.title||case when s.objective is not null then ' · '||s.objective else '' end,'status',case when s.status='cancelled' then 'cancelled' else 'closed' end,'createdBy',coalesce(s.created_by_name,'Formation'),'createdAt',s.created_at,'closedBy',s.workflow_decision_name,'closedAt',s.workflow_decided_at
  ) order by s.start_at,a.employee_name) from public.kpi_training_sessions s join public.kpi_training_session_attendees a on a.session_id=s.id where s.workflow_status='approved' and s.status<>'cancelled' and (s.start_at at time zone 'Europe/Paris')::date<=p_to and (s.end_at at time zone 'Europe/Paris')::date>=p_from),'[]'::jsonb);
end;$$;

create or replace function public.kpi_site_presence_capacity_v9(p_session_hash text,p_date date default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare payload jsonb; target date; tr jsonb; total_training numeric:=0; site_cap numeric; bottleneck text;begin
  payload:=public.kpi_site_presence_capacity_v8(p_session_hash,p_date); target:=coalesce((payload->>'date')::date,p_date,(now() at time zone 'Europe/Paris')::date);
  create temporary table if not exists tmp_training_capacity(sector_key text,team_code text,hours numeric) on commit drop; truncate tmp_training_capacity;
  insert into tmp_training_capacity(sector_key,team_code,hours)
  select 'carrosserie',a.team_code,sum(greatest(0,extract(epoch from (least(s.end_at,((target+1)::timestamp at time zone 'Europe/Paris'))-greatest(s.start_at,(target::timestamp at time zone 'Europe/Paris'))))/3600.0))
  from public.kpi_training_sessions s join public.kpi_training_session_attendees a on a.session_id=s.id where s.workflow_status='approved' and s.status<>'cancelled' and s.start_at<((target+1)::timestamp at time zone 'Europe/Paris') and s.end_at>(target::timestamp at time zone 'Europe/Paris') group by a.team_code;
  select coalesce(sum(hours),0) into total_training from tmp_training_capacity;
  if total_training<=0 then return jsonb_set(payload,'{summary,trainingHours}','0'::jsonb,true); end if;
  select jsonb_agg(case when e->>'sectorKey'='carrosserie' then jsonb_set(jsonb_set(jsonb_set(e,'{trainingHours}',to_jsonb(coalesce((select sum(hours) from tmp_training_capacity),0)),true),'{hours}',to_jsonb(greatest(0,coalesce((e->>'hours')::numeric,0)-coalesce((select sum(hours) from tmp_training_capacity),0))),true),'{theoreticalVehicles}',case when nullif((e->>'avgBilledHoursPerSiteVehicle10d')::numeric,0) is null then 'null'::jsonb else to_jsonb(round(greatest(0,coalesce((e->>'hours')::numeric,0)-coalesce((select sum(hours) from tmp_training_capacity),0))/nullif((e->>'avgBilledHoursPerSiteVehicle10d')::numeric,0),1)) end,true) else e end) into tr from jsonb_array_elements(payload->'sectors') e;
  payload:=jsonb_set(payload,'{sectors}',coalesce(tr,'[]'::jsonb),true);
  select jsonb_agg(case when e->>'sectorKey'='carrosserie' then jsonb_set(jsonb_set(jsonb_set(e,'{trainingHours}',to_jsonb(coalesce((select hours from tmp_training_capacity where team_code=e->>'team' limit 1),0)),true),'{hours}',to_jsonb(greatest(0,coalesce((e->>'hours')::numeric,0)-coalesce((select hours from tmp_training_capacity where team_code=e->>'team' limit 1),0))),true),'{theoreticalVehicles}',case when nullif((e->>'avgBilledHoursPerSiteVehicle10d')::numeric,0) is null then 'null'::jsonb else to_jsonb(round(greatest(0,coalesce((e->>'hours')::numeric,0)-coalesce((select hours from tmp_training_capacity where team_code=e->>'team' limit 1),0))/nullif((e->>'avgBilledHoursPerSiteVehicle10d')::numeric,0),1)) end,true) else e end) into tr from jsonb_array_elements(payload->'teams') e;
  payload:=jsonb_set(payload,'{teams}',coalesce(tr,'[]'::jsonb),true);
  select min((e->>'theoreticalVehicles')::numeric), (array_agg(e->>'sectorLabel' order by (e->>'theoreticalVehicles')::numeric))[1] into site_cap,bottleneck from jsonb_array_elements(payload->'sectors') e where nullif(e->>'theoreticalVehicles','') is not null;
  payload:=jsonb_set(payload,'{summary,productiveHours}',to_jsonb(greatest(0,coalesce((payload#>>'{summary,productiveHours}')::numeric,0)-total_training)),true);
  payload:=jsonb_set(payload,'{summary,trainingHours}',to_jsonb(round(total_training,2)),true);
  if site_cap is not null then payload:=jsonb_set(payload,'{summary,siteTheoreticalVehicles}',to_jsonb(round(site_cap,1)),true); payload:=jsonb_set(payload,'{summary,bottleneckSector}',to_jsonb(bottleneck),true); end if;
  return payload;
end;$$;

-- Sécurisation directe des nouvelles tables.
do $$ declare t text; begin foreach t in array array['kpi_training_requests','kpi_training_attendance','kpi_training_finance_settings','kpi_training_cost_profiles'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant select,insert,update,delete on public.%I to service_role',t); end loop; end $$;

revoke all on function public.kpi_training_is_finance_user(uuid) from public;
revoke all on function public.kpi_training_session_save_v2(text,uuid,text,text,uuid,timestamptz,timestamptz,text,text,text,text[],text[],text) from public;
revoke all on function public.kpi_training_session_decide(text,uuid,text,text) from public;
revoke all on function public.kpi_training_request_submit(text,text,text,text,text,text,text,text) from public;
revoke all on function public.kpi_training_request_decide(text,uuid,text,text,uuid) from public;
revoke all on function public.kpi_training_attendance_sign(text,uuid,text,text,text,text,text) from public;
revoke all on function public.kpi_training_finance_dashboard(text) from public;
revoke all on function public.kpi_training_finance_save(text,jsonb,jsonb,jsonb) from public;
revoke all on function public.kpi_training_worktime_events(text,date,date) from public;
revoke all on function public.kpi_site_presence_capacity_v9(text,date) from public;
grant execute on function public.kpi_training_session_save_v2(text,uuid,text,text,uuid,timestamptz,timestamptz,text,text,text,text[],text[],text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_session_decide(text,uuid,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_request_submit(text,text,text,text,text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_request_decide(text,uuid,text,text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_training_attendance_sign(text,uuid,text,text,text,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_finance_dashboard(text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_finance_save(text,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_training_worktime_events(text,date,date) to anon,authenticated,service_role;
grant execute on function public.kpi_site_presence_capacity_v9(text,date) to anon,authenticated,service_role;
