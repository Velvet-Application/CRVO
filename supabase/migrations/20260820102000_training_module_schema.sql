-- Module Formation & Compétences carrosserie
-- Sécurisé par RPC + hash de session CRVO. Aucune table n'est exposée directement au navigateur.

create table if not exists public.kpi_training_tracks (
  key text primary key,
  label text not null,
  family text not null default 'carrosserie',
  level_label text,
  description text,
  source_label text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_training_blocks (
  key text primary key,
  track_key text not null references public.kpi_training_tracks(key) on delete cascade,
  code text not null,
  label text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(track_key, code)
);

create table if not exists public.kpi_training_skills (
  id uuid primary key default gen_random_uuid(),
  skill_key text not null unique,
  track_key text not null references public.kpi_training_tracks(key) on delete cascade,
  block_key text not null references public.kpi_training_blocks(key) on delete cascade,
  label text not null,
  indicator text,
  source_ref text,
  sort_order integer not null default 0,
  max_score numeric(4,2) not null default 3 check(max_score > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.kpi_training_trainers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  user_id uuid unique references public.crvo_auth_users(id) on delete set null,
  specialty text not null default 'Carrosserie',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_training_plans (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null,
  employee_name text not null,
  matricule text,
  team_code text,
  service text,
  track_key text not null references public.kpi_training_tracks(key),
  status text not null default 'to_plan' check(status in ('to_plan','planned','in_progress','completed','on_hold','cancelled')),
  priority text not null default 'normal' check(priority in ('critical','high','normal','low')),
  target_date date,
  objective text,
  trainer_id uuid references public.kpi_training_trainers(id) on delete set null,
  created_by uuid references public.crvo_auth_users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists kpi_training_plans_employee_idx on public.kpi_training_plans(employee_key, status);
create index if not exists kpi_training_plans_track_idx on public.kpi_training_plans(track_key, status);

create table if not exists public.kpi_training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  track_key text not null references public.kpi_training_tracks(key),
  trainer_id uuid references public.kpi_training_trainers(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'planned' check(status in ('planned','completed','cancelled')),
  location text,
  objective text,
  focus_skill_keys text[] not null default array[]::text[],
  notes text,
  created_by uuid references public.crvo_auth_users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_at > start_at)
);
create index if not exists kpi_training_sessions_start_idx on public.kpi_training_sessions(start_at desc);

create table if not exists public.kpi_training_session_attendees (
  session_id uuid not null references public.kpi_training_sessions(id) on delete cascade,
  employee_key text not null,
  employee_name text not null,
  matricule text,
  team_code text,
  service text,
  status text not null default 'planned' check(status in ('planned','attended','absent','cancelled')),
  pre_evaluation_id uuid,
  post_evaluation_id uuid,
  note text,
  primary key(session_id, employee_key)
);
create index if not exists kpi_training_attendees_employee_idx on public.kpi_training_session_attendees(employee_key, session_id);

create table if not exists public.kpi_training_evaluations (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null,
  employee_name text not null,
  matricule text,
  team_code text,
  service text,
  track_key text not null references public.kpi_training_tracks(key),
  evaluation_date date not null default current_date,
  kind text not null default 'checkpoint' check(kind in ('baseline','checkpoint','post_training','final')),
  session_id uuid references public.kpi_training_sessions(id) on delete set null,
  overall_score numeric(7,3),
  overall_pct numeric(7,4),
  pilotage_level text,
  summary text,
  evaluator_user_id uuid references public.crvo_auth_users(id) on delete set null,
  evaluator_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kpi_training_eval_employee_idx on public.kpi_training_evaluations(employee_key, track_key, evaluation_date desc, created_at desc);

alter table public.kpi_training_session_attendees
  drop constraint if exists kpi_training_session_attendees_pre_evaluation_id_fkey;
alter table public.kpi_training_session_attendees
  add constraint kpi_training_session_attendees_pre_evaluation_id_fkey foreign key(pre_evaluation_id) references public.kpi_training_evaluations(id) on delete set null;
alter table public.kpi_training_session_attendees
  drop constraint if exists kpi_training_session_attendees_post_evaluation_id_fkey;
alter table public.kpi_training_session_attendees
  add constraint kpi_training_session_attendees_post_evaluation_id_fkey foreign key(post_evaluation_id) references public.kpi_training_evaluations(id) on delete set null;

create table if not exists public.kpi_training_evaluation_items (
  evaluation_id uuid not null references public.kpi_training_evaluations(id) on delete cascade,
  skill_id uuid not null references public.kpi_training_skills(id) on delete restrict,
  score numeric(4,2) not null check(score >= 0 and score <= 3),
  observation text,
  primary key(evaluation_id, skill_id)
);

create table if not exists public.kpi_training_observations (
  id uuid primary key default gen_random_uuid(),
  employee_key text not null,
  employee_name text not null,
  category text not null default 'observation' check(category in ('observation','progress','alert','action','feedback')),
  content text not null,
  session_id uuid references public.kpi_training_sessions(id) on delete set null,
  track_key text references public.kpi_training_tracks(key) on delete set null,
  created_by uuid references public.crvo_auth_users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists kpi_training_observations_employee_idx on public.kpi_training_observations(employee_key, created_at desc);

create table if not exists public.kpi_training_legacy_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_sheet text not null,
  employee_key text,
  employee_name text not null,
  team_label text,
  track_key text not null references public.kpi_training_tracks(key),
  block_scores jsonb not null default '{}'::jsonb,
  overall_points numeric(8,2),
  overall_pct numeric(7,4),
  legacy_status text,
  comments text,
  source_evaluation_date date,
  imported_at timestamptz not null default now(),
  unique(source_sheet, employee_name, track_key)
);
create index if not exists kpi_training_legacy_employee_idx on public.kpi_training_legacy_snapshots(employee_key, track_key);

create table if not exists public.kpi_training_audit (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_user_id uuid references public.crvo_auth_users(id) on delete set null,
  actor_name text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists kpi_training_audit_entity_idx on public.kpi_training_audit(entity_type, entity_id, created_at desc);

create or replace function public.kpi_training_normalize_name(p_value text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_value,'')),
      'àáâäãåçéèêëíìîïñóòôöõúùûüýÿ',
      'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9]+',' ','g'));
$$;

create or replace function public.kpi_training_access_context(p_session_hash text)
returns table(user_id uuid, display_name text, role text, access_profile text, can_edit boolean, can_admin boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.id,u.display_name,u.role,coalesce(u.access_profile,'custom'),true,(u.role='admin')
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active=true
    and (u.role='admin' or u.access_profile in ('service_manager','hr','trainer'))
  limit 1;
$$;

create or replace function public.kpi_training_dashboard(p_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  ctx record;
  result jsonb;
begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);
  if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501'; end if;

  select jsonb_build_object(
    'access',jsonb_build_object('userId',ctx.user_id,'displayName',ctx.display_name,'profile',ctx.access_profile,'canEdit',ctx.can_edit,'canAdmin',ctx.can_admin),
    'people',coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeKey',p.employee_key,'employeeName',p.employee_name,'matricule',p.matricule,
        'team',p.team_code,'service',p.service
      ) order by p.team_code nulls last,p.service,p.employee_name)
      from public.kpi_worktime_population_for_date(current_date) p
      where p.sector_key='carrosserie'
    ),'[]'::jsonb),
    'tracks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'key',t.key,'label',t.label,'levelLabel',t.level_label,'description',t.description,'sourceLabel',t.source_label,'sortOrder',t.sort_order,
        'blocks',coalesce((select jsonb_agg(jsonb_build_object(
          'key',b.key,'code',b.code,'label',b.label,'description',b.description,'sortOrder',b.sort_order,
          'skills',coalesce((select jsonb_agg(jsonb_build_object(
            'id',s.id,'skillKey',s.skill_key,'label',s.label,'indicator',s.indicator,'sourceRef',s.source_ref,'sortOrder',s.sort_order
          ) order by s.sort_order,s.label) from public.kpi_training_skills s where s.block_key=b.key and s.active),'[]'::jsonb)
        ) order by b.sort_order,b.code) from public.kpi_training_blocks b where b.track_key=t.key),'[]'::jsonb)
      ) order by t.sort_order,t.label) from public.kpi_training_tracks t where t.active
    ),'[]'::jsonb),
    'trainers',coalesce((select jsonb_agg(jsonb_build_object('id',tr.id,'displayName',tr.display_name,'specialty',tr.specialty,'active',tr.active,'userId',tr.user_id,'notes',tr.notes) order by tr.active desc,tr.display_name) from public.kpi_training_trainers tr),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pl.id,'employeeKey',pl.employee_key,'employeeName',pl.employee_name,'matricule',pl.matricule,'team',pl.team_code,'service',pl.service,
      'trackKey',pl.track_key,'status',pl.status,'priority',pl.priority,'targetDate',pl.target_date,'objective',pl.objective,
      'trainerId',pl.trainer_id,'trainerName',tr.display_name,'createdByName',pl.created_by_name,'createdAt',pl.created_at,'updatedAt',pl.updated_at
    ) order by case pl.priority when 'critical' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,pl.target_date nulls last,pl.updated_at desc)
      from public.kpi_training_plans pl left join public.kpi_training_trainers tr on tr.id=pl.trainer_id
      where pl.status not in ('cancelled')),'[]'::jsonb),
    'evaluations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'employeeKey',e.employee_key,'employeeName',e.employee_name,'trackKey',e.track_key,'evaluationDate',e.evaluation_date,
      'kind',e.kind,'sessionId',e.session_id,'overallScore',e.overall_score,'overallPct',e.overall_pct,'pilotageLevel',e.pilotage_level,
      'summary',e.summary,'evaluatorName',e.evaluator_name,'createdAt',e.created_at
    ) order by e.evaluation_date desc,e.created_at desc) from public.kpi_training_evaluations e),'[]'::jsonb),
    'legacySnapshots',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.id,'employeeKey',l.employee_key,'employeeName',l.employee_name,'teamLabel',l.team_label,'trackKey',l.track_key,
      'blockScores',l.block_scores,'overallPoints',l.overall_points,'overallPct',l.overall_pct,'legacyStatus',l.legacy_status,'comments',l.comments,
      'sourceSheet',l.source_sheet,'sourceEvaluationDate',l.source_evaluation_date,'importedAt',l.imported_at
    ) order by l.employee_name,l.track_key) from public.kpi_training_legacy_snapshots l),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',se.id,'title',se.title,'trackKey',se.track_key,'trainerId',se.trainer_id,'trainerName',tr.display_name,'startAt',se.start_at,'endAt',se.end_at,
      'status',se.status,'location',se.location,'objective',se.objective,'focusSkillKeys',se.focus_skill_keys,'notes',se.notes,
      'participants',coalesce((select jsonb_agg(jsonb_build_object('employeeKey',a.employee_key,'employeeName',a.employee_name,'status',a.status,'preEvaluationId',a.pre_evaluation_id,'postEvaluationId',a.post_evaluation_id) order by a.employee_name) from public.kpi_training_session_attendees a where a.session_id=se.id),'[]'::jsonb)
    ) order by se.start_at desc) from public.kpi_training_sessions se left join public.kpi_training_trainers tr on tr.id=se.trainer_id where se.start_at >= now()-interval '6 months'),'[]'::jsonb),
    'observations',coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'employeeKey',o.employee_key,'employeeName',o.employee_name,'category',o.category,'content',o.content,'sessionId',o.session_id,'trackKey',o.track_key,'createdByName',o.created_by_name,'createdAt',o.created_at
    ) order by o.created_at desc) from (select * from public.kpi_training_observations order by created_at desc limit 250) o),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.kpi_training_employee_detail(p_session_hash text,p_employee_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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
      'id',e.id,'trackKey',e.track_key,'evaluationDate',e.evaluation_date,'kind',e.kind,'sessionId',e.session_id,'overallScore',e.overall_score,'overallPct',e.overall_pct,'pilotageLevel',e.pilotage_level,'summary',e.summary,'evaluatorName',e.evaluator_name,'createdAt',e.created_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object('skillId',i.skill_id,'skillKey',s.skill_key,'skillLabel',s.label,'blockKey',s.block_key,'score',i.score,'observation',i.observation) order by b.sort_order,s.sort_order) from public.kpi_training_evaluation_items i join public.kpi_training_skills s on s.id=i.skill_id join public.kpi_training_blocks b on b.key=s.block_key where i.evaluation_id=e.id),'[]'::jsonb)
    ) order by e.evaluation_date desc,e.created_at desc) from public.kpi_training_evaluations e where e.employee_key=p_employee_key),'[]'::jsonb),
    'legacySnapshots',coalesce((select jsonb_agg(to_jsonb(l) order by l.track_key) from public.kpi_training_legacy_snapshots l where l.employee_key=p_employee_key),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',pl.id,'trackKey',pl.track_key,'status',pl.status,'priority',pl.priority,'targetDate',pl.target_date,'objective',pl.objective,'trainerId',pl.trainer_id,'trainerName',tr.display_name,'createdByName',pl.created_by_name,'createdAt',pl.created_at,'updatedAt',pl.updated_at) order by pl.updated_at desc) from public.kpi_training_plans pl left join public.kpi_training_trainers tr on tr.id=pl.trainer_id where pl.employee_key=p_employee_key),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',se.id,'title',se.title,'trackKey',se.track_key,'startAt',se.start_at,'endAt',se.end_at,'status',se.status,'trainerName',tr.display_name,'attendeeStatus',a.status,'preEvaluationId',a.pre_evaluation_id,'postEvaluationId',a.post_evaluation_id) order by se.start_at desc) from public.kpi_training_session_attendees a join public.kpi_training_sessions se on se.id=a.session_id left join public.kpi_training_trainers tr on tr.id=se.trainer_id where a.employee_key=p_employee_key),'[]'::jsonb),
    'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'category',o.category,'content',o.content,'sessionId',o.session_id,'trackKey',o.track_key,'createdByName',o.created_by_name,'createdAt',o.created_at) order by o.created_at desc) from public.kpi_training_observations o where o.employee_key=p_employee_key),'[]'::jsonb)
  );
end;
$$;

create or replace function public.kpi_training_plan_upsert(
  p_session_hash text,p_plan_id uuid,p_employee_key text,p_track_key text,p_status text,p_priority text,p_target_date date,p_objective text,p_trainer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare ctx record; person record; rid uuid;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501';end if;
  select * into person from public.kpi_worktime_population_for_date(current_date) p where p.employee_key=p_employee_key and p.sector_key='carrosserie' limit 1;
  if person.employee_key is null then raise exception 'employee_not_found';end if;
  if not exists(select 1 from public.kpi_training_tracks where key=p_track_key and active) then raise exception 'track_not_found';end if;
  if coalesce(p_status,'') not in ('to_plan','planned','in_progress','completed','on_hold','cancelled') then raise exception 'invalid_status';end if;
  if coalesce(p_priority,'') not in ('critical','high','normal','low') then raise exception 'invalid_priority';end if;
  if p_plan_id is null then
    insert into public.kpi_training_plans(employee_key,employee_name,matricule,team_code,service,track_key,status,priority,target_date,objective,trainer_id,created_by,created_by_name,closed_at)
    values(person.employee_key,person.employee_name,person.matricule,person.team_code,person.service,p_track_key,p_status,p_priority,p_target_date,nullif(trim(p_objective),''),p_trainer_id,ctx.user_id,ctx.display_name,case when p_status in ('completed','cancelled') then now() end)
    returning id into rid;
  else
    update public.kpi_training_plans set track_key=p_track_key,status=p_status,priority=p_priority,target_date=p_target_date,objective=nullif(trim(p_objective),''),trainer_id=p_trainer_id,updated_at=now(),closed_at=case when p_status in ('completed','cancelled') then coalesce(closed_at,now()) else null end
    where id=p_plan_id returning id into rid;
    if rid is null then raise exception 'plan_not_found';end if;
  end if;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('plan',rid::text,case when p_plan_id is null then 'created' else 'updated' end,ctx.user_id,ctx.display_name,jsonb_build_object('employeeKey',person.employee_key,'trackKey',p_track_key,'status',p_status,'priority',p_priority,'targetDate',p_target_date,'objective',p_objective,'trainerId',p_trainer_id));
  return jsonb_build_object('ok',true,'id',rid);
end;$$;

create or replace function public.kpi_training_session_save(
  p_session_hash text,p_training_session_id uuid,p_title text,p_track_key text,p_trainer_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_status text,p_location text,p_objective text,p_focus_skill_keys text[],p_participant_keys text[],p_notes text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare ctx record;rid uuid;part text;person record;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501';end if;
  if nullif(trim(p_title),'') is null then raise exception 'title_required';end if;
  if p_end_at<=p_start_at then raise exception 'invalid_period';end if;
  if coalesce(p_status,'') not in ('planned','completed','cancelled') then raise exception 'invalid_status';end if;
  if not exists(select 1 from public.kpi_training_tracks where key=p_track_key and active) then raise exception 'track_not_found';end if;
  if p_training_session_id is null then
    insert into public.kpi_training_sessions(title,track_key,trainer_id,start_at,end_at,status,location,objective,focus_skill_keys,notes,created_by,created_by_name)
    values(trim(p_title),p_track_key,p_trainer_id,p_start_at,p_end_at,p_status,nullif(trim(p_location),''),nullif(trim(p_objective),''),coalesce(p_focus_skill_keys,array[]::text[]),nullif(trim(p_notes),''),ctx.user_id,ctx.display_name) returning id into rid;
  else
    update public.kpi_training_sessions set title=trim(p_title),track_key=p_track_key,trainer_id=p_trainer_id,start_at=p_start_at,end_at=p_end_at,status=p_status,location=nullif(trim(p_location),''),objective=nullif(trim(p_objective),''),focus_skill_keys=coalesce(p_focus_skill_keys,array[]::text[]),notes=nullif(trim(p_notes),''),updated_at=now() where id=p_training_session_id returning id into rid;
    if rid is null then raise exception 'session_not_found';end if;
    delete from public.kpi_training_session_attendees where session_id=rid;
  end if;
  foreach part in array coalesce(p_participant_keys,array[]::text[]) loop
    select * into person from public.kpi_worktime_population_for_date(current_date) p where p.employee_key=part and p.sector_key='carrosserie' limit 1;
    if person.employee_key is not null then insert into public.kpi_training_session_attendees(session_id,employee_key,employee_name,matricule,team_code,service) values(rid,person.employee_key,person.employee_name,person.matricule,person.team_code,person.service) on conflict do nothing;end if;
  end loop;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('session',rid::text,case when p_training_session_id is null then 'created' else 'updated' end,ctx.user_id,ctx.display_name,jsonb_build_object('title',p_title,'trackKey',p_track_key,'trainerId',p_trainer_id,'startAt',p_start_at,'endAt',p_end_at,'status',p_status,'participants',p_participant_keys));
  return jsonb_build_object('ok',true,'id',rid);
end;$$;

create or replace function public.kpi_training_evaluation_save(
  p_session_hash text,p_employee_key text,p_track_key text,p_evaluation_date date,p_kind text,p_training_session_id uuid,p_summary text,p_scores jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare ctx record;person record;rid uuid;entry jsonb;sid uuid;score_value numeric;avg_score numeric;pct numeric;level text;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501';end if;
  select * into person from public.kpi_worktime_population_for_date(current_date) p where p.employee_key=p_employee_key and p.sector_key='carrosserie' limit 1;if person.employee_key is null then raise exception 'employee_not_found';end if;
  if coalesce(p_kind,'') not in ('baseline','checkpoint','post_training','final') then raise exception 'invalid_kind';end if;
  if not jsonb_typeof(coalesce(p_scores,'[]'::jsonb))='array' then raise exception 'invalid_scores';end if;
  insert into public.kpi_training_evaluations(employee_key,employee_name,matricule,team_code,service,track_key,evaluation_date,kind,session_id,summary,evaluator_user_id,evaluator_name)
  values(person.employee_key,person.employee_name,person.matricule,person.team_code,person.service,p_track_key,coalesce(p_evaluation_date,current_date),p_kind,p_training_session_id,nullif(trim(p_summary),''),ctx.user_id,ctx.display_name) returning id into rid;
  for entry in select * from jsonb_array_elements(coalesce(p_scores,'[]'::jsonb)) loop
    begin sid:=(entry->>'skillId')::uuid;exception when others then sid:=null;end;
    begin score_value:=(entry->>'score')::numeric;exception when others then score_value:=null;end;
    if sid is not null and score_value between 0 and 3 and exists(select 1 from public.kpi_training_skills s where s.id=sid and s.track_key=p_track_key and s.active) then
      insert into public.kpi_training_evaluation_items(evaluation_id,skill_id,score,observation) values(rid,sid,score_value,nullif(trim(entry->>'observation'),''));
    end if;
  end loop;
  select avg(i.score),avg(i.score)/3 into avg_score,pct from public.kpi_training_evaluation_items i where i.evaluation_id=rid;
  if avg_score is null then delete from public.kpi_training_evaluations where id=rid;raise exception 'at_least_one_score_required';end if;
  level:=case when pct<0.50 then 'Débutant' when pct<0.67 then 'En progression' when pct<0.84 then 'Opérationnel' else 'Autonome' end;
  update public.kpi_training_evaluations set overall_score=avg_score,overall_pct=pct,pilotage_level=level where id=rid;
  if p_training_session_id is not null then
    if p_kind in ('baseline','checkpoint') then update public.kpi_training_session_attendees set pre_evaluation_id=rid where session_id=p_training_session_id and employee_key=p_employee_key;
    elsif p_kind in ('post_training','final') then update public.kpi_training_session_attendees set post_evaluation_id=rid,status='attended' where session_id=p_training_session_id and employee_key=p_employee_key;end if;
  end if;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('evaluation',rid::text,'created',ctx.user_id,ctx.display_name,jsonb_build_object('employeeKey',person.employee_key,'trackKey',p_track_key,'kind',p_kind,'evaluationDate',p_evaluation_date,'overallScore',avg_score,'overallPct',pct,'pilotageLevel',level,'sessionId',p_training_session_id));
  return jsonb_build_object('ok',true,'id',rid,'overallScore',avg_score,'overallPct',pct,'pilotageLevel',level);
end;$$;

create or replace function public.kpi_training_observation_add(
  p_session_hash text,p_employee_key text,p_category text,p_content text,p_track_key text,p_training_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare ctx record;person record;rid uuid;begin
  select * into ctx from public.kpi_training_access_context(p_session_hash);if ctx.user_id is null then raise exception 'training_forbidden' using errcode='42501';end if;
  select * into person from public.kpi_worktime_population_for_date(current_date) p where p.employee_key=p_employee_key and p.sector_key='carrosserie' limit 1;if person.employee_key is null then raise exception 'employee_not_found';end if;
  if coalesce(p_category,'') not in ('observation','progress','alert','action','feedback') then raise exception 'invalid_category';end if;
  if nullif(trim(p_content),'') is null then raise exception 'content_required';end if;
  insert into public.kpi_training_observations(employee_key,employee_name,category,content,session_id,track_key,created_by,created_by_name) values(person.employee_key,person.employee_name,p_category,trim(p_content),p_training_session_id,p_track_key,ctx.user_id,ctx.display_name) returning id into rid;
  insert into public.kpi_training_audit(entity_type,entity_id,action,actor_user_id,actor_name,snapshot) values('observation',rid::text,'created',ctx.user_id,ctx.display_name,jsonb_build_object('employeeKey',person.employee_key,'category',p_category,'content',p_content,'trackKey',p_track_key,'sessionId',p_training_session_id));
  return jsonb_build_object('ok',true,'id',rid);
end;$$;

-- RLS / exposition directe : fermé. Les lectures et écritures passent exclusivement par les RPC ci-dessus.
do $$
declare t text;begin
  foreach t in array array['kpi_training_tracks','kpi_training_blocks','kpi_training_skills','kpi_training_trainers','kpi_training_plans','kpi_training_sessions','kpi_training_session_attendees','kpi_training_evaluations','kpi_training_evaluation_items','kpi_training_observations','kpi_training_legacy_snapshots','kpi_training_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end$$;
grant usage,select on sequence public.kpi_training_audit_id_seq to service_role;

revoke all on function public.kpi_training_access_context(text) from public;
revoke all on function public.kpi_training_dashboard(text) from public;
revoke all on function public.kpi_training_employee_detail(text,text) from public;
revoke all on function public.kpi_training_plan_upsert(text,uuid,text,text,text,text,date,text,uuid) from public;
revoke all on function public.kpi_training_session_save(text,uuid,text,text,uuid,timestamptz,timestamptz,text,text,text,text[],text[],text) from public;
revoke all on function public.kpi_training_evaluation_save(text,text,text,date,text,uuid,text,jsonb) from public;
revoke all on function public.kpi_training_observation_add(text,text,text,text,text,uuid) from public;

grant execute on function public.kpi_training_access_context(text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_dashboard(text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_employee_detail(text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_plan_upsert(text,uuid,text,text,text,text,date,text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_training_session_save(text,uuid,text,text,uuid,timestamptz,timestamptz,text,text,text,text[],text[],text) to anon,authenticated,service_role;
grant execute on function public.kpi_training_evaluation_save(text,text,text,date,text,uuid,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_training_observation_add(text,text,text,text,text,uuid) to anon,authenticated,service_role;
