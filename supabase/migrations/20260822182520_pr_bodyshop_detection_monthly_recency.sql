create or replace function public.kpi_pr_dev_detect_bodyshop_cession(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_auth record; v_setting jsonb; v_auto boolean:=true; v_reg text; v_client text; v_override text;
  v_candidate_count integer:=0; v_detected text; v_confidence text:='not_found'; v_candidates jsonb:='[]'::jsonb; v_history jsonb:='[]'::jsonb;
  v_latest timestamptz; v_opened date; v_has_bodyshop boolean:=false;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select value into v_setting from public.kpi_pr_settings where key='bodyshop_consumables';
  v_setting:=coalesce(v_setting,'{}'::jsonb);
  v_auto:=coalesce((v_setting->>'autoDetect')::boolean,true);
  v_reg:=coalesce(nullif(btrim(v_setting->>'markerRegistration'),''),'AA123BB');
  v_client:=coalesce(nullif(btrim(v_setting->>'markerClient'),''),'200071');
  v_override:=nullif(btrim(v_setting->>'manualOverrideWorkOrder'),'');

  if v_override is not null then
    v_detected:=v_override; v_confidence:='manual';
  elsif v_auto then
    select max(snapshot_at) into v_latest from public.kpi_vehicle_workload where metadata->>'source_filename'='OR en cours.xlsx';
    with grouped as (
      select work_order,max(registration) registration,max(client) client,min(opened_at)::date opened_at,
             bool_or(sector_key='carrosserie') has_carrosserie,
             string_agg(distinct coalesce(primary_activity,''),' | ' order by coalesce(primary_activity,'')) activities
      from public.kpi_vehicle_workload
      where snapshot_at=v_latest and metadata->>'source_filename'='OR en cours.xlsx'
      group by work_order
    ), candidates as (
      select * from grouped where registration=v_reg and client=v_client
      order by opened_at desc nulls last,work_order desc
    )
    select count(*),
           (array_agg(work_order order by opened_at desc nulls last,work_order desc))[1],
           (array_agg(opened_at order by opened_at desc nulls last,work_order desc))[1],
           (array_agg(has_carrosserie order by opened_at desc nulls last,work_order desc))[1],
           coalesce(jsonb_agg(jsonb_build_object('workOrder',work_order,'registration',registration,'client',client,'openedAt',opened_at,'hasCarrosserie',has_carrosserie,'activities',activities) order by opened_at desc nulls last,work_order desc),'[]'::jsonb)
    into v_candidate_count,v_detected,v_opened,v_has_bodyshop,v_candidates from candidates;

    if v_candidate_count=0 then
      v_detected:=null; v_confidence:='not_found';
    elsif v_opened is null or v_opened < (date_trunc('month',current_date)::date-3) then
      v_detected:=null; v_confidence:='not_found';
    else
      v_confidence:='high';
    end if;
  else
    v_detected:=nullif(btrim(v_setting->>'cessionWorkOrder'),'');
    v_confidence:=case when v_detected is null then 'not_found' else 'saved' end;
  end if;

  if v_detected is not null then
    insert into public.kpi_pr_bodyshop_cession_periods(period_month,work_order,detection_method,confidence,marker_registration,marker_client,detected_at,metadata)
    values(date_trunc('month',current_date)::date,v_detected,case when v_confidence='manual' then 'manual' else 'auto' end,v_confidence,v_reg,v_client,now(),jsonb_build_object('candidateCount',v_candidate_count,'openedAt',v_opened,'hasCarrosserie',v_has_bodyshop))
    on conflict(period_month) do update set work_order=excluded.work_order,detection_method=excluded.detection_method,confidence=excluded.confidence,
      marker_registration=excluded.marker_registration,marker_client=excluded.marker_client,detected_at=now(),metadata=excluded.metadata;
    update public.kpi_pr_settings set value=jsonb_set(value,'{cessionWorkOrder}',to_jsonb(v_detected),true) where key='bodyshop_consumables';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('month',period_month,'workOrder',work_order,'method',detection_method,'confidence',confidence,'detectedAt',detected_at) order by period_month desc),'[]'::jsonb)
  into v_history from (select * from public.kpi_pr_bodyshop_cession_periods order by period_month desc limit 18) h;
  return jsonb_build_object('ok',true,'autoDetect',v_auto,'markerRegistration',v_reg,'markerClient',v_client,'manualOverrideWorkOrder',coalesce(v_override,''),'currentWorkOrder',v_detected,'confidence',v_confidence,'candidateCount',v_candidate_count,'candidates',v_candidates,'history',v_history);
end;
$function$;
