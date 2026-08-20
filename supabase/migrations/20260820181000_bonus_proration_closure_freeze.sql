-- Freeze the complete RH/rule evidence used for a monthly bonus calculation.
-- A closed workflow must remain reproducible even if Data RH is corrected later.

create table if not exists public.kpi_bonus_proration_freezes (
  workflow_id uuid primary key references public.kpi_bonus_workflows(id) on delete cascade,
  rules_snapshot jsonb not null default '[]'::jsonb,
  events_snapshot jsonb not null default '[]'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  calculation_hash text not null,
  total_payroll_eur numeric(14,2),
  impact_eur numeric(14,2),
  frozen_by uuid,
  frozen_by_name text,
  frozen_at timestamptz not null default now()
);
alter table public.kpi_bonus_proration_freezes enable row level security;
revoke all on public.kpi_bonus_proration_freezes from anon,authenticated;

create or replace function public.kpi_bonus_proration_freeze_workflow(
  p_session_hash text,
  p_workflow_id uuid,
  p_context jsonb,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_status text;
  v_total numeric;
  v_before numeric;
  v_impact numeric;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null or not coalesce(a.can_manage,false) then
    raise exception 'Seule la Direction autorisée peut figer le calcul de prime.' using errcode='42501';
  end if;
  select status into v_status from public.kpi_bonus_workflows where id=p_workflow_id;
  if v_status is null then raise exception 'Workflow introuvable.'; end if;
  if v_status in ('closed','legacy_closed') then raise exception 'Workflow déjà clôturé.'; end if;
  if p_context is null or jsonb_typeof(p_context)<>'object' then raise exception 'Contexte de proratisation invalide.'; end if;
  if nullif(p_context->>'workflowId','') is distinct from p_workflow_id::text then raise exception 'Le contexte ne correspond pas au workflow.'; end if;
  if nullif(btrim(p_hash),'') is null or length(p_hash)<32 then raise exception 'Empreinte de proratisation invalide.'; end if;

  select coalesce(sum(nullif(c->>'totalAfterEur','')::numeric),0),
         coalesce(sum(nullif(c->>'totalBeforeEur','')::numeric),0)
  into v_total,v_before
  from jsonb_array_elements(coalesce(p_context->'components','[]'::jsonb)) c;
  v_impact:=round(v_total-v_before,2);

  insert into public.kpi_bonus_proration_freezes(
    workflow_id,rules_snapshot,events_snapshot,context_snapshot,calculation_hash,total_payroll_eur,impact_eur,frozen_by,frozen_by_name,frozen_at
  ) values(
    p_workflow_id,coalesce(p_context->'rules','[]'::jsonb),coalesce(p_context->'events','[]'::jsonb),p_context,btrim(p_hash),round(v_total,2),v_impact,a.user_id,a.display_name,now()
  )
  on conflict(workflow_id) do update set
    rules_snapshot=excluded.rules_snapshot,
    events_snapshot=excluded.events_snapshot,
    context_snapshot=excluded.context_snapshot,
    calculation_hash=excluded.calculation_hash,
    total_payroll_eur=excluded.total_payroll_eur,
    impact_eur=excluded.impact_eur,
    frozen_by=excluded.frozen_by,
    frozen_by_name=excluded.frozen_by_name,
    frozen_at=excluded.frozen_at;

  return jsonb_build_object('ok',true,'hash',btrim(p_hash),'totalPayrollEur',round(v_total,2),'impactEur',v_impact);
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
  v_freeze public.kpi_bonus_proration_freezes%rowtype;
begin
  v_detail:=public.kpi_bonus_get_workflow(p_session_hash,p_workflow_id);
  select * into a from public.kpi_bonus_actor(p_session_hash);
  select status,month into v_status,v_month from public.kpi_bonus_workflows where id=p_workflow_id;
  if v_status is null then raise exception 'Workflow introuvable.'; end if;
  v_can_configure:=coalesce(a.role='admin',false) or coalesce(a.access_profile='hr',false);
  select * into v_freeze from public.kpi_bonus_proration_freezes where workflow_id=p_workflow_id;

  if v_status in ('closed','legacy_closed') and v_freeze.workflow_id is not null then
    return jsonb_build_object(
      'workflowId',p_workflow_id,
      'month',to_char(v_month,'YYYY-MM'),
      'status',v_status,
      'legacy',v_status='legacy_closed',
      'canConfigure',false,
      'rules',coalesce(v_freeze.rules_snapshot,'[]'::jsonb),
      'events',coalesce(v_freeze.events_snapshot,'[]'::jsonb),
      'audit','[]'::jsonb,
      'freeze',jsonb_build_object(
        'hash',v_freeze.calculation_hash,
        'totalPayrollEur',v_freeze.total_payroll_eur,
        'impactEur',v_freeze.impact_eur,
        'frozenByName',v_freeze.frozen_by_name,
        'frozenAt',v_freeze.frozen_at
      ),
      'sources',jsonb_build_object(
        'events','Snapshot RH figé à la clôture · aucune correction ultérieure ne modifie ce mois',
        'rules','Règles de proratisation figées à la clôture',
        'identity','Référentiel collaborateurs du workflow clôturé',
        'calculation','Moteur KPI CRVO · calcul reproductible sur preuves figées'
      )
    );
  end if;

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

create or replace function public.kpi_bonus_close_workflow(p_session_hash text, p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  audit jsonb;
  h text;
  component_hash text;
  total numeric;
  base_total numeric;
  proration_impact numeric:=0;
  proration_hash text;
  v_freeze public.kpi_bonus_proration_freezes%rowtype;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null or not a.can_manage then raise exception 'Seul Cyril peut clôturer le workflow.' using errcode='42501'; end if;
  if (select status from public.kpi_bonus_workflows where id=p_workflow_id) in('closed','legacy_closed') then raise exception 'Workflow déjà clôturé.'; end if;
  audit:=public.kpi_bonus_audit_workflow(p_workflow_id);
  if not coalesce((audit->>'passed')::boolean,false) then raise exception 'Audit bloquant : clôture impossible.'; end if;

  update public.kpi_bonus_components c set
    final_tier=coalesce(service_tier,team_tier,theoretical_tier),
    coefficient=coalesce((select case when coalesce(service_tier,team_tier,theoretical_tier,0)=0 then 0 else (r.coefficients->>(coalesce(service_tier,team_tier,theoretical_tier,0)-1))::numeric end from public.kpi_bonus_workflows w join public.kpi_bonus_payplan_rules r on r.version_id=w.payplan_version_id and r.population=c.population and r.job_key=c.job_key where w.id=c.workflow_id),0),
    updated_at=now()
  where workflow_id=p_workflow_id;
  update public.kpi_bonus_components set
    individual_amount_eur=round(coalesce(individual_base_eur,0)*coalesce(coefficient,0),2),
    total_amount_eur=round(coalesce(individual_base_eur,0)*coalesce(coefficient,0)+coalesce(collective_amount_eur,0)*coalesce(collective_proration,1)+coalesce(exceptional_amount_eur,0),2)
  where workflow_id=p_workflow_id;

  select coalesce(sum(total_amount_eur),0) into base_total from public.kpi_bonus_components where workflow_id=p_workflow_id;
  select encode(digest(string_agg(source_component_key||':'||coalesce(final_tier::text,'')||':'||coalesce(total_amount_eur::text,''),'|' order by source_component_key),'sha256'),'hex') into component_hash
  from public.kpi_bonus_components where workflow_id=p_workflow_id;

  select * into v_freeze from public.kpi_bonus_proration_freezes where workflow_id=p_workflow_id;
  if v_freeze.workflow_id is not null then
    total:=coalesce(v_freeze.total_payroll_eur,base_total);
    proration_impact:=coalesce(v_freeze.impact_eur,total-base_total);
    proration_hash:=v_freeze.calculation_hash;
    h:=encode(digest(coalesce(component_hash,'')||':'||coalesce(proration_hash,''),'sha256'),'hex');
  else
    total:=base_total;
    h:=component_hash;
  end if;

  update public.kpi_bonus_components set is_frozen=true where workflow_id=p_workflow_id;
  update public.kpi_bonus_workflows set
    status='closed',closed_by=a.user_id,closed_at=now(),audit_snapshot=audit,
    totals_snapshot=jsonb_build_object(
      'totalPayrollEur',round(total,2),
      'baseTotalPayrollEur',round(base_total,2),
      'prorationImpactEur',round(proration_impact,2),
      'prorationHash',proration_hash
    ),
    frozen_hash=h,updated_at=now()
  where id=p_workflow_id;
  insert into public.kpi_bonus_events(workflow_id,event_type,actor_id,payload)
  values(p_workflow_id,'workflow_closed',a.user_id,jsonb_build_object(
    'hash',h,'totalPayrollEur',round(total,2),'baseTotalPayrollEur',round(base_total,2),
    'prorationImpactEur',round(proration_impact,2),'prorationHash',proration_hash,'audit',audit
  ));
  return jsonb_build_object('ok',true,'hash',h,'totalPayrollEur',round(total,2),'baseTotalPayrollEur',round(base_total,2),'prorationImpactEur',round(proration_impact,2),'prorationHash',proration_hash);
end $$;

revoke all on function public.kpi_bonus_proration_freeze_workflow(text,uuid,jsonb,text) from public;
grant execute on function public.kpi_bonus_proration_freeze_workflow(text,uuid,jsonb,text) to anon,authenticated;
