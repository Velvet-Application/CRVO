create or replace function public.kpi_pr_dev_post_movement(p_token_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_auth record; v_item public.kpi_pr_items%rowtype; v_location public.kpi_pr_locations%rowtype; v_balance public.kpi_pr_stock_balances%rowtype; v_existing public.kpi_pr_movements%rowtype;
  v_type text; v_delta numeric; v_unit_cost numeric; v_new_stock numeric; v_new_avg numeric; v_value_delta numeric; v_work_order text; v_registration text; v_vin text; v_idempotency text; v_movement_id uuid; v_item_id uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  v_item_id:=public.kpi_pr_internal_resolve_item_id(nullif(p_payload->>'itemId','')::uuid,p_payload->>'reference',p_payload->>'manufacturerLabel');
  select * into v_item from public.kpi_pr_items where id=v_item_id;
  select * into v_location from public.kpi_pr_locations where code=coalesce(nullif(trim(p_payload->>'locationCode'),''),'MAG-PR') limit 1;
  if v_location.id is null then raise exception 'Emplacement PR inconnu.'; end if;
  v_type:=trim(p_payload->>'movementType');
  if v_type not in ('initial_stock','receipt','issue_work_order','return_work_order','inventory_adjustment','transfer_in','transfer_out','manual_adjustment','package_issue') then raise exception 'Type de mouvement PR invalide.'; end if;
  v_delta:=nullif(p_payload->>'quantityDelta','')::numeric;
  if v_delta is null or v_delta=0 then raise exception 'Quantité de mouvement invalide.'; end if;
  v_idempotency:=nullif(trim(p_payload->>'idempotencyKey'),'');
  if v_idempotency is not null then select * into v_existing from public.kpi_pr_movements where idempotency_key=v_idempotency limit 1; if v_existing.id is not null then return jsonb_build_object('ok',true,'idempotent',true,'movementId',v_existing.id,'balanceAfter',v_existing.balance_after,'averageCostAfter',v_existing.average_cost_after); end if; end if;
  insert into public.kpi_pr_stock_balances(item_id,location_id,on_hand,reserved,average_cost_ht) values(v_item.id,v_location.id,0,0,0) on conflict(item_id,location_id) do nothing;
  select * into v_balance from public.kpi_pr_stock_balances where item_id=v_item.id and location_id=v_location.id for update;
  v_new_stock:=v_balance.on_hand+v_delta;
  if v_new_stock<0 then raise exception 'Stock négatif interdit pour cette référence.'; end if;
  if v_new_stock<v_balance.reserved then raise exception 'Mouvement impossible : stock réservé supérieur au stock restant.'; end if;
  v_unit_cost:=nullif(p_payload->>'unitCostHt','')::numeric;
  if v_delta<0 then v_unit_cost:=v_balance.average_cost_ht; v_new_avg:=v_balance.average_cost_ht;
  else v_unit_cost:=coalesce(v_unit_cost,nullif(v_item.standard_purchase_price_ht,0),v_balance.average_cost_ht,0);
    if v_new_stock>0 then v_new_avg:=case when v_balance.on_hand<=0 then v_unit_cost when v_type in ('receipt','initial_stock','inventory_adjustment','manual_adjustment','return_work_order','transfer_in') then ((v_balance.on_hand*v_balance.average_cost_ht)+(v_delta*v_unit_cost))/v_new_stock else v_balance.average_cost_ht end; else v_new_avg:=v_balance.average_cost_ht; end if;
  end if;
  v_new_avg:=coalesce(v_new_avg,0); v_value_delta:=round(v_delta*v_unit_cost,4);
  v_work_order:=nullif(trim(p_payload->>'workOrder'),''); v_registration:=nullif(trim(p_payload->>'registration'),''); v_vin:=nullif(trim(p_payload->>'vin'),'');
  if v_work_order is not null and (v_registration is null or v_vin is null) then select coalesce(v_registration,m.registration),coalesce(v_vin,m.vin) into v_registration,v_vin from public.kpi_vehicle_identity_map m where m.work_order=v_work_order order by m.last_seen_at desc nulls last limit 1; end if;
  update public.kpi_pr_stock_balances set on_hand=v_new_stock,average_cost_ht=v_new_avg,updated_at=now() where item_id=v_item.id and location_id=v_location.id;
  insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,work_order,registration,vin,supplier_reference,document_reference,reason,idempotency_key,actor_user_id,actor_name,metadata)
  values(v_item.id,v_location.id,v_type,v_delta,v_unit_cost,v_value_delta,v_new_stock,v_new_avg,v_work_order,v_registration,v_vin,nullif(trim(p_payload->>'supplierReference'),''),nullif(trim(p_payload->>'documentReference'),''),nullif(trim(p_payload->>'reason'),''),v_idempotency,v_auth.user_id,v_auth.display_name,coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_movement_id;
  return jsonb_build_object('ok',true,'movementId',v_movement_id,'itemId',v_item.id,'reference',v_item.reference,'manufacturerLabel',v_item.manufacturer_label,'locationCode',v_location.code,'balanceAfter',v_new_stock,'averageCostAfter',v_new_avg,'valueDeltaHt',v_value_delta);
end;
$$;

create or replace function public.kpi_pr_dev_reserve(p_token_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_auth record; v_item public.kpi_pr_items%rowtype; v_location public.kpi_pr_locations%rowtype; v_balance public.kpi_pr_stock_balances%rowtype;
  v_qty numeric; v_work_order text; v_registration text; v_vin text; v_idem text; v_existing public.kpi_pr_reservations%rowtype; v_id uuid; v_item_id uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  v_item_id:=public.kpi_pr_internal_resolve_item_id(nullif(p_payload->>'itemId','')::uuid,p_payload->>'reference',p_payload->>'manufacturerLabel');
  select * into v_item from public.kpi_pr_items where id=v_item_id;
  select * into v_location from public.kpi_pr_locations where code=coalesce(nullif(trim(p_payload->>'locationCode'),''),'MAG-PR') limit 1;
  if v_location.id is null then raise exception 'Emplacement PR inconnu.'; end if;
  v_qty:=nullif(p_payload->>'quantity','')::numeric; if v_qty is null or v_qty<=0 then raise exception 'Quantité de réservation invalide.'; end if;
  v_work_order:=nullif(trim(p_payload->>'workOrder'),''); if v_work_order is null then raise exception 'OR requis pour réserver une pièce.'; end if;
  v_idem:=nullif(trim(p_payload->>'idempotencyKey'),'');
  if v_idem is not null then select * into v_existing from public.kpi_pr_reservations where idempotency_key=v_idem limit 1; if v_existing.id is not null then return jsonb_build_object('ok',true,'idempotent',true,'reservationId',v_existing.id); end if; end if;
  select * into v_balance from public.kpi_pr_stock_balances where item_id=v_item.id and location_id=v_location.id for update;
  if v_balance.item_id is null then raise exception 'Aucun stock pour cette référence.'; end if;
  if (v_balance.on_hand-v_balance.reserved)<v_qty then raise exception 'Stock disponible insuffisant.'; end if;
  v_registration:=nullif(trim(p_payload->>'registration'),''); v_vin:=nullif(trim(p_payload->>'vin'),'');
  if v_registration is null or v_vin is null then select coalesce(v_registration,m.registration),coalesce(v_vin,m.vin) into v_registration,v_vin from public.kpi_vehicle_identity_map m where m.work_order=v_work_order order by m.last_seen_at desc nulls last limit 1; end if;
  update public.kpi_pr_stock_balances set reserved=reserved+v_qty,updated_at=now() where item_id=v_item.id and location_id=v_location.id;
  insert into public.kpi_pr_reservations(item_id,location_id,work_order,registration,vin,quantity,status,created_by,idempotency_key,metadata)
  values(v_item.id,v_location.id,v_work_order,v_registration,v_vin,v_qty,'active',v_auth.display_name,v_idem,coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('ok',true,'reservationId',v_id,'itemId',v_item.id,'reference',v_item.reference,'manufacturerLabel',v_item.manufacturer_label,'workOrder',v_work_order,'quantity',v_qty,'availableAfter',v_balance.on_hand-v_balance.reserved-v_qty);
end;
$$;

grant execute on function public.kpi_pr_dev_post_movement(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_reserve(text,jsonb) to anon,authenticated,service_role;
