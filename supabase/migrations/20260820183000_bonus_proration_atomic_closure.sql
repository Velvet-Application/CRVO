-- Final hardening of bonus closure:
-- 1) materialize final validated amounts before proration is frozen,
-- 2) invalidate stale freezes,
-- 3) require a fresh evidence freeze whose base total exactly matches the workflow before closure.

create or replace function public.kpi_bonus_prepare_closure(p_session_hash text, p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a record;
  v_status text;
  v_audit jsonb;
  v_base_total numeric;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null or not coalesce(a.can_manage,false) then
    raise exception 'Seule la Direction autorisée peut préparer la clôture.' using errcode='42501';
  end if;

  select status into v_status from public.kpi_bonus_workflows where id=p_workflow_id;
  if v_status is null then raise exception 'Workflow introuvable.'; end if;
  if v_status in ('closed','legacy_closed') then raise exception 'Workflow déjà clôturé.'; end if;

  -- A previous failed/abandoned closure attempt must never be reusable silently.
  delete from public.kpi_bonus_proration_freezes where workflow_id=p_workflow_id;

  v_audit:=public.kpi_bonus_audit_workflow(p_workflow_id);
  if not coalesce((v_audit->>'passed')::boolean,false) then
    raise exception 'Audit bloquant : préparation de clôture impossible.';
  end if;

  -- Materialize the exact financial base that will be used by the closing function.
  update public.kpi_bonus_components c set
    final_tier=coalesce(service_tier,team_tier,theoretical_tier),
    coefficient=coalesce((
      select case
        when coalesce(c.service_tier,c.team_tier,c.theoretical_tier,0)=0 then 0
        else (r.coefficients->>(coalesce(c.service_tier,c.team_tier,c.theoretical_tier,0)-1))::numeric
      end
      from public.kpi_bonus_workflows w
      join public.kpi_bonus_payplan_rules r
        on r.version_id=w.payplan_version_id
       and r.population=c.population
       and r.job_key=c.job_key
      where w.id=c.workflow_id
    ),0),
    updated_at=now()
  where c.workflow_id=p_workflow_id;

  update public.kpi_bonus_components set
    individual_amount_eur=round(coalesce(individual_base_eur,0)*coalesce(coefficient,0),2),
    total_amount_eur=round(
      coalesce(individual_base_eur,0)*coalesce(coefficient,0)
      +coalesce(collective_amount_eur,0)*coalesce(collective_proration,1)
      +coalesce(exceptional_amount_eur,0),2
    ),
    updated_at=now()
  where workflow_id=p_workflow_id;

  select round(coalesce(sum(total_amount_eur),0),2)
  into v_base_total
  from public.kpi_bonus_components
  where workflow_id=p_workflow_id;

  insert into public.kpi_bonus_events(workflow_id,event_type,actor_id,payload)
  values(
    p_workflow_id,
    'closure_prepared',
    a.user_id,
    jsonb_build_object('baseTotalPayrollEur',v_base_total,'audit',v_audit)
  );

  return jsonb_build_object(
    'ok',true,
    'workflowId',p_workflow_id,
    'baseTotalPayrollEur',v_base_total,
    'audit',v_audit
  );
end $$;

revoke all on function public.kpi_bonus_prepare_closure(text,uuid) from public;
grant execute on function public.kpi_bonus_prepare_closure(text,uuid) to anon,authenticated;

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
  frozen_base_total numeric;
  proration_impact numeric:=0;
  proration_hash text;
  db_component_count integer;
  frozen_component_count integer;
  v_freeze public.kpi_bonus_proration_freezes%rowtype;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null or not coalesce(a.can_manage,false) then
    raise exception 'Seul Cyril peut clôturer le workflow.' using errcode='42501';
  end if;
  if (select status from public.kpi_bonus_workflows where id=p_workflow_id) in ('closed','legacy_closed') then
    raise exception 'Workflow déjà clôturé.';
  end if;

  audit:=public.kpi_bonus_audit_workflow(p_workflow_id);
  if not coalesce((audit->>'passed')::boolean,false) then
    raise exception 'Audit bloquant : clôture impossible.';
  end if;

  select * into v_freeze
  from public.kpi_bonus_proration_freezes
  where workflow_id=p_workflow_id;

  if v_freeze.workflow_id is null then
    raise exception 'Gel de preuve manquant : relancer la clôture depuis le workflow.';
  end if;
  if v_freeze.frozen_at < now()-interval '2 minutes' then
    raise exception 'Gel de preuve expiré : les données doivent être figées à nouveau avant clôture.';
  end if;
  if jsonb_typeof(v_freeze.context_snapshot)<>'object'
     or jsonb_typeof(v_freeze.rules_snapshot)<>'array'
     or jsonb_typeof(v_freeze.events_snapshot)<>'array' then
    raise exception 'Gel de preuve incomplet ou invalide.';
  end if;
  if jsonb_array_length(v_freeze.rules_snapshot)=0 then
    raise exception 'Aucune règle de proratisation n''est figée : clôture interdite.';
  end if;

  -- Re-materialize the financial base using the same deterministic formula as preparation.
  update public.kpi_bonus_components c set
    final_tier=coalesce(service_tier,team_tier,theoretical_tier),
    coefficient=coalesce((
      select case
        when coalesce(c.service_tier,c.team_tier,c.theoretical_tier,0)=0 then 0
        else (r.coefficients->>(coalesce(c.service_tier,c.team_tier,c.theoretical_tier,0)-1))::numeric
      end
      from public.kpi_bonus_workflows w
      join public.kpi_bonus_payplan_rules r
        on r.version_id=w.payplan_version_id
       and r.population=c.population
       and r.job_key=c.job_key
      where w.id=c.workflow_id
    ),0),
    updated_at=now()
  where c.workflow_id=p_workflow_id;

  update public.kpi_bonus_components set
    individual_amount_eur=round(coalesce(individual_base_eur,0)*coalesce(coefficient,0),2),
    total_amount_eur=round(
      coalesce(individual_base_eur,0)*coalesce(coefficient,0)
      +coalesce(collective_amount_eur,0)*coalesce(collective_proration,1)
      +coalesce(exceptional_amount_eur,0),2
    ),
    updated_at=now()
  where workflow_id=p_workflow_id;

  select round(coalesce(sum(total_amount_eur),0),2),count(*)
  into base_total,db_component_count
  from public.kpi_bonus_components
  where workflow_id=p_workflow_id;

  select round(coalesce(sum(nullif(c->>'totalBeforeEur','')::numeric),0),2),count(*)
  into frozen_base_total,frozen_component_count
  from jsonb_array_elements(coalesce(v_freeze.context_snapshot->'components','[]'::jsonb)) c;

  if frozen_component_count is distinct from db_component_count then
    raise exception 'Le périmètre collaborateurs a changé depuis le gel de preuve. Relancer la clôture.';
  end if;
  if abs(coalesce(frozen_base_total,0)-coalesce(base_total,0))>0.01 then
    raise exception 'La base financière a changé depuis le gel de preuve. Relancer la clôture.';
  end if;

  select encode(
    digest(string_agg(
      source_component_key||':'||coalesce(final_tier::text,'')||':'||coalesce(total_amount_eur::text,''),
      '|' order by source_component_key
    ),'sha256'),'hex'
  ) into component_hash
  from public.kpi_bonus_components
  where workflow_id=p_workflow_id;

  total:=coalesce(v_freeze.total_payroll_eur,base_total);
  proration_impact:=coalesce(v_freeze.impact_eur,total-base_total);
  proration_hash:=v_freeze.calculation_hash;
  if nullif(btrim(proration_hash),'') is null then raise exception 'Empreinte de proratisation manquante.'; end if;
  h:=encode(digest(coalesce(component_hash,'')||':'||proration_hash,'sha256'),'hex');

  update public.kpi_bonus_components set is_frozen=true where workflow_id=p_workflow_id;
  update public.kpi_bonus_workflows set
    status='closed',
    closed_by=a.user_id,
    closed_at=now(),
    audit_snapshot=audit,
    totals_snapshot=jsonb_build_object(
      'totalPayrollEur',round(total,2),
      'baseTotalPayrollEur',round(base_total,2),
      'prorationImpactEur',round(proration_impact,2),
      'prorationHash',proration_hash,
      'evidenceFrozenAt',v_freeze.frozen_at,
      'evidenceFrozenBy',v_freeze.frozen_by_name
    ),
    frozen_hash=h,
    updated_at=now()
  where id=p_workflow_id;

  insert into public.kpi_bonus_events(workflow_id,event_type,actor_id,payload)
  values(
    p_workflow_id,
    'workflow_closed',
    a.user_id,
    jsonb_build_object(
      'hash',h,
      'totalPayrollEur',round(total,2),
      'baseTotalPayrollEur',round(base_total,2),
      'prorationImpactEur',round(proration_impact,2),
      'prorationHash',proration_hash,
      'evidenceFrozenAt',v_freeze.frozen_at,
      'audit',audit
    )
  );

  return jsonb_build_object(
    'ok',true,
    'workflowId',p_workflow_id,
    'hash',h,
    'prorationHash',proration_hash,
    'totalPayrollEur',round(total,2),
    'baseTotalPayrollEur',round(base_total,2),
    'prorationImpactEur',round(proration_impact,2),
    'evidenceFrozenAt',v_freeze.frozen_at
  );
end $$;
