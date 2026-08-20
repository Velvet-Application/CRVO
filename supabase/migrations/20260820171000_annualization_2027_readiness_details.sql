create or replace function public.kpi_annualization_v2_readiness(p_session_hash text,p_entity text default 'CRVO')
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_access jsonb;
  v_entity text:=upper(coalesce(p_entity,'CRVO'));
  v_settings public.kpi_annualization_settings%rowtype;
  v_rulesets int;
  v_validated_rulesets int;
  v_contracts int;
  v_links int;
  v_ledger int;
  v_open_alerts int;
  v_checks_total int;
  v_checks_passed int;
  v_checks_failed int;
  v_check_items jsonb:='[]'::jsonb;
  v_ruleset_items jsonb:='[]'::jsonb;
  v_blockers jsonb:='[]'::jsonb;
begin
  v_access:=public.kpi_annualization_v2_access(p_session_hash);
  if not coalesce((v_access->>'canReadCentre')::boolean,false) and not coalesce((v_access->>'canConfigureRules')::boolean,false) then
    raise exception 'Accès Annualisation du centre requis.' using errcode='42501';
  end if;
  select * into v_settings from public.kpi_annualization_settings where entity=v_entity;
  select count(*) into v_rulesets from public.kpi_annualization_rulesets where entity=v_entity;
  select count(*) into v_validated_rulesets from public.kpi_annualization_rulesets where entity=v_entity and status='validated' and valid_from<=date '2027-01-01' and valid_to>=date '2027-12-31';
  select coalesce(jsonb_agg(jsonb_build_object('version',version,'title',title,'status',status,'validFrom',valid_from,'validTo',valid_to,'requiresLegalValidation',requires_legal_validation,'validationComment',validation_comment) order by valid_from desc,created_at desc),'[]'::jsonb)
    into v_ruleset_items from public.kpi_annualization_rulesets where entity=v_entity;
  select count(*) into v_contracts from public.kpi_annualization_employee_contracts where entity=v_entity and (valid_to is null or valid_to>=date '2027-01-01');
  select count(*) into v_links from public.kpi_annualization_employee_account_links where entity=v_entity and (valid_to is null or valid_to>=date '2027-01-01');
  select count(*) into v_ledger from public.kpi_annualization_ledger where entity=v_entity;
  select count(*) into v_open_alerts from public.kpi_annualization_compliance_alerts where entity=v_entity and status in ('open','acknowledged');
  select count(*),count(*) filter(where status in ('passed','waived')),count(*) filter(where status='failed'),
         coalesce(jsonb_agg(jsonb_build_object('key',check_key,'label',label,'category',category,'required',required,'status',status,'evidence',evidence,'checkedBy',checked_by_name,'checkedAt',checked_at) order by sort_order),'[]'::jsonb)
    into v_checks_total,v_checks_passed,v_checks_failed,v_check_items
  from public.kpi_annualization_go_live_checks where required;
  if v_settings.entity is null then v_blockers:=v_blockers||jsonb_build_array('Configuration CRVO absente.'); end if;
  if coalesce(v_validated_rulesets,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Aucun référentiel 2027 validé.'); end if;
  if coalesce(v_contracts,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Population/contrats 2027 non chargés.'); end if;
  if coalesce(v_links,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Rattachements comptes salariés non préparés.'); end if;
  if coalesce(v_checks_failed,0)>0 then v_blockers:=v_blockers||jsonb_build_array('Au moins un contrôle de go-live est en échec.'); end if;
  if coalesce(v_settings.official_engine_enabled,false) then
    if coalesce(v_checks_passed,0)<coalesce(v_checks_total,0) then v_blockers:=v_blockers||jsonb_build_array('Moteur officiel activé alors que la checklist de go-live n’est pas entièrement validée.'); end if;
    if coalesce(v_validated_rulesets,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Moteur officiel activé sans référentiel juridique validé.'); end if;
  end if;
  return jsonb_build_object(
    'entity',v_entity,
    'mode',coalesce(v_settings.mode,'missing'),
    'officialGoLiveDate',v_settings.official_go_live_date,
    'officialEngineEnabled',coalesce(v_settings.official_engine_enabled,false),
    'rulesets',v_rulesets,
    'rulesetItems',v_ruleset_items,
    'validatedRulesets2027',v_validated_rulesets,
    'employeeContracts',v_contracts,
    'employeeAccountLinks',v_links,
    'ledgerEntries',v_ledger,
    'openComplianceAlerts',v_open_alerts,
    'goLiveChecks',jsonb_build_object('total',v_checks_total,'passedOrWaived',v_checks_passed,'failed',v_checks_failed,'items',v_check_items),
    'blockers',v_blockers,
    'safeToGoLive',(jsonb_array_length(v_blockers)=0 and coalesce(v_settings.official_engine_enabled,false))
  );
end$$;
revoke all on function public.kpi_annualization_v2_readiness(text,text) from public;
grant execute on function public.kpi_annualization_v2_readiness(text,text) to anon,authenticated,service_role;
select pg_notify('pgrst','reload schema');
