create or replace function public.kpi_bonus_get_workflow_payplan(p_session_hash text,p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a record; v record; rules jsonb;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null or a.role<>'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select pv.* into v from public.kpi_bonus_workflows w join public.kpi_bonus_payplan_versions pv on pv.id=w.payplan_version_id where w.id=p_workflow_id;
  if v.id is null then raise exception 'Payplan du workflow introuvable.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'population',r.population,'jobKey',r.job_key,'label',r.label,'ruleType',r.rule_type,
    'thresholds',r.tier_thresholds,'coefficients',r.coefficients,'baseAmountEur',r.base_amount_eur,
    'settings',r.settings,'sourceReference',r.source_reference
  ) order by r.population,r.label),'[]'::jsonb)
  into rules from public.kpi_bonus_payplan_rules r where r.version_id=v.id;
  return jsonb_build_object('canManage',a.can_manage,'version',jsonb_build_object('id',v.id,'code',v.version_code,'label',v.label,'effectiveFrom',v.effective_from,'status',v.status,'sourceFilename',v.source_filename,'settings',v.settings),'rules',rules);
end
$function$;
grant execute on function public.kpi_bonus_get_workflow_payplan(text,uuid) to anon,authenticated,service_role;
