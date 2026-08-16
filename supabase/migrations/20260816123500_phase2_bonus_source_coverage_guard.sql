create or replace function public.kpi_bonus_audit_workflow(p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w record; total_count int; missing_theoretical int; missing_team int; missing_service int; missing_base int;
  missing_collective int; missing_proration int; bad_proration int; override_no_comment int; unmatched_staff int;
  identity_conflicts int; duplicate_components int; unresolved_rules int; presence_max date; billed_max date; required_through date;
  blockers jsonb:='[]'::jsonb; warnings jsonb:='[]'::jsonb;
begin
  select w0.*,v.settings version_settings into w
  from public.kpi_bonus_workflows w0 join public.kpi_bonus_payplan_versions v on v.id=w0.payplan_version_id where w0.id=p_workflow_id;
  if w.id is null then raise exception 'Workflow introuvable.'; end if;

  select count(*),count(*) filter(where theoretical_tier is null),count(*) filter(where team_tier is null),count(*) filter(where service_tier is null),
    count(*) filter(where coalesce(service_tier,team_tier,theoretical_tier,0)>0 and individual_base_eur is null),count(*) filter(where collective_amount_eur is null),
    count(*) filter(where collective_proration is null),count(*) filter(where collective_proration is not null and (collective_proration<0 or collective_proration>1)),
    count(*) filter(where coalesce((source_payload->>'staffMatched')::boolean,true)=false)
  into total_count,missing_theoretical,missing_team,missing_service,missing_base,missing_collective,missing_proration,bad_proration,unmatched_staff
  from public.kpi_bonus_components where workflow_id=p_workflow_id;

  select count(*) into override_no_comment from public.kpi_bonus_validations v join public.kpi_bonus_components c on c.id=v.workflow_component_id
  where c.workflow_id=p_workflow_id and v.previous_tier is distinct from v.new_tier and length(trim(coalesce(v.comment,'')))<3;
  select count(*) into unresolved_rules from public.kpi_bonus_components c left join public.kpi_bonus_payplan_rules r
    on r.version_id=w.payplan_version_id and r.population=c.population and r.job_key=c.job_key where c.workflow_id=p_workflow_id and r.id is null;
  select count(*) into identity_conflicts from (select c.matricule from public.kpi_bonus_components c left join public.kpi_bonus_employee_config cfg on cfg.id=c.config_id
    where c.workflow_id=p_workflow_id and c.matricule is not null group by c.matricule having count(distinct coalesce(cfg.employee_name,c.employee_name))>1)q;
  select count(*) into duplicate_components from (select matricule,population,job_key from public.kpi_bonus_components where workflow_id=p_workflow_id and matricule is not null
    group by matricule,population,job_key having count(*)>1)q;

  if w.validation_mode='legacy_excel' then
    warnings:=warnings||jsonb_build_array(jsonb_build_object('code','legacy_source','count',1,'message','Historique importé depuis Excel : les règles natives ne sont pas rétro-appliquées.'));
    return coalesce(w.audit_snapshot,'{}'::jsonb)||jsonb_build_object('nativeAudit',jsonb_build_object('components',total_count,'blockers','[]'::jsonb,'warnings',warnings,'passed',true,'legacy',true));
  end if;

  if w.month <= (timezone('Europe/Paris',now()))::date then
    required_through:=least((w.month+interval '1 month - 1 day')::date,(timezone('Europe/Paris',now()))::date);
    while extract(isodow from required_through) in (6,7) loop required_through:=required_through-1; end loop;
    select max(p.work_date) into presence_max from public.kpi_sql_presence_facts p
      where p.source_name='Direct Data RH' and p.work_date>=w.month and p.work_date<(w.month+interval '1 month')::date;
    select max(coalesce(b.work_date,b.invoice_date)) into billed_max from public.kpi_billed_time_facts b
      where b.source_name='Direct Temps pointé facturé' and coalesce(b.work_date,b.invoice_date)>=w.month and coalesce(b.work_date,b.invoice_date)<(w.month+interval '1 month')::date;
    if presence_max is null or presence_max<required_through then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','rh_source_not_current','count',1,
      'message','Data RH incomplète pour la période : dernière date '||coalesce(to_char(presence_max,'DD/MM/YYYY'),'absente')||', attendue au moins jusqu’au '||to_char(required_through,'DD/MM/YYYY')||'.')); end if;
    if billed_max is null or billed_max<required_through then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','billed_time_source_not_current','count',1,
      'message','Temps pointé facturé incomplet pour la période : dernière date '||coalesce(to_char(billed_max,'DD/MM/YYYY'),'absente')||', attendue au moins jusqu’au '||to_char(required_through,'DD/MM/YYYY')||'.')); end if;
  end if;

  if public.kpi_bonus_input_numeric(w.id,'global','*','working_days') is null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_working_days','count',1,'message','Nombre de jours ouvrés du mois manquant.')); end if;
  if missing_theoretical>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_theoretical_tier','count',missing_theoretical,'message','Paliers théoriques incomplets : donnée automatique ou saisie fin de mois manquante.')); end if;
  if missing_team>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_team_validation','count',missing_team,'message','Validations chef d’équipe manquantes.')); end if;
  if missing_service>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_service_validation','count',missing_service,'message','Validations chef de service manquantes.')); end if;
  if missing_base>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_base_amount','count',missing_base,'message','Montants de référence Payplan manquants.')); end if;
  if missing_collective>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_collective_amount','count',missing_collective,'message','Montant de prime collective sortie usine manquant.')); end if;
  if missing_proration>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','missing_proration','count',missing_proration,'message','Proratisation collective impossible : Data RH ou jours ouvrés incomplets.')); end if;
  if bad_proration>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','invalid_proration','count',bad_proration,'message','Proratisation hors bornes 0–100 %.')); end if;
  if override_no_comment>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','override_without_comment','count',override_no_comment,'message','Modification de palier sans commentaire.')); end if;
  if unresolved_rules>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unresolved_payplan_rule','count',unresolved_rules,'message','Règle Payplan introuvable.')); end if;
  if identity_conflicts>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','matricule_identity_conflict','count',identity_conflicts,'message','Un matricule correspond à plusieurs identités : contrôle obligatoire.')); end if;
  if duplicate_components>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','duplicate_bonus_component','count',duplicate_components,'message','Un même matricule possède plusieurs composants identiques de prime.')); end if;
  if unmatched_staff>0 then warnings:=warnings||jsonb_build_array(jsonb_build_object('code','unmatched_staff','count',unmatched_staff,'message','Composants non rapprochés automatiquement du référentiel RH.')); end if;

  return jsonb_build_object('components',total_count,'blockers',blockers,'warnings',warnings,'passed',jsonb_array_length(blockers)=0,'legacy',false,
    'sourceCoverage',jsonb_build_object('requiredThrough',required_through,'rhPresenceThrough',presence_max,'billedTimeThrough',billed_max),
    'checks',jsonb_build_object('missingTheoretical',missing_theoretical,'missingTeam',missing_team,'missingService',missing_service,'missingBase',missing_base,
      'missingCollective',missing_collective,'missingProration',missing_proration,'badProration',bad_proration,'overrideWithoutComment',override_no_comment,
      'unmatchedStaff',unmatched_staff,'identityConflicts',identity_conflicts,'duplicateComponents',duplicate_components,'unresolvedRules',unresolved_rules));
end
$function$;
