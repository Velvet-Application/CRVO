-- Global policy for future bonus workflows + complete event lineage.

alter table public.kpi_bonus_proration_rule_defaults
  add column if not exists updated_by text,
  add column if not exists updated_by_name text;

insert into public.kpi_bonus_proration_rule_defaults(reason_code,label,source_time_codes,individual_mode,individual_threshold_days,collective_mode,collective_threshold_days,revision)
values ('authorized','Absence autorisée',array[]::text[],'inherit',0,'inherit',0,1)
on conflict (reason_code) do nothing;

create table if not exists public.kpi_bonus_proration_default_rule_audit (
  id bigint generated always as identity primary key,
  reason_code text not null,
  old_rule jsonb,
  new_rule jsonb not null,
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists kpi_bonus_proration_default_rule_audit_changed_idx on public.kpi_bonus_proration_default_rule_audit(changed_at desc);
alter table public.kpi_bonus_proration_default_rule_audit enable row level security;
revoke all on public.kpi_bonus_proration_default_rule_audit from anon,authenticated;

create or replace function public.kpi_bonus_proration_defaults_read(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_rules jsonb:='[]'::jsonb;
  v_audit jsonb:='[]'::jsonb;
  v_can_configure boolean:=false;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  v_can_configure:=coalesce(a.role='admin',false) or coalesce(a.access_profile='hr',false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'reasonCode',r.reason_code,'label',r.label,'sourceTimeCodes',r.source_time_codes,
    'individualMode',r.individual_mode,'individualThresholdDays',r.individual_threshold_days,
    'collectiveMode',r.collective_mode,'collectiveThresholdDays',r.collective_threshold_days,
    'active',r.active,'sourceRevision',r.revision,'updatedByName',r.updated_by_name,'updatedAt',r.updated_at
  ) order by r.label),'[]'::jsonb) into v_rules
  from public.kpi_bonus_proration_rule_defaults r;

  select coalesce(jsonb_agg(x.item order by x.changed_at desc),'[]'::jsonb) into v_audit
  from (
    select a2.changed_at,jsonb_build_object('id',a2.id,'reasonCode',a2.reason_code,'oldRule',a2.old_rule,'newRule',a2.new_rule,'changedByName',a2.changed_by_name,'changedAt',a2.changed_at) item
    from public.kpi_bonus_proration_default_rule_audit a2 order by a2.changed_at desc limit 50
  ) x;

  return jsonb_build_object(
    'workflowId','__defaults__','month',null,'status','defaults','legacy',false,'canConfigure',v_can_configure,
    'rules',v_rules,'events','[]'::jsonb,'audit',v_audit,
    'sources',jsonb_build_object(
      'events','Data RH + Temps de travail (appliqué lors du calcul mensuel)',
      'rules','Politique RH par défaut · copiée et figée à l’ouverture de chaque workflow',
      'identity','Référentiel collaborateurs Data RH',
      'calculation','Moteur KPI CRVO · calcul explicable par événement'
    )
  );
end $$;

create or replace function public.kpi_bonus_proration_default_rule_update(
  p_session_hash text,
  p_reason_code text,
  p_individual_mode text,
  p_individual_threshold_days numeric,
  p_collective_mode text,
  p_collective_threshold_days numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_old jsonb;
  v_new jsonb;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if not (coalesce(a.role='admin',false) or coalesce(a.access_profile='hr',false)) then
    raise exception 'Paramétrage réservé aux administrateurs et aux RH.' using errcode='42501';
  end if;
  if p_individual_mode not in ('inherit','ignore','prorate','suppress') or p_collective_mode not in ('inherit','ignore','prorate','suppress') then raise exception 'Mode de proratisation invalide.'; end if;
  if coalesce(p_individual_threshold_days,0)<0 or coalesce(p_individual_threshold_days,0)>31 or coalesce(p_collective_threshold_days,0)<0 or coalesce(p_collective_threshold_days,0)>31 then raise exception 'Le seuil doit être compris entre 0 et 31 jours.'; end if;

  select to_jsonb(r) into v_old from public.kpi_bonus_proration_rule_defaults r where r.reason_code=p_reason_code;
  if v_old is null then raise exception 'Événement de proratisation inconnu.'; end if;

  update public.kpi_bonus_proration_rule_defaults as r
  set individual_mode=p_individual_mode,
      individual_threshold_days=coalesce(p_individual_threshold_days,0),
      collective_mode=p_collective_mode,
      collective_threshold_days=coalesce(p_collective_threshold_days,0),
      revision=r.revision+1,
      updated_by=a.user_id::text,
      updated_by_name=a.display_name,
      updated_at=now()
  where r.reason_code=p_reason_code
  returning to_jsonb(r) into v_new;

  insert into public.kpi_bonus_proration_default_rule_audit(reason_code,old_rule,new_rule,changed_by,changed_by_name)
  values(p_reason_code,v_old,v_new,a.user_id::text,a.display_name);
  return public.kpi_bonus_proration_defaults_read(p_session_hash);
end $$;

-- Rebuild the reader so manual worktime corrections take precedence over direct Data RH events
-- when both overlap the same employee/date/kind. This mirrors the Worktime dashboard behavior.
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
  ), manual_events as (
    select m.id::text id,m.employee_key,m.employee_name,m.event_kind,m.reason_code,m.start_date,m.end_date,
           null::numeric duration_hours,m.justification_status,m.comment,m.created_by_name,m.created_at,'manual'::text source_type
    from public.kpi_worktime_events m
    join allowed al on al.employee_key=m.employee_key
    where m.entity='CRVO'
      and coalesce(m.status,'open')<>'cancelled'
      and m.start_date < (date_trunc('month',v_month)+interval '1 month')::date
      and m.end_date >= date_trunc('month',v_month)::date
  ), rh_events as (
    select e.source_id::text id,e.employee_key,e.employee_name,e.event_kind,e.reason_code,e.start_date,e.end_date,
           e.duration_hours,e.justification_status,e.comment,e.created_by_name,e.created_at,e.source_type
    from public.kpi_worktime_rh_event_source e
    join allowed al on al.employee_key=e.employee_key
    where e.entity='CRVO'
      and e.start_date < (date_trunc('month',v_month)+interval '1 month')::date
      and e.end_date >= date_trunc('month',v_month)::date
      and not exists (
        select 1 from manual_events m
        where m.employee_key=e.employee_key
          and m.event_kind=e.event_kind
          and m.start_date<=e.end_date
          and m.end_date>=e.start_date
      )
  ), source_events as (
    select * from manual_events
    union all
    select * from rh_events
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
    'sources',jsonb_build_object(
      'events','Data RH + Temps de travail · correction manuelle prioritaire en cas de chevauchement',
      'rules','Règles de proratisation figées dans le workflow mensuel',
      'identity','Référentiel collaborateurs Data RH',
      'calculation','Moteur KPI CRVO · calcul explicable par événement'
    )
  );
end $$;

revoke all on function public.kpi_bonus_proration_defaults_read(text) from public;
revoke all on function public.kpi_bonus_proration_default_rule_update(text,text,text,numeric,text,numeric) from public;
grant execute on function public.kpi_bonus_proration_defaults_read(text) to anon,authenticated;
grant execute on function public.kpi_bonus_proration_default_rule_update(text,text,text,numeric,text,numeric) to anon,authenticated;
