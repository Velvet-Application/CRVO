insert into public.kpi_pr_settings(key,value)
values('inventory_policy',jsonb_build_object(
  'defaultLocationCode','MAG-PR','blindCount',true,
  'includeZeroStockCycle',false,'includeZeroStockAnnual',true,
  'cycleMaxLines',50,'quantityRecountThreshold',1,'valueRecountThreshold',50
))
on conflict(key) do nothing;

update public.kpi_pr_settings
set value = jsonb_build_object(
  'autoDetect', true,
  'markerRegistration', coalesce(nullif(value->>'markerRegistration',''),'AA123BB'),
  'markerClient', coalesce(nullif(value->>'markerClient',''),'200071'),
  'manualOverrideWorkOrder', coalesce(value->>'manualOverrideWorkOrder',''),
  'cessionWorkOrder', coalesce(value->>'cessionWorkOrder',''),
  'targetEuroPerVop', coalesce(nullif(value->>'targetEuroPerVop','')::numeric,0)
)
where key='bodyshop_consumables';

create table if not exists public.kpi_pr_bodyshop_cession_periods(
  period_month date primary key,
  work_order text not null,
  detection_method text not null default 'auto',
  confidence text not null default 'high',
  marker_registration text,
  marker_client text,
  detected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
alter table public.kpi_pr_bodyshop_cession_periods enable row level security;
revoke all on table public.kpi_pr_bodyshop_cession_periods from public,anon,authenticated;

insert into public.kpi_pr_bodyshop_cession_periods(period_month,work_order,detection_method,confidence,marker_registration,marker_client,metadata)
values(date '2026-08-01','2085894','reference_seed','high','AA123BB','200071',jsonb_build_object('reason','OR de cession carrosserie identifié dans les OR ICAR en cours'))
on conflict(period_month) do nothing;

create or replace function public.kpi_pr_dev_detect_bodyshop_cession(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_auth record; v_setting jsonb; v_auto boolean:=true; v_reg text; v_client text; v_override text;
  v_candidate_count integer:=0; v_detected text; v_confidence text:='not_found';
  v_candidates jsonb:='[]'::jsonb; v_history jsonb:='[]'::jsonb; v_latest timestamptz;
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
      select work_order,max(registration) registration,max(client) client,min(opened_at) opened_at,
             bool_or(sector_key='carrosserie') has_carrosserie,
             string_agg(distinct coalesce(primary_activity,''),' | ' order by coalesce(primary_activity,'')) activities
      from public.kpi_vehicle_workload
      where snapshot_at=v_latest and metadata->>'source_filename'='OR en cours.xlsx'
      group by work_order
    ), candidates as (
      select * from grouped where registration=v_reg and client=v_client and has_carrosserie
      order by opened_at desc nulls last,work_order desc
    )
    select count(*),(array_agg(work_order order by opened_at desc nulls last,work_order desc))[1],
           coalesce(jsonb_agg(jsonb_build_object('workOrder',work_order,'registration',registration,'client',client,'openedAt',opened_at,'activities',activities) order by opened_at desc nulls last,work_order desc),'[]'::jsonb)
    into v_candidate_count,v_detected,v_candidates from candidates;
    if v_candidate_count=1 then v_confidence:='high';
    elsif v_candidate_count>1 then v_confidence:='ambiguous'; v_detected:=null;
    else v_confidence:='not_found'; v_detected:=null; end if;
  else
    v_detected:=nullif(btrim(v_setting->>'cessionWorkOrder'),'');
    v_confidence:=case when v_detected is null then 'not_found' else 'saved' end;
  end if;

  if v_detected is not null then
    insert into public.kpi_pr_bodyshop_cession_periods(period_month,work_order,detection_method,confidence,marker_registration,marker_client,detected_at,metadata)
    values(date_trunc('month',current_date)::date,v_detected,case when v_confidence='manual' then 'manual' else 'auto' end,v_confidence,v_reg,v_client,now(),jsonb_build_object('candidateCount',v_candidate_count))
    on conflict(period_month) do update set work_order=excluded.work_order,detection_method=excluded.detection_method,confidence=excluded.confidence,
      marker_registration=excluded.marker_registration,marker_client=excluded.marker_client,detected_at=now(),metadata=excluded.metadata;
    update public.kpi_pr_settings set value=jsonb_set(value,'{cessionWorkOrder}',to_jsonb(v_detected),true) where key='bodyshop_consumables';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('month',period_month,'workOrder',work_order,'method',detection_method,'confidence',confidence,'detectedAt',detected_at) order by period_month desc),'[]'::jsonb)
  into v_history from (select * from public.kpi_pr_bodyshop_cession_periods order by period_month desc limit 18) h;

  return jsonb_build_object('ok',true,'autoDetect',v_auto,'markerRegistration',v_reg,'markerClient',v_client,
    'manualOverrideWorkOrder',coalesce(v_override,''),'currentWorkOrder',v_detected,'confidence',v_confidence,
    'candidateCount',v_candidate_count,'candidates',v_candidates,'history',v_history);
end;
$function$;
revoke all on function public.kpi_pr_dev_detect_bodyshop_cession(text) from public;
grant execute on function public.kpi_pr_dev_detect_bodyshop_cession(text) to anon,authenticated,service_role;

create or replace function public.kpi_pr_dev_create_inventory(p_token_hash text,p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_auth record; v_policy jsonb; v_session uuid; v_code text; v_type text; v_location_code text; v_location_id uuid;
  v_family text; v_category text; v_blind boolean; v_include_zero boolean; v_qty_threshold numeric; v_value_threshold numeric;
  v_max_lines integer; v_count integer;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select value into v_policy from public.kpi_pr_settings where key='inventory_policy'; v_policy:=coalesce(v_policy,'{}'::jsonb);
  v_type:=coalesce(nullif(btrim(p_filters->>'inventoryType'),''),'cycle');
  if v_type not in ('cycle','annual') then raise exception 'Type inventaire invalide.'; end if;
  v_location_code:=coalesce(nullif(btrim(p_filters->>'locationCode'),''),nullif(btrim(v_policy->>'defaultLocationCode'),''),'MAG-PR');
  select id into v_location_id from public.kpi_pr_locations where code=v_location_code and is_active limit 1;
  if v_location_id is null then raise exception 'Emplacement inventaire inconnu : %',v_location_code; end if;
  v_family:=nullif(btrim(p_filters->>'family'),''); v_category:=nullif(btrim(p_filters->>'category'),'');
  v_blind:=coalesce(nullif(p_filters->>'blindCount','')::boolean,nullif(v_policy->>'blindCount','')::boolean,true);
  v_include_zero:=coalesce(nullif(p_filters->>'includeZeroStock','')::boolean,case when v_type='annual' then coalesce(nullif(v_policy->>'includeZeroStockAnnual','')::boolean,true) else coalesce(nullif(v_policy->>'includeZeroStockCycle','')::boolean,false) end);
  v_qty_threshold:=coalesce(nullif(p_filters->>'quantityRecountThreshold','')::numeric,nullif(v_policy->>'quantityRecountThreshold','')::numeric,1);
  v_value_threshold:=coalesce(nullif(p_filters->>'valueRecountThreshold','')::numeric,nullif(v_policy->>'valueRecountThreshold','')::numeric,50);
  v_max_lines:=greatest(1,least(coalesce(nullif(p_filters->>'maxLines','')::integer,nullif(v_policy->>'cycleMaxLines','')::integer,50),5000));
  v_code:=case when v_type='annual' then 'INV-A-' else 'INV-T-' end||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS');
  insert into public.kpi_pr_inventory_sessions(code,inventory_type,status,blind_count,filters,quantity_recount_threshold,value_recount_threshold,created_by)
  values(v_code,v_type,'counting',v_blind,coalesce(p_filters,'{}'::jsonb)||jsonb_build_object('locationCode',v_location_code,'includeZeroStock',v_include_zero,'maxLines',case when v_type='cycle' then v_max_lines else null end),v_qty_threshold,v_value_threshold,v_auth.display_name)
  returning id into v_session;

  with last_count as (
    select ln.item_id,ln.location_id,max(s.closed_at) last_closed_at
    from public.kpi_pr_inventory_lines ln join public.kpi_pr_inventory_sessions s on s.id=ln.session_id and s.status='closed'
    group by ln.item_id,ln.location_id
  ), candidates as (
    select i.id item_id,v_location_id location_id,coalesce(b.on_hand,0) theoretical_qty,
           coalesce(b.average_cost_ht,coalesce(i.standard_purchase_price_ht,0),0) average_cost,lc.last_closed_at,i.reference
    from public.kpi_pr_items i
    left join public.kpi_pr_stock_balances b on b.item_id=i.id and b.location_id=v_location_id
    left join last_count lc on lc.item_id=i.id and lc.location_id=v_location_id
    where i.is_active and (v_family is null or i.family=v_family) and (v_category is null or i.category=v_category)
      and (v_include_zero or coalesce(b.on_hand,0)<>0)
  ), selected as (
    select * from candidates order by last_closed_at asc nulls first,abs(theoretical_qty*average_cost) desc,reference
    limit case when v_type='cycle' then v_max_lines else 2147483647 end
  )
  insert into public.kpi_pr_inventory_lines(session_id,item_id,location_id,theoretical_qty,average_cost_snapshot)
  select v_session,item_id,location_id,theoretical_qty,average_cost from selected;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'sessionId',v_session,'code',v_code,'inventoryType',v_type,'lineCount',v_count,'locationCode',v_location_code,'blindCount',v_blind,'includeZeroStock',v_include_zero,'maxLines',case when v_type='cycle' then v_max_lines else null end);
end;
$function$;

create or replace function public.kpi_pr_dev_close_inventory(p_token_hash text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='public'
as $function$
declare v_auth record; v_session public.kpi_pr_inventory_sessions%rowtype; v_line record; v_balance public.kpi_pr_stock_balances%rowtype; v_delta numeric; v_new_stock numeric; v_total_value numeric:=0; v_adjustments integer:=0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select * into v_session from public.kpi_pr_inventory_sessions where id=p_session_id for update; if v_session.id is null then raise exception 'Inventaire introuvable.'; end if;
  if v_session.status='closed' then return jsonb_build_object('ok',true,'alreadyClosed',true,'sessionId',p_session_id); end if;
  if exists(select 1 from public.kpi_pr_inventory_lines where session_id=p_session_id and final_qty is null) then raise exception 'Toutes les lignes doivent être comptées ou recomptées avant clôture.'; end if;
  for v_line in select * from public.kpi_pr_inventory_lines where session_id=p_session_id order by id loop
    v_delta:=v_line.final_qty-v_line.theoretical_qty;
    if v_delta<>0 then
      insert into public.kpi_pr_stock_balances(item_id,location_id,on_hand,reserved,average_cost_ht)
      values(v_line.item_id,v_line.location_id,0,0,v_line.average_cost_snapshot) on conflict(item_id,location_id) do nothing;
      select * into v_balance from public.kpi_pr_stock_balances where item_id=v_line.item_id and location_id=v_line.location_id for update;
      v_new_stock:=v_balance.on_hand+v_delta;
      if v_new_stock<0 then raise exception 'Clôture impossible : le comptage créerait un stock négatif.'; end if;
      if v_balance.reserved>0 and v_new_stock<v_balance.reserved then raise exception 'Clôture impossible : stock réservé supérieur au stock compté.'; end if;
      update public.kpi_pr_stock_balances set on_hand=v_new_stock,updated_at=now() where item_id=v_line.item_id and location_id=v_line.location_id;
      insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,inventory_session_id,inventory_line_id,reason,idempotency_key,actor_user_id,actor_name)
      values(v_line.item_id,v_line.location_id,'inventory_adjustment',v_delta,v_balance.average_cost_ht,round(v_delta*v_balance.average_cost_ht,4),v_new_stock,v_balance.average_cost_ht,p_session_id,v_line.id,'Clôture inventaire '||v_session.code,'inventory:'||p_session_id::text||':'||v_line.id::text,v_auth.user_id,v_auth.display_name)
      on conflict(idempotency_key) do nothing;
      v_adjustments:=v_adjustments+1; v_total_value:=v_total_value+round(v_delta*v_balance.average_cost_ht,2);
    end if;
    update public.kpi_pr_inventory_lines set closed_at=now() where id=v_line.id;
  end loop;
  update public.kpi_pr_inventory_sessions set status='closed',closed_by=v_auth.display_name,closed_at=now() where id=p_session_id;
  return jsonb_build_object('ok',true,'sessionId',p_session_id,'adjustmentCount',v_adjustments,'varianceValue',v_total_value);
end;
$function$;

create or replace function public.kpi_pr_dev_inventory_get(p_token_hash text,p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='public'
as $function$
declare v_auth record; v_session public.kpi_pr_inventory_sessions%rowtype; v_lines jsonb; v_total integer; v_done integer; v_recount integer;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select * into v_session from public.kpi_pr_inventory_sessions where id=p_session_id limit 1; if v_session.id is null then raise exception 'Inventaire introuvable.'; end if;
  select count(*),count(*) filter(where final_qty is not null),count(*) filter(where recount_required) into v_total,v_done,v_recount from public.kpi_pr_inventory_lines where session_id=p_session_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',ln.id,'reference',i.reference,'manufacturerLabel',i.manufacturer_label,'description',i.description,'family',i.family,'locationCode',l.code,'theoreticalQty',case when v_session.blind_count then null else ln.theoretical_qty end,'firstCountQty',ln.first_count_qty,'secondCountQty',ln.second_count_qty,'finalQty',ln.final_qty,'varianceQty',ln.variance_qty,'varianceValue',ln.variance_value,'recountRequired',ln.recount_required,'countedBy',ln.counted_by,'countedAt',ln.counted_at,'recountedBy',ln.recounted_by,'recountedAt',ln.recounted_at) order by case when ln.recount_required then 0 when ln.final_qty is null then 1 else 2 end,l.code,i.reference),'[]'::jsonb)
  into v_lines from public.kpi_pr_inventory_lines ln join public.kpi_pr_items i on i.id=ln.item_id join public.kpi_pr_locations l on l.id=ln.location_id where ln.session_id=p_session_id;
  return jsonb_build_object('connected',true,'session',jsonb_build_object('id',v_session.id,'code',v_session.code,'inventoryType',v_session.inventory_type,'status',v_session.status,'blindCount',v_session.blind_count,'filters',v_session.filters,'quantityRecountThreshold',v_session.quantity_recount_threshold,'valueRecountThreshold',v_session.value_recount_threshold,'createdAt',v_session.created_at,'closedAt',v_session.closed_at,'totalLines',v_total,'completedLines',v_done,'recountLines',v_recount),'lines',v_lines);
end;
$function$;
