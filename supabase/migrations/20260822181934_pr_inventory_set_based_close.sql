create or replace function public.kpi_pr_dev_close_inventory(p_token_hash text,p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_auth record;
  v_session public.kpi_pr_inventory_sessions%rowtype;
  v_adjustments integer:=0;
  v_total_value numeric:=0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select * into v_session from public.kpi_pr_inventory_sessions where id=p_session_id for update;
  if v_session.id is null then raise exception 'Inventaire introuvable.'; end if;
  if v_session.status='closed' then return jsonb_build_object('ok',true,'alreadyClosed',true,'sessionId',p_session_id); end if;
  if exists(select 1 from public.kpi_pr_inventory_lines where session_id=p_session_id and final_qty is null) then
    raise exception 'Toutes les lignes doivent être comptées ou recomptées avant clôture.';
  end if;

  insert into public.kpi_pr_stock_balances(item_id,location_id,on_hand,reserved,average_cost_ht)
  select ln.item_id,ln.location_id,0,0,coalesce(ln.average_cost_snapshot,0)
  from public.kpi_pr_inventory_lines ln
  where ln.session_id=p_session_id
  on conflict(item_id,location_id) do nothing;

  if exists(
    select 1 from public.kpi_pr_inventory_lines ln
    join public.kpi_pr_stock_balances b on b.item_id=ln.item_id and b.location_id=ln.location_id
    where ln.session_id=p_session_id and b.reserved>ln.final_qty
  ) then raise exception 'Clôture impossible : au moins une quantité comptée est inférieure au stock réservé.'; end if;

  with changes as (
    select ln.id line_id,ln.item_id,ln.location_id,ln.final_qty,b.on_hand current_qty,
           coalesce(nullif(b.average_cost_ht,0),ln.average_cost_snapshot,0) unit_cost,
           ln.final_qty-b.on_hand delta
    from public.kpi_pr_inventory_lines ln
    join public.kpi_pr_stock_balances b on b.item_id=ln.item_id and b.location_id=ln.location_id
    where ln.session_id=p_session_id
  ), inserted as (
    insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,inventory_session_id,inventory_line_id,reason,idempotency_key,actor_user_id,actor_name)
    select item_id,location_id,'inventory_adjustment',delta,unit_cost,round(delta*unit_cost,4),final_qty,unit_cost,p_session_id,line_id,
           'Clôture inventaire '||v_session.code,'inventory:'||p_session_id::text||':'||line_id::text,v_auth.user_id,v_auth.display_name
    from changes where delta<>0
    on conflict(idempotency_key) do nothing
    returning value_delta_ht
  )
  select count(*),coalesce(sum(value_delta_ht),0) into v_adjustments,v_total_value from inserted;

  update public.kpi_pr_stock_balances b
  set on_hand=ln.final_qty,
      average_cost_ht=case when coalesce(b.average_cost_ht,0)=0 then coalesce(ln.average_cost_snapshot,0) else b.average_cost_ht end,
      updated_at=now()
  from public.kpi_pr_inventory_lines ln
  where ln.session_id=p_session_id and b.item_id=ln.item_id and b.location_id=ln.location_id;

  update public.kpi_pr_inventory_lines set closed_at=now() where session_id=p_session_id;
  update public.kpi_pr_inventory_sessions set status='closed',closed_by=v_auth.display_name,closed_at=now() where id=p_session_id;
  return jsonb_build_object('ok',true,'sessionId',p_session_id,'adjustmentCount',v_adjustments,'varianceValue',round(v_total_value,2));
end;
$function$;

create or replace function public.kpi_pr_dev_inventory_page(p_token_hash text,p_session_id uuid,p_query text default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_auth record; v_session public.kpi_pr_inventory_sessions%rowtype; v_lines jsonb;
  v_total integer; v_done integer; v_recount integer; v_filtered integer;
  v_q text:=nullif(btrim(coalesce(p_query,'')),'');
  v_limit integer:=greatest(1,least(coalesce(p_limit,100),250));
  v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select * into v_session from public.kpi_pr_inventory_sessions where id=p_session_id limit 1;
  if v_session.id is null then raise exception 'Inventaire introuvable.'; end if;
  select count(*),count(*) filter(where final_qty is not null),count(*) filter(where recount_required) into v_total,v_done,v_recount from public.kpi_pr_inventory_lines where session_id=p_session_id;
  select count(*) into v_filtered
  from public.kpi_pr_inventory_lines ln join public.kpi_pr_items i on i.id=ln.item_id
  where ln.session_id=p_session_id and (v_q is null or i.reference ilike '%'||v_q||'%' or i.description ilike '%'||v_q||'%' or coalesce(i.manufacturer_label,'') ilike '%'||v_q||'%');
  select coalesce(jsonb_agg(x.obj order by x.sort_recount,x.sort_done,x.location_code,x.reference),'[]'::jsonb) into v_lines
  from (
    select case when ln.recount_required then 0 else 1 end sort_recount,case when ln.final_qty is null then 0 else 1 end sort_done,l.code location_code,i.reference,
      jsonb_build_object('id',ln.id,'reference',i.reference,'manufacturerLabel',i.manufacturer_label,'description',i.description,'family',i.family,'locationCode',l.code,
        'theoreticalQty',case when v_session.blind_count and v_session.status<>'closed' then null else ln.theoretical_qty end,
        'firstCountQty',ln.first_count_qty,'secondCountQty',ln.second_count_qty,'finalQty',ln.final_qty,
        'varianceQty',case when v_session.blind_count and v_session.status<>'closed' then null else ln.variance_qty end,
        'varianceValue',case when v_session.blind_count and v_session.status<>'closed' then null else ln.variance_value end,
        'recountRequired',ln.recount_required,'countedBy',ln.counted_by,'countedAt',ln.counted_at,'recountedBy',ln.recounted_by,'recountedAt',ln.recounted_at) obj
    from public.kpi_pr_inventory_lines ln join public.kpi_pr_items i on i.id=ln.item_id join public.kpi_pr_locations l on l.id=ln.location_id
    where ln.session_id=p_session_id and (v_q is null or i.reference ilike '%'||v_q||'%' or i.description ilike '%'||v_q||'%' or coalesce(i.manufacturer_label,'') ilike '%'||v_q||'%')
    order by case when ln.recount_required then 0 else 1 end,case when ln.final_qty is null then 0 else 1 end,l.code,i.reference
    limit v_limit offset v_offset
  ) x;
  return jsonb_build_object('connected',true,'session',jsonb_build_object('id',v_session.id,'code',v_session.code,'inventoryType',v_session.inventory_type,'status',v_session.status,'blindCount',v_session.blind_count,'filters',v_session.filters,'quantityRecountThreshold',v_session.quantity_recount_threshold,'valueRecountThreshold',v_session.value_recount_threshold,'createdAt',v_session.created_at,'closedAt',v_session.closed_at,'totalLines',v_total,'completedLines',v_done,'recountLines',v_recount),'lines',v_lines,'pagination',jsonb_build_object('total',v_filtered,'limit',v_limit,'offset',v_offset,'hasMore',v_offset+v_limit<v_filtered));
end;
$function$;
