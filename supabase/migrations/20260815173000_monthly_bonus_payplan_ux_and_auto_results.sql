create or replace function public.kpi_bonus_update_common_coefficients(
  p_session_hash text,
  p_coefficients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a record; v_id uuid; bad_count integer;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null or not a.can_manage then raise exception 'Seul le responsable Payplan peut modifier les coefficients communs.' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_coefficients,'null'::jsonb)) <> 'array' or jsonb_array_length(p_coefficients) <> 5 then raise exception '5 coefficients communs sont requis.'; end if;
  select count(*) into bad_count from jsonb_array_elements_text(p_coefficients) x(value) where x.value::numeric < 0 or x.value::numeric > 3;
  if bad_count > 0 then raise exception 'Coefficient invalide : valeurs attendues entre 0 et 3.'; end if;
  select id into v_id from public.kpi_bonus_payplan_versions where status='active' order by effective_from desc,created_at desc limit 1;
  if v_id is null then raise exception 'Aucun Payplan actif.'; end if;
  update public.kpi_bonus_payplan_rules set coefficients=p_coefficients,updated_at=now() where version_id=v_id;
  update public.kpi_bonus_payplan_versions set settings=coalesce(settings,'{}'::jsonb)||jsonb_build_object('commonCoefficients',p_coefficients) where id=v_id;
  return jsonb_build_object('ok',true,'versionId',v_id,'coefficients',p_coefficients);
end
$function$;

create or replace function public.kpi_bonus_result_suggestions(p_session_hash text,p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a record; w record; park_days integer:=0; park_last date; expert_avg numeric; ct_avg numeric; factory_days integer:=0; factory_last date; factory_output numeric;
begin
  select * into a from public.kpi_bonus_actor(p_session_hash);
  if a.user_id is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if a.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into w from public.kpi_bonus_workflows where id=p_workflow_id;
  if w.id is null then raise exception 'Workflow introuvable.'; end if;

  with ftp_source as (
    select id from public.kpi_data_sources where kind='ftp' and is_enabled=true order by created_at limit 1
  ), daily_batches as (
    select b.id,b.snapshot_at::date snap_day,row_number() over(partition by b.snapshot_at::date order by coalesce(nullif(b.metadata->>'modified_at','')::bigint,0) desc,b.imported_at desc,b.id desc) rn
    from public.kpi_import_batches b join ftp_source s on s.id=b.source_id
    where b.original_filename='EtatduParc.csv' and b.metadata->>'vehicle_state_status'='ready'
      and b.snapshot_at::date>=w.month and b.snapshot_at::date<(w.month+interval '1 month')::date
  ), vehicle_ranked as (
    select b.snap_day,v.*,row_number() over(partition by b.snap_day,coalesce(nullif(trim(v.vin),''),nullif(trim(v.registration),''),nullif(trim(v.work_order),''),v.id::text) order by v.status_at desc nulls last,v.created_at desc,v.id desc) vrn
    from daily_batches b join public.kpi_ftp_vehicle_state v on v.import_batch_id=b.id
    where b.rn=1 and v.metadata->>'type' in ('VOP EFF','VOP EXT')
  ), daily as (
    select snap_day,
      count(*) filter(where vrn=1 and lower(coalesce(status,''))=lower('En attente d''expertise dynamique'))::numeric expert_dynamic_wait,
      count(*) filter(where vrn=1 and lower(coalesce(status,'')) in (lower('Stocké sur parc d''attente (Départ CT)'),lower('Contrôle technique en cours')))::numeric ct_depart
    from vehicle_ranked group by snap_day
  )
  select count(*),max(snap_day),avg(expert_dynamic_wait),avg(ct_depart) into park_days,park_last,expert_avg,ct_avg from daily;

  with ranked as (
    select p.*,row_number() over(partition by p.production_date,p.flow order by p.source_modified_at desc nulls last,p.created_at desc,p.id desc) rn
    from public.kpi_ftp_factory_production p
    where p.production_date>=w.month and p.production_date<(w.month+interval '1 month')::date
  ), daily as (
    select production_date,sum(available) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric exits from ranked group by production_date
  )
  select count(*),max(production_date),sum(coalesce(exits,0)) into factory_days,factory_last,factory_output from daily;

  return jsonb_build_object(
    'month',to_char(w.month,'YYYY-MM'),'status',w.status,
    'suggestions',jsonb_build_array(
      jsonb_build_object('jobKey','expert_dynamique','inputKey','criterion_1','value',case when expert_avg is null then null else round(expert_avg,2) end,'label','Dossiers en attente expertise dynamique','aggregation','Moyenne quotidienne','source','FTP · EtatduParc.csv','coverageDays',park_days,'lastDate',park_last,'confidence',case when park_days>=15 then 'complete' when park_days>0 then 'provisional' else 'unavailable' end),
      jsonb_build_object('jobKey','jockey_ct','inputKey','criterion_1','value',case when ct_avg is null then null else round(ct_avg,2) end,'label','Véhicules en départ / contrôle CT','aggregation','Moyenne quotidienne','source','FTP · EtatduParc.csv','coverageDays',park_days,'lastDate',park_last,'confidence',case when park_days>=15 then 'complete' when park_days>0 then 'provisional' else 'unavailable' end),
      jsonb_build_object('jobKey','assistante','inputKey','criterion_2','value',case when ct_avg is null then null else round(ct_avg,2) end,'label','Véhicules en départ / contrôle CT','aggregation','Moyenne quotidienne','source','FTP · EtatduParc.csv','coverageDays',park_days,'lastDate',park_last,'confidence',case when park_days>=15 then 'complete' when park_days>0 then 'provisional' else 'unavailable' end),
      jsonb_build_object('jobKey','jockey','inputKey','factory_output','scopeType','global','scopeKey','*','value',factory_output,'label','Sorties usine','aggregation','Cumul mensuel','source','FTP · Factory-j+1','coverageDays',factory_days,'lastDate',factory_last,'confidence',case when factory_days>=15 then 'complete' when factory_days>0 then 'provisional' else 'unavailable' end)
    ),
    'unsupported',jsonb_build_array(
      jsonb_build_object('jobKey','facturation','reason','Les flux actuels ne distinguent pas de façon fiable devis à envoyer et dossiers en attente accord.'),
      jsonb_build_object('jobKey','acheteur','reason','Le KPI dossiers en commande du Payplan n''est pas encore mappé de façon certaine dans les sources opérationnelles.'),
      jsonb_build_object('jobKey','magasin','reason','Les champs pièces/commandes disponibles ne correspondent pas encore de façon démontrée au KPI Excel « dossiers CMD ».'),
      jsonb_build_object('jobKey','fixline','reason','Le résultat Fixline reste une saisie unique service tant que le flux exact « véhicules passés » n''est pas certifié.'),
      jsonb_build_object('jobKey','chef_equipe','reason','Les 5 critères restent visibles par CE ; seules les valeurs dont la source métier est certifiée doivent être automatisées.')
    )
  );
end
$function$;

grant execute on function public.kpi_bonus_update_common_coefficients(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_bonus_result_suggestions(text,uuid) to anon,authenticated,service_role;
