-- Configurable, versioned proration rules for the monthly bonus workflow.
-- Rules are snapshotted per workflow so an already closed month cannot be rewritten retroactively.

create table if not exists public.kpi_bonus_proration_rule_defaults (
  reason_code text primary key,
  label text not null,
  source_time_codes text[] not null default '{}'::text[],
  individual_mode text not null default 'inherit' check (individual_mode in ('inherit','ignore','prorate','suppress')),
  individual_threshold_days numeric(6,2) not null default 0 check (individual_threshold_days >= 0 and individual_threshold_days <= 31),
  collective_mode text not null default 'inherit' check (collective_mode in ('inherit','ignore','prorate','suppress')),
  collective_threshold_days numeric(6,2) not null default 0 check (collective_threshold_days >= 0 and collective_threshold_days <= 31),
  active boolean not null default true,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_bonus_workflow_proration_rules (
  workflow_id uuid not null references public.kpi_bonus_workflows(id) on delete cascade,
  reason_code text not null,
  label text not null,
  source_time_codes text[] not null default '{}'::text[],
  individual_mode text not null default 'inherit' check (individual_mode in ('inherit','ignore','prorate','suppress')),
  individual_threshold_days numeric(6,2) not null default 0 check (individual_threshold_days >= 0 and individual_threshold_days <= 31),
  collective_mode text not null default 'inherit' check (collective_mode in ('inherit','ignore','prorate','suppress')),
  collective_threshold_days numeric(6,2) not null default 0 check (collective_threshold_days >= 0 and collective_threshold_days <= 31),
  active boolean not null default true,
  source_revision integer not null default 1,
  updated_by text,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  primary key (workflow_id, reason_code)
);
create index if not exists kpi_bonus_workflow_proration_rules_workflow_idx on public.kpi_bonus_workflow_proration_rules(workflow_id, active);

create table if not exists public.kpi_bonus_proration_rule_audit (
  id bigint generated always as identity primary key,
  workflow_id uuid not null references public.kpi_bonus_workflows(id) on delete cascade,
  reason_code text not null,
  old_rule jsonb,
  new_rule jsonb not null,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists kpi_bonus_proration_rule_audit_workflow_idx on public.kpi_bonus_proration_rule_audit(workflow_id, changed_at desc);

alter table public.kpi_bonus_proration_rule_defaults enable row level security;
alter table public.kpi_bonus_workflow_proration_rules enable row level security;
alter table public.kpi_bonus_proration_rule_audit enable row level security;

insert into public.kpi_bonus_proration_rule_defaults(reason_code,label,source_time_codes,individual_mode,individual_threshold_days,collective_mode,collective_threshold_days,revision)
values
  ('paid_leave','CP / congé payé',array['A11'],'inherit',0,'inherit',0,1),
  ('rtt_recovery','RTT / récupération',array['A32','A4'],'inherit',0,'inherit',0,1),
  ('sick_received','Arrêt maladie - justificatif reçu',array['A3'],'inherit',0,'inherit',0,1),
  ('sick_pending','Arrêt maladie - justificatif en attente',array[]::text[],'inherit',0,'inherit',0,1),
  ('long_absence','Absence longue durée',array['A72'],'inherit',0,'inherit',0,1),
  ('work_accident','Accident travail / trajet',array['A6'],'inherit',0,'inherit',0,1),
  ('parental_leave','Congé parental',array['A71'],'inherit',0,'inherit',0,1),
  ('unpaid_leave','Congé sans solde',array['A41'],'inherit',0,'inherit',0,1),
  ('authorized_unpaid','Absence justifiée non rémunérée',array['A2'],'inherit',0,'inherit',0,1),
  ('authorized_paid','Absence autorisée rémunérée',array['A1'],'inherit',0,'inherit',0,1),
  ('family_leave','Événement familial',array['A7'],'inherit',0,'inherit',0,1),
  ('training','Formation',array['A33'],'inherit',0,'inherit',0,1),
  ('medical_visit','Visite médicale',array['VM'],'inherit',0,'inherit',0,1),
  ('pending_qualification','Absence à qualifier',array['A10'],'inherit',0,'inherit',0,1),
  ('therapeutic_part_time','Temps partiel thérapeutique',array['A30'],'inherit',0,'inherit',0,1),
  ('unjustified','Absence injustifiée (AI)',array['A13','A21'],'suppress',0,'suppress',0,1),
  ('late','Retard',array['A12'],'inherit',0,'inherit',0,1),
  ('late_night','Retard nuit',array['A18'],'inherit',0,'inherit',0,1),
  ('early_departure_night','Départ anticipé nuit',array['A19'],'inherit',0,'inherit',0,1),
  ('other','Autre événement',array[]::text[],'inherit',0,'inherit',0,1)
on conflict (reason_code) do update set
  label=excluded.label,
  source_time_codes=excluded.source_time_codes;

create or replace function public.kpi_bonus_ensure_proration_rules(p_workflow_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_status text;
begin
  select status into v_status from public.kpi_bonus_workflows where id=p_workflow_id;
  if v_status is null then raise exception 'Workflow introuvable.'; end if;
  if v_status in ('closed','legacy_closed') then return; end if;
  insert into public.kpi_bonus_workflow_proration_rules(workflow_id,reason_code,label,source_time_codes,individual_mode,individual_threshold_days,collective_mode,collective_threshold_days,active,source_revision)
  select p_workflow_id,reason_code,label,source_time_codes,individual_mode,individual_threshold_days,collective_mode,collective_threshold_days,active,revision
  from public.kpi_bonus_proration_rule_defaults
  on conflict (workflow_id,reason_code) do nothing;
end $$;

create or replace function public.kpi_bonus_proration_rules_read(p_session_hash text,p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_detail jsonb;
  v_status text;
  v_month date;
  v_can_configure boolean:=false;
  v_rules jsonb:='[]'::jsonb;
  v_audit jsonb:='[]'::jsonb;
  v_events jsonb:='[]'::jsonb;
begin
  v_detail:=public.kpi_bonus_get_workflow(p_session_hash,p_workflow_id);
  select * into a from public.kpi_bonus_actor(p_session_hash);
  select status,month into v_status,v_month from public.kpi_bonus_workflows where id=p_workflow_id;
  if v_status is null then raise exception 'Workflow introuvable.'; end if;
  v_can_configure:=coalesce(a.role='admin',false) or coalesce(a.access_profile='hr',false);
  perform public.kpi_bonus_ensure_proration_rules(p_workflow_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'reasonCode',r.reason_code,'label',r.label,'sourceTimeCodes',r.source_time_codes,
    'individualMode',r.individual_mode,'individualThresholdDays',r.individual_threshold_days,
    'collectiveMode',r.collective_mode,'collectiveThresholdDays',r.collective_threshold_days,
    'active',r.active,'sourceRevision',r.source_revision,'updatedByName',r.updated_by_name,'updatedAt',r.updated_at
  ) order by r.label),'[]'::jsonb) into v_rules
  from public.kpi_bonus_workflow_proration_rules r where r.workflow_id=p_workflow_id;

  select coalesce(jsonb_agg(x.item order by x.changed_at desc),'[]'::jsonb) into v_audit
  from (
    select a2.changed_at,jsonb_build_object('id',a2.id,'reasonCode',a2.reason_code,'oldRule',a2.old_rule,'newRule',a2.new_rule,'changedByName',a2.changed_by_name,'changedAt',a2.changed_at) item
    from public.kpi_bonus_proration_rule_audit a2 where a2.workflow_id=p_workflow_id order by a2.changed_at desc limit 50
  ) x;

  with allowed as (
    select nullif(c->>'employeeKey','') employee_key
    from jsonb_array_elements(coalesce(v_detail->'components','[]'::jsonb)) c
    where nullif(c->>'employeeKey','') is not null
  ), source_events as (
    select e.source_id::text id,e.employee_key,e.employee_name,e.event_kind,e.reason_code,e.start_date,e.end_date,e.duration_hours,e.justification_status,e.comment,e.created_by_name,e.created_at,e.source_type
    from public.kpi_worktime_rh_event_source e
    join allowed al on al.employee_key=e.employee_key
    where e.entity='CRVO'
      and e.start_date < (date_trunc('month',v_month)+interval '1 month')::date
      and e.end_date >= date_trunc('month',v_month)::date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'employeeKey',e.employee_key,'employeeName',e.employee_name,'kind',e.event_kind,'reason',e.reason_code,
    'startDate',e.start_date,'endDate',e.end_date,'durationHours',e.duration_hours,'justification',e.justification_status,
    'comment',e.comment,'createdBy',e.created_by_name,'createdAt',e.created_at,'source',coalesce(e.source_type,'data_rh')
  ) order by e.employee_name,e.start_date,e.reason_code),'[]'::jsonb) into v_events
  from source_events e;

  return jsonb_build_object(
    'workflowId',p_workflow_id,'month',to_char(v_month,'YYYY-MM'),'status',v_status,'legacy',v_status='legacy_closed',
    'canConfigure',v_can_configure,'rules',v_rules,'events',v_events,'audit',v_audit,
    'sources',jsonb_build_object('events','Data RH · kpi_worktime_rh_event_source','rules','Règles de proratisation figées dans le workflow mensuel','identity','Référentiel collaborateurs Data RH','calculation','Moteur KPI CRVO · calcul explicable par événement')
  );
end $$;

create or replace function public.kpi_bonus_proration_rule_update(
  p_session_hash text,p_workflow_id uuid,p_reason_code text,p_individual_mode text,p_individual_threshold_days numeric,p_collective_mode text,p_collective_threshold_days numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_status text;
  v_old jsonb;
  v_new jsonb;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if not (coalesce(a.role='admin',false) or coalesce(a.access_profile='hr',false)) then
    raise exception 'Paramétrage réservé aux administrateurs et aux RH.' using errcode='42501';
  end if;
  select status into v_status from public.kpi_bonus_workflows where id=p_workflow_id;
  if v_status is null then raise exception 'Workflow introuvable.'; end if;
  if v_status in ('closed','legacy_closed') then raise exception 'Workflow clôturé : les règles sont figées et non modifiables.'; end if;
  if p_individual_mode not in ('inherit','ignore','prorate','suppress') or p_collective_mode not in ('inherit','ignore','prorate','suppress') then raise exception 'Mode de proratisation invalide.'; end if;
  if coalesce(p_individual_threshold_days,0)<0 or coalesce(p_individual_threshold_days,0)>31 or coalesce(p_collective_threshold_days,0)<0 or coalesce(p_collective_threshold_days,0)>31 then raise exception 'Le seuil doit être compris entre 0 et 31 jours.'; end if;

  perform public.kpi_bonus_ensure_proration_rules(p_workflow_id);
  select to_jsonb(r) into v_old from public.kpi_bonus_workflow_proration_rules r where r.workflow_id=p_workflow_id and r.reason_code=p_reason_code;
  if v_old is null then raise exception 'Événement de proratisation inconnu.'; end if;

  update public.kpi_bonus_workflow_proration_rules as r
  set individual_mode=p_individual_mode,individual_threshold_days=coalesce(p_individual_threshold_days,0),collective_mode=p_collective_mode,collective_threshold_days=coalesce(p_collective_threshold_days,0),updated_by=a.user_id::text,updated_by_name=a.display_name,updated_at=now()
  where r.workflow_id=p_workflow_id and r.reason_code=p_reason_code
  returning to_jsonb(r) into v_new;

  insert into public.kpi_bonus_proration_rule_audit(workflow_id,reason_code,old_rule,new_rule,changed_by,changed_by_name)
  values(p_workflow_id,p_reason_code,v_old,v_new,a.user_id::text,a.display_name);
  return public.kpi_bonus_proration_rules_read(p_session_hash,p_workflow_id);
end $$;

revoke all on public.kpi_bonus_proration_rule_defaults from anon,authenticated;
revoke all on public.kpi_bonus_workflow_proration_rules from anon,authenticated;
revoke all on public.kpi_bonus_proration_rule_audit from anon,authenticated;
revoke all on function public.kpi_bonus_ensure_proration_rules(uuid) from public;
grant execute on function public.kpi_bonus_proration_rules_read(text,uuid) to anon,authenticated;
grant execute on function public.kpi_bonus_proration_rule_update(text,uuid,text,text,numeric,text,numeric) to anon,authenticated;
