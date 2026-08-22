alter table public.kpi_pr_reservations add column if not exists idempotency_key text;
create unique index if not exists kpi_pr_reservations_idempotency_idx on public.kpi_pr_reservations(idempotency_key) where idempotency_key is not null;

create or replace function public.kpi_pr_dev_reserve(p_token_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_auth record; v_item public.kpi_pr_items%rowtype; v_location public.kpi_pr_locations%rowtype; v_balance public.kpi_pr_stock_balances%rowtype;
  v_qty numeric; v_work_order text; v_registration text; v_vin text; v_idem text; v_existing public.kpi_pr_reservations%rowtype; v_id uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_item from public.kpi_pr_items where reference=trim(p_payload->>'reference') limit 1;
  if v_item.id is null then raise exception 'Référence PR inconnue.'; end if;
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
  if v_registration is null or v_vin is null then
    select coalesce(v_registration,m.registration),coalesce(v_vin,m.vin) into v_registration,v_vin from public.kpi_vehicle_identity_map m where m.work_order=v_work_order order by m.last_seen_at desc nulls last limit 1;
  end if;
  update public.kpi_pr_stock_balances set reserved=reserved+v_qty,updated_at=now() where item_id=v_item.id and location_id=v_location.id;
  insert into public.kpi_pr_reservations(item_id,location_id,work_order,registration,vin,quantity,status,created_by,idempotency_key,metadata)
  values(v_item.id,v_location.id,v_work_order,v_registration,v_vin,v_qty,'active',v_auth.display_name,v_idem,coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_id;
  return jsonb_build_object('ok',true,'reservationId',v_id,'reference',v_item.reference,'workOrder',v_work_order,'quantity',v_qty,'availableAfter',v_balance.on_hand-v_balance.reserved-v_qty);
end; $$;

create or replace function public.kpi_pr_dev_release_reservation(p_token_hash text, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_res public.kpi_pr_reservations%rowtype; v_balance public.kpi_pr_stock_balances%rowtype;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_res from public.kpi_pr_reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Réservation introuvable.'; end if;
  if v_res.status<>'active' then return jsonb_build_object('ok',true,'alreadyProcessed',true,'reservationId',v_res.id,'status',v_res.status); end if;
  select * into v_balance from public.kpi_pr_stock_balances where item_id=v_res.item_id and location_id=v_res.location_id for update;
  update public.kpi_pr_stock_balances set reserved=greatest(0,reserved-v_res.quantity),updated_at=now() where item_id=v_res.item_id and location_id=v_res.location_id;
  update public.kpi_pr_reservations set status='released',released_at=now(),updated_at=now() where id=v_res.id;
  return jsonb_build_object('ok',true,'reservationId',v_res.id,'status','released');
end; $$;

create or replace function public.kpi_pr_dev_serve_reservation(p_token_hash text, p_reservation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_auth record; v_res public.kpi_pr_reservations%rowtype; v_item public.kpi_pr_items%rowtype; v_location public.kpi_pr_locations%rowtype; v_balance public.kpi_pr_stock_balances%rowtype;
  v_new_stock numeric; v_value numeric; v_movement uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_res from public.kpi_pr_reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'Réservation introuvable.'; end if;
  if v_res.status='served' then return jsonb_build_object('ok',true,'alreadyProcessed',true,'reservationId',v_res.id,'status','served'); end if;
  if v_res.status<>'active' then raise exception 'La réservation n’est plus active.'; end if;
  select * into v_balance from public.kpi_pr_stock_balances where item_id=v_res.item_id and location_id=v_res.location_id for update;
  if v_balance.on_hand<v_res.quantity then raise exception 'Stock physique insuffisant.'; end if;
  v_new_stock:=v_balance.on_hand-v_res.quantity; v_value:=round((-v_res.quantity)*v_balance.average_cost_ht,4);
  update public.kpi_pr_stock_balances set on_hand=v_new_stock,reserved=greatest(0,reserved-v_res.quantity),updated_at=now() where item_id=v_res.item_id and location_id=v_res.location_id;
  select * into v_item from public.kpi_pr_items where id=v_res.item_id;
  select * into v_location from public.kpi_pr_locations where id=v_res.location_id;
  insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,work_order,registration,vin,reason,idempotency_key,actor_user_id,actor_name,metadata)
  values(v_res.item_id,v_res.location_id,'issue_work_order',-v_res.quantity,v_balance.average_cost_ht,v_value,v_new_stock,v_balance.average_cost_ht,v_res.work_order,v_res.registration,v_res.vin,'Service réservation OR','reservation:'||v_res.id::text,v_auth.user_id,v_auth.display_name,jsonb_build_object('reservationId',v_res.id)) returning id into v_movement;
  update public.kpi_pr_reservations set status='served',served_at=now(),updated_at=now() where id=v_res.id;
  return jsonb_build_object('ok',true,'reservationId',v_res.id,'movementId',v_movement,'reference',v_item.reference,'locationCode',v_location.code,'stockAfter',v_new_stock);
end; $$;

create or replace function public.kpi_pr_dev_work_order(p_token_hash text, p_work_order text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_registration text; v_vin text; v_vehicle jsonb; v_reservations jsonb; v_movements jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if nullif(trim(p_work_order),'') is null then raise exception 'OR requis.'; end if;
  select m.registration,m.vin,jsonb_build_object('workOrder',m.work_order,'registration',m.registration,'vin',m.vin,'firstSeenAt',m.first_seen_at,'lastSeenAt',m.last_seen_at,'metadata',m.metadata)
  into v_registration,v_vin,v_vehicle from public.kpi_vehicle_identity_map m where m.work_order=trim(p_work_order) order by m.last_seen_at desc nulls last limit 1;
  if v_vehicle is null then v_vehicle:=jsonb_build_object('workOrder',trim(p_work_order),'registration',null,'vin',null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'reference',i.reference,'description',i.description,'locationCode',l.code,'quantity',r.quantity,'status',r.status,'createdAt',r.created_at,'servedAt',r.served_at,'releasedAt',r.released_at) order by r.created_at desc),'[]'::jsonb)
  into v_reservations from public.kpi_pr_reservations r join public.kpi_pr_items i on i.id=r.item_id join public.kpi_pr_locations l on l.id=r.location_id where r.work_order=trim(p_work_order);
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'reference',i.reference,'description',i.description,'movementType',m.movement_type,'quantityDelta',m.quantity_delta,'unitCostHt',m.applied_unit_cost_ht,'valueDeltaHt',m.value_delta_ht,'createdAt',m.created_at,'actorName',m.actor_name) order by m.created_at desc),'[]'::jsonb)
  into v_movements from public.kpi_pr_movements m join public.kpi_pr_items i on i.id=m.item_id where m.work_order=trim(p_work_order);
  return jsonb_build_object('connected',true,'vehicle',v_vehicle,'reservations',v_reservations,'movements',v_movements);
end; $$;

create or replace function public.kpi_pr_dev_inventory_get(p_token_hash text, p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_session public.kpi_pr_inventory_sessions%rowtype; v_lines jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_session from public.kpi_pr_inventory_sessions where id=p_session_id limit 1;
  if v_session.id is null then raise exception 'Inventaire introuvable.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',ln.id,'reference',i.reference,'description',i.description,'locationCode',l.code,'theoreticalQty',case when v_session.blind_count then null else ln.theoretical_qty end,'firstCountQty',ln.first_count_qty,'secondCountQty',ln.second_count_qty,'finalQty',ln.final_qty,'varianceQty',ln.variance_qty,'varianceValue',ln.variance_value,'recountRequired',ln.recount_required,'countedBy',ln.counted_by,'countedAt',ln.counted_at,'recountedBy',ln.recounted_by,'recountedAt',ln.recounted_at) order by l.code,i.reference),'[]'::jsonb)
  into v_lines from public.kpi_pr_inventory_lines ln join public.kpi_pr_items i on i.id=ln.item_id join public.kpi_pr_locations l on l.id=ln.location_id where ln.session_id=p_session_id;
  return jsonb_build_object('connected',true,'session',jsonb_build_object('id',v_session.id,'code',v_session.code,'inventoryType',v_session.inventory_type,'status',v_session.status,'blindCount',v_session.blind_count,'filters',v_session.filters,'quantityRecountThreshold',v_session.quantity_recount_threshold,'valueRecountThreshold',v_session.value_recount_threshold,'createdAt',v_session.created_at,'closedAt',v_session.closed_at),'lines',v_lines);
end; $$;

revoke all on function public.kpi_pr_dev_reserve(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_release_reservation(text,uuid) from public;
revoke all on function public.kpi_pr_dev_serve_reservation(text,uuid) from public;
revoke all on function public.kpi_pr_dev_work_order(text,text) from public;
revoke all on function public.kpi_pr_dev_inventory_get(text,uuid) from public;
grant execute on function public.kpi_pr_dev_reserve(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_release_reservation(text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_serve_reservation(text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_work_order(text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_inventory_get(text,uuid) to anon,authenticated,service_role;
