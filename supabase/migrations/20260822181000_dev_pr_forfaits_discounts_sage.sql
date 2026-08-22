create table if not exists public.kpi_pr_package_usages (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.kpi_pr_packages(id) on delete restrict,
  work_order text not null,
  registration text,
  vin text,
  base_price_ht numeric(14,4) not null default 0,
  discount_percent numeric(7,4) not null default 0,
  net_price_ht numeric(14,4) not null default 0,
  parts_cost_ht numeric(14,4) not null default 0,
  labor_cost_ht numeric(14,4) not null default 0,
  fee_cost_ht numeric(14,4) not null default 0,
  status text not null default 'applied' check (status in ('draft','applied','cancelled')),
  actor_user_id uuid,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.kpi_pr_package_usages enable row level security;
revoke all on public.kpi_pr_package_usages from anon, authenticated;
create index if not exists kpi_pr_package_usages_work_order_idx on public.kpi_pr_package_usages(work_order,created_at desc);
create unique index if not exists kpi_pr_accounting_source_once_idx on public.kpi_pr_accounting_export_lines(source_movement_id) where source_movement_id is not null;

create or replace function public.kpi_pr_dev_upsert_discount_rule(p_token_hash text, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_id uuid; v_code text; v_label text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  v_code:=nullif(trim(p_rule->>'code'),''); v_label:=nullif(trim(p_rule->>'label'),'');
  if v_code is null or v_label is null then raise exception 'Code et libellé de rabais requis.'; end if;
  insert into public.kpi_pr_discount_rules(code,label,scope_type,scope_value,discount_type,discount_value,priority,valid_from,valid_to,is_active,metadata,updated_at)
  values(v_code,v_label,coalesce(nullif(p_rule->>'scopeType',''),'global'),nullif(trim(p_rule->>'scopeValue'),''),coalesce(nullif(p_rule->>'discountType',''),'percent'),coalesce(nullif(p_rule->>'discountValue','')::numeric,0),coalesce(nullif(p_rule->>'priority','')::integer,100),nullif(p_rule->>'validFrom','')::date,nullif(p_rule->>'validTo','')::date,coalesce((p_rule->>'isActive')::boolean,true),coalesce(p_rule->'metadata','{}'::jsonb),now())
  on conflict(code) do update set label=excluded.label,scope_type=excluded.scope_type,scope_value=excluded.scope_value,discount_type=excluded.discount_type,discount_value=excluded.discount_value,priority=excluded.priority,valid_from=excluded.valid_from,valid_to=excluded.valid_to,is_active=excluded.is_active,metadata=excluded.metadata,updated_at=now()
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'code',v_code);
end; $$;

create or replace function public.kpi_pr_dev_upsert_package(p_token_hash text, p_package jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_id uuid; v_code text; v_label text; v_line jsonb; v_item_id uuid; v_count integer:=0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  v_code:=nullif(trim(p_package->>'code'),''); v_label:=nullif(trim(p_package->>'label'),'');
  if v_code is null or v_label is null then raise exception 'Code et libellé de forfait requis.'; end if;
  insert into public.kpi_pr_packages(code,label,description,fixed_price_ht,discount_percent,is_active,metadata,updated_at)
  values(v_code,v_label,nullif(trim(p_package->>'description'),''),nullif(p_package->>'fixedPriceHt','')::numeric,coalesce(nullif(p_package->>'discountPercent','')::numeric,0),coalesce((p_package->>'isActive')::boolean,true),coalesce(p_package->'metadata','{}'::jsonb),now())
  on conflict(code) do update set label=excluded.label,description=excluded.description,fixed_price_ht=excluded.fixed_price_ht,discount_percent=excluded.discount_percent,is_active=excluded.is_active,metadata=excluded.metadata,updated_at=now()
  returning id into v_id;
  delete from public.kpi_pr_package_lines where package_id=v_id;
  for v_line in select value from jsonb_array_elements(coalesce(p_package->'lines','[]'::jsonb)) loop
    v_item_id:=null;
    if coalesce(v_line->>'lineType','')='part' then
      select id into v_item_id from public.kpi_pr_items where reference=trim(v_line->>'reference') limit 1;
      if v_item_id is null then raise exception 'Référence forfait inconnue : %',coalesce(v_line->>'reference',''); end if;
    end if;
    insert into public.kpi_pr_package_lines(package_id,line_type,item_id,label,quantity,labor_minutes,public_unit_price_ht,cost_unit_ht,sort_order)
    values(v_id,coalesce(nullif(v_line->>'lineType',''),'fee'),v_item_id,coalesce(nullif(trim(v_line->>'label'),''),coalesce(v_line->>'reference','Ligne forfait')),coalesce(nullif(v_line->>'quantity','')::numeric,1),nullif(v_line->>'laborMinutes','')::numeric,nullif(v_line->>'publicUnitPriceHt','')::numeric,nullif(v_line->>'costUnitHt','')::numeric,v_count);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'id',v_id,'code',v_code,'lineCount',v_count);
end; $$;

create or replace function public.kpi_pr_dev_apply_package(p_token_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_auth record; v_package public.kpi_pr_packages%rowtype; v_line record; v_balance public.kpi_pr_stock_balances%rowtype; v_location public.kpi_pr_locations%rowtype;
  v_work_order text; v_registration text; v_vin text; v_base numeric:=0; v_discount numeric:=0; v_net numeric:=0; v_parts_cost numeric:=0; v_labor_cost numeric:=0; v_fee_cost numeric:=0; v_new_stock numeric; v_usage uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_package from public.kpi_pr_packages where code=trim(p_payload->>'packageCode') and is_active limit 1;
  if v_package.id is null then raise exception 'Forfait PR inconnu ou inactif.'; end if;
  v_work_order:=nullif(trim(p_payload->>'workOrder'),''); if v_work_order is null then raise exception 'OR requis pour appliquer un forfait.'; end if;
  v_registration:=nullif(trim(p_payload->>'registration'),''); v_vin:=nullif(trim(p_payload->>'vin'),'');
  if v_registration is null or v_vin is null then select coalesce(v_registration,m.registration),coalesce(v_vin,m.vin) into v_registration,v_vin from public.kpi_vehicle_identity_map m where m.work_order=v_work_order order by m.last_seen_at desc nulls last limit 1; end if;
  select * into v_location from public.kpi_pr_locations where code=coalesce(nullif(trim(p_payload->>'locationCode'),''),'MAG-PR') limit 1;
  if v_location.id is null then raise exception 'Emplacement PR inconnu.'; end if;
  for v_line in select pl.*,i.reference from public.kpi_pr_package_lines pl left join public.kpi_pr_items i on i.id=pl.item_id where pl.package_id=v_package.id order by pl.sort_order,pl.id loop
    v_base:=v_base+coalesce(v_line.public_unit_price_ht,0)*coalesce(v_line.quantity,1);
    if v_line.line_type='part' then
      select * into v_balance from public.kpi_pr_stock_balances where item_id=v_line.item_id and location_id=v_location.id for update;
      if v_balance.item_id is null or (v_balance.on_hand-v_balance.reserved)<v_line.quantity then raise exception 'Stock insuffisant pour la référence %.',v_line.reference; end if;
      v_new_stock:=v_balance.on_hand-v_line.quantity;
      update public.kpi_pr_stock_balances set on_hand=v_new_stock,updated_at=now() where item_id=v_line.item_id and location_id=v_location.id;
      v_parts_cost:=v_parts_cost+(v_line.quantity*v_balance.average_cost_ht);
      insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,work_order,registration,vin,reason,idempotency_key,actor_user_id,actor_name,metadata)
      values(v_line.item_id,v_location.id,'package_issue',-v_line.quantity,v_balance.average_cost_ht,round((-v_line.quantity)*v_balance.average_cost_ht,4),v_new_stock,v_balance.average_cost_ht,v_work_order,v_registration,v_vin,'Forfait '||v_package.code,'package:'||v_package.id::text||':'||v_work_order||':'||v_line.id::text,v_auth.user_id,v_auth.display_name,jsonb_build_object('packageCode',v_package.code,'packageLineId',v_line.id));
    elsif v_line.line_type='labor' then v_labor_cost:=v_labor_cost+coalesce(v_line.cost_unit_ht,0)*coalesce(v_line.quantity,1);
    else v_fee_cost:=v_fee_cost+coalesce(v_line.cost_unit_ht,0)*coalesce(v_line.quantity,1); end if;
  end loop;
  if v_package.fixed_price_ht is not null then v_base:=v_package.fixed_price_ht; end if;
  v_discount:=coalesce(nullif(p_payload->>'discountPercent','')::numeric,v_package.discount_percent,0); v_discount:=greatest(0,least(v_discount,100));
  v_net:=round(v_base*(1-v_discount/100),4);
  insert into public.kpi_pr_package_usages(package_id,work_order,registration,vin,base_price_ht,discount_percent,net_price_ht,parts_cost_ht,labor_cost_ht,fee_cost_ht,status,actor_user_id,actor_name,metadata)
  values(v_package.id,v_work_order,v_registration,v_vin,v_base,v_discount,v_net,v_parts_cost,v_labor_cost,v_fee_cost,'applied',v_auth.user_id,v_auth.display_name,coalesce(p_payload->'metadata','{}'::jsonb)) returning id into v_usage;
  return jsonb_build_object('ok',true,'usageId',v_usage,'packageCode',v_package.code,'workOrder',v_work_order,'basePriceHt',v_base,'discountPercent',v_discount,'netPriceHt',v_net,'partsCostHt',round(v_parts_cost,4),'laborCostHt',round(v_labor_cost,4),'feeCostHt',round(v_fee_cost,4),'grossMarginHt',round(v_net-v_parts_cost-v_labor_cost-v_fee_cost,4));
end; $$;

create or replace function public.kpi_pr_dev_save_setting(p_token_hash text, p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if p_key not in ('stock_policy','cmm_policy','sage_mapping') then raise exception 'Paramètre PR non autorisé.'; end if;
  insert into public.kpi_pr_settings(key,value,updated_by,updated_at) values(p_key,coalesce(p_value,'{}'::jsonb),v_auth.display_name,now()) on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('ok',true,'key',p_key,'value',p_value);
end; $$;

create or replace function public.kpi_pr_dev_prepare_sage_export(p_token_hash text, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_mapping jsonb; v_journal text; v_stock text; v_variation text; v_id uuid; v_batch text; v_count integer:=0; v_m record; v_amount numeric;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'Période comptable invalide.'; end if;
  select value into v_mapping from public.kpi_pr_settings where key='sage_mapping';
  v_journal:=nullif(trim(v_mapping->>'journalStock'),''); v_stock:=nullif(trim(v_mapping->>'accountStock'),''); v_variation:=nullif(trim(v_mapping->>'accountVariation'),'');
  if v_journal is null or v_stock is null or v_variation is null then raise exception 'Paramétrage Sage incomplet : journal, compte de stock et compte de variation requis.'; end if;
  v_batch:='PR-SAGE-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS');
  insert into public.kpi_pr_accounting_exports(batch_number,export_format,status,period_start,period_end,mapping_snapshot,created_by) values(v_batch,'sage100_parametric','draft',p_period_start,p_period_end,v_mapping,v_auth.display_name) returning id into v_id;
  for v_m in select m.* from public.kpi_pr_movements m where m.created_at::date between p_period_start and p_period_end and m.movement_type not in ('transfer_in','transfer_out') and not exists(select 1 from public.kpi_pr_accounting_export_lines x where x.source_movement_id=m.id) order by m.created_at,m.id loop
    v_amount:=abs(round(v_m.value_delta_ht,2)); if v_amount=0 then continue; end if;
    if v_m.value_delta_ht>0 then
      insert into public.kpi_pr_accounting_export_lines(export_id,source_movement_id,journal_code,accounting_date,piece_reference,account_number,label,debit,credit,analytic_axis_1,analytic_axis_2)
      values(v_id,v_m.id,v_journal,v_m.created_at::date,coalesce(v_m.document_reference,v_m.work_order,v_batch),v_stock,coalesce(v_m.reason,'Mouvement PR'),v_amount,0,nullif(v_mapping->>'analyticAxis1',''),nullif(v_mapping->>'analyticAxis2',''));
      insert into public.kpi_pr_accounting_export_lines(export_id,journal_code,accounting_date,piece_reference,account_number,label,debit,credit,analytic_axis_1,analytic_axis_2,metadata)
      values(v_id,v_journal,v_m.created_at::date,coalesce(v_m.document_reference,v_m.work_order,v_batch),v_variation,coalesce(v_m.reason,'Mouvement PR'),0,v_amount,nullif(v_mapping->>'analyticAxis1',''),nullif(v_mapping->>'analyticAxis2',''),jsonb_build_object('pairedMovementId',v_m.id));
    else
      insert into public.kpi_pr_accounting_export_lines(export_id,source_movement_id,journal_code,accounting_date,piece_reference,account_number,label,debit,credit,analytic_axis_1,analytic_axis_2)
      values(v_id,v_m.id,v_journal,v_m.created_at::date,coalesce(v_m.document_reference,v_m.work_order,v_batch),v_stock,coalesce(v_m.reason,'Mouvement PR'),0,v_amount,nullif(v_mapping->>'analyticAxis1',''),nullif(v_mapping->>'analyticAxis2',''));
      insert into public.kpi_pr_accounting_export_lines(export_id,journal_code,accounting_date,piece_reference,account_number,label,debit,credit,analytic_axis_1,analytic_axis_2,metadata)
      values(v_id,v_journal,v_m.created_at::date,coalesce(v_m.document_reference,v_m.work_order,v_batch),v_variation,coalesce(v_m.reason,'Mouvement PR'),v_amount,0,nullif(v_mapping->>'analyticAxis1',''),nullif(v_mapping->>'analyticAxis2',''),jsonb_build_object('pairedMovementId',v_m.id));
    end if;
    v_count:=v_count+2;
  end loop;
  update public.kpi_pr_accounting_exports set status=case when v_count>0 then 'ready' else 'draft' end where id=v_id;
  return jsonb_build_object('ok',true,'exportId',v_id,'batchNumber',v_batch,'lineCount',v_count,'status',case when v_count>0 then 'ready' else 'draft' end);
end; $$;

create or replace function public.kpi_pr_dev_accounting_export_get(p_token_hash text, p_export_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_export public.kpi_pr_accounting_exports%rowtype; v_lines jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_export from public.kpi_pr_accounting_exports where id=p_export_id limit 1; if v_export.id is null then raise exception 'Export Sage introuvable.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('journalCode',l.journal_code,'accountingDate',l.accounting_date,'pieceReference',l.piece_reference,'accountNumber',l.account_number,'auxiliaryAccount',l.auxiliary_account,'label',l.label,'debit',l.debit,'credit',l.credit,'analyticAxis1',l.analytic_axis_1,'analyticAxis2',l.analytic_axis_2) order by l.id),'[]'::jsonb) into v_lines from public.kpi_pr_accounting_export_lines l where l.export_id=p_export_id;
  return jsonb_build_object('connected',true,'export',jsonb_build_object('id',v_export.id,'batchNumber',v_export.batch_number,'status',v_export.status,'format',v_export.export_format,'periodStart',v_export.period_start,'periodEnd',v_export.period_end,'createdAt',v_export.created_at),'lines',v_lines);
end; $$;

revoke all on function public.kpi_pr_dev_upsert_discount_rule(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_upsert_package(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_apply_package(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_save_setting(text,text,jsonb) from public;
revoke all on function public.kpi_pr_dev_prepare_sage_export(text,date,date) from public;
revoke all on function public.kpi_pr_dev_accounting_export_get(text,uuid) from public;
grant execute on function public.kpi_pr_dev_upsert_discount_rule(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_upsert_package(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_apply_package(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_save_setting(text,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_prepare_sage_export(text,date,date) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_accounting_export_get(text,uuid) to anon,authenticated,service_role;
