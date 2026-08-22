create table if not exists public.kpi_pr_items (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  manufacturer_code text,
  manufacturer_label text,
  description text not null,
  ean text,
  family text,
  category text,
  unit text not null default 'U',
  list_price_ht numeric(14,4),
  standard_purchase_price_ht numeric(14,4),
  vat_rate numeric(7,4) not null default 20,
  replacement_reference text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kpi_pr_items_description_idx on public.kpi_pr_items using gin (to_tsvector('simple', coalesce(reference,'') || ' ' || coalesce(description,'') || ' ' || coalesce(ean,'')));
create index if not exists kpi_pr_items_family_idx on public.kpi_pr_items(family, category);

create table if not exists public.kpi_pr_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  zone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_pr_stock_balances (
  item_id uuid not null references public.kpi_pr_items(id) on delete restrict,
  location_id uuid not null references public.kpi_pr_locations(id) on delete restrict,
  on_hand numeric(16,3) not null default 0,
  reserved numeric(16,3) not null default 0,
  average_cost_ht numeric(14,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key(item_id, location_id),
  constraint kpi_pr_stock_balances_reserved_nonnegative check (reserved >= 0),
  constraint kpi_pr_stock_balances_reserved_le_stock check (reserved <= on_hand)
);

create table if not exists public.kpi_pr_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  inventory_type text not null default 'cycle' check (inventory_type in ('annual','cycle','manual')),
  status text not null default 'open' check (status in ('draft','open','counting','recount','closed','cancelled')),
  blind_count boolean not null default true,
  filters jsonb not null default '{}'::jsonb,
  quantity_recount_threshold numeric(16,3) not null default 1,
  value_recount_threshold numeric(14,2) not null default 50,
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz
);

create table if not exists public.kpi_pr_inventory_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.kpi_pr_inventory_sessions(id) on delete cascade,
  item_id uuid not null references public.kpi_pr_items(id) on delete restrict,
  location_id uuid not null references public.kpi_pr_locations(id) on delete restrict,
  theoretical_qty numeric(16,3) not null,
  average_cost_snapshot numeric(14,4) not null default 0,
  first_count_qty numeric(16,3),
  second_count_qty numeric(16,3),
  final_qty numeric(16,3),
  variance_qty numeric(16,3),
  variance_value numeric(14,2),
  recount_required boolean not null default false,
  counted_by text,
  counted_at timestamptz,
  recounted_by text,
  recounted_at timestamptz,
  closed_at timestamptz,
  unique(session_id,item_id,location_id)
);

create table if not exists public.kpi_pr_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.kpi_pr_items(id) on delete restrict,
  location_id uuid not null references public.kpi_pr_locations(id) on delete restrict,
  movement_type text not null check (movement_type in ('initial_stock','receipt','issue_work_order','return_work_order','inventory_adjustment','transfer_in','transfer_out','manual_adjustment','package_issue')),
  quantity_delta numeric(16,3) not null check (quantity_delta <> 0),
  applied_unit_cost_ht numeric(14,4) not null default 0,
  value_delta_ht numeric(16,4) not null default 0,
  balance_after numeric(16,3) not null,
  average_cost_after numeric(14,4) not null default 0,
  work_order text,
  registration text,
  vin text,
  supplier_reference text,
  document_reference text,
  inventory_session_id uuid references public.kpi_pr_inventory_sessions(id) on delete set null,
  inventory_line_id uuid references public.kpi_pr_inventory_lines(id) on delete set null,
  reason text,
  idempotency_key text unique,
  actor_user_id uuid,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kpi_pr_movements_item_created_idx on public.kpi_pr_movements(item_id, created_at desc);
create index if not exists kpi_pr_movements_work_order_idx on public.kpi_pr_movements(work_order, created_at desc);
create index if not exists kpi_pr_movements_inventory_idx on public.kpi_pr_movements(inventory_session_id, created_at);

create table if not exists public.kpi_pr_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.kpi_pr_items(id) on delete restrict,
  location_id uuid not null references public.kpi_pr_locations(id) on delete restrict,
  work_order text not null,
  registration text,
  vin text,
  quantity numeric(16,3) not null check (quantity > 0),
  status text not null default 'active' check (status in ('active','served','released','cancelled')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  served_at timestamptz,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists kpi_pr_reservations_work_order_idx on public.kpi_pr_reservations(work_order,status);

create table if not exists public.kpi_pr_price_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.kpi_pr_items(id) on delete cascade,
  price_type text not null check (price_type in ('manufacturer_list','purchase','public_sale')),
  amount_ht numeric(14,4) not null,
  currency text not null default 'EUR',
  effective_from date not null,
  effective_to date,
  source_name text,
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kpi_pr_price_history_lookup_idx on public.kpi_pr_price_history(item_id,price_type,effective_from desc);

create table if not exists public.kpi_pr_discount_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  scope_type text not null check (scope_type in ('global','client','family','category','item','package')),
  scope_value text,
  discount_type text not null check (discount_type in ('percent','amount')),
  discount_value numeric(14,4) not null,
  priority integer not null default 100,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_pr_packages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  description text,
  fixed_price_ht numeric(14,4),
  discount_percent numeric(7,4) not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_pr_package_lines (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.kpi_pr_packages(id) on delete cascade,
  line_type text not null check (line_type in ('part','labor','fee')),
  item_id uuid references public.kpi_pr_items(id) on delete restrict,
  label text not null,
  quantity numeric(14,3) not null default 1,
  labor_minutes numeric(12,2),
  public_unit_price_ht numeric(14,4),
  cost_unit_ht numeric(14,4),
  sort_order integer not null default 0
);

create table if not exists public.kpi_pr_accounting_exports (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  export_format text not null default 'sage100_parametric' check (export_format in ('sage100_parametric','sage100_fec','csv_generic')),
  status text not null default 'draft' check (status in ('draft','ready','exported','cancelled','error')),
  period_start date not null,
  period_end date not null,
  mapping_snapshot jsonb not null default '{}'::jsonb,
  checksum text,
  created_by text,
  created_at timestamptz not null default now(),
  exported_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.kpi_pr_accounting_export_lines (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.kpi_pr_accounting_exports(id) on delete cascade,
  source_movement_id uuid references public.kpi_pr_movements(id) on delete restrict,
  journal_code text,
  accounting_date date,
  piece_reference text,
  account_number text,
  auxiliary_account text,
  label text,
  debit numeric(16,2) not null default 0,
  credit numeric(16,2) not null default 0,
  analytic_axis_1 text,
  analytic_axis_2 text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.kpi_pr_import_batches (
  id uuid primary key default gen_random_uuid(),
  import_type text not null check (import_type in ('initial_stock','catalog','manufacturer_tariff','aaa_vehicle_reference')),
  source_name text,
  source_fingerprint text unique,
  status text not null default 'received' check (status in ('received','validated','imported','rejected','error')),
  row_count integer not null default 0,
  imported_count integer not null default 0,
  rejected_count integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.kpi_pr_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into public.kpi_pr_settings(key,value)
values
  ('stock_policy', '{"allowNegativeStock":false,"defaultLocationCode":"MAG-PR"}'::jsonb),
  ('cmm_policy', '{"windowMonths":6,"dormantDays":180,"slowCoverageDays":120}'::jsonb),
  ('sage_mapping', '{"journalStock":"","accountStock":"","accountVariation":"","analyticAxis1":"","analyticAxis2":""}'::jsonb)
on conflict (key) do nothing;

insert into public.kpi_pr_locations(code,label,zone)
values ('MAG-PR','Magasin PR principal','PR')
on conflict (code) do nothing;

alter table public.kpi_pr_items enable row level security;
alter table public.kpi_pr_locations enable row level security;
alter table public.kpi_pr_stock_balances enable row level security;
alter table public.kpi_pr_movements enable row level security;
alter table public.kpi_pr_reservations enable row level security;
alter table public.kpi_pr_inventory_sessions enable row level security;
alter table public.kpi_pr_inventory_lines enable row level security;
alter table public.kpi_pr_price_history enable row level security;
alter table public.kpi_pr_discount_rules enable row level security;
alter table public.kpi_pr_packages enable row level security;
alter table public.kpi_pr_package_lines enable row level security;
alter table public.kpi_pr_accounting_exports enable row level security;
alter table public.kpi_pr_accounting_export_lines enable row level security;
alter table public.kpi_pr_import_batches enable row level security;
alter table public.kpi_pr_settings enable row level security;

revoke all on public.kpi_pr_items, public.kpi_pr_locations, public.kpi_pr_stock_balances, public.kpi_pr_movements, public.kpi_pr_reservations, public.kpi_pr_inventory_sessions, public.kpi_pr_inventory_lines, public.kpi_pr_price_history, public.kpi_pr_discount_rules, public.kpi_pr_packages, public.kpi_pr_package_lines, public.kpi_pr_accounting_exports, public.kpi_pr_accounting_export_lines, public.kpi_pr_import_batches, public.kpi_pr_settings from anon, authenticated;

create or replace function public.kpi_pr_dev_upsert_item(p_token_hash text, p_item jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_id uuid;
  v_reference text;
  v_description text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  v_reference := nullif(trim(p_item->>'reference'),'');
  v_description := nullif(trim(p_item->>'description'),'');
  if v_reference is null or v_description is null then raise exception 'Référence et désignation requises.'; end if;

  insert into public.kpi_pr_items(reference,manufacturer_code,manufacturer_label,description,ean,family,category,unit,list_price_ht,standard_purchase_price_ht,vat_rate,replacement_reference,is_active,metadata,updated_at)
  values(
    v_reference,
    nullif(trim(p_item->>'manufacturerCode'),''),
    nullif(trim(p_item->>'manufacturerLabel'),''),
    v_description,
    nullif(trim(p_item->>'ean'),''),
    nullif(trim(p_item->>'family'),''),
    nullif(trim(p_item->>'category'),''),
    coalesce(nullif(trim(p_item->>'unit'),''),'U'),
    nullif(p_item->>'listPriceHt','')::numeric,
    nullif(p_item->>'standardPurchasePriceHt','')::numeric,
    coalesce(nullif(p_item->>'vatRate','')::numeric,20),
    nullif(trim(p_item->>'replacementReference'),''),
    coalesce((p_item->>'isActive')::boolean,true),
    coalesce(p_item->'metadata','{}'::jsonb),
    now()
  )
  on conflict(reference) do update set
    manufacturer_code=excluded.manufacturer_code,
    manufacturer_label=excluded.manufacturer_label,
    description=excluded.description,
    ean=excluded.ean,
    family=excluded.family,
    category=excluded.category,
    unit=excluded.unit,
    list_price_ht=excluded.list_price_ht,
    standard_purchase_price_ht=excluded.standard_purchase_price_ht,
    vat_rate=excluded.vat_rate,
    replacement_reference=excluded.replacement_reference,
    is_active=excluded.is_active,
    metadata=excluded.metadata,
    updated_at=now()
  returning id into v_id;

  return jsonb_build_object('ok',true,'id',v_id,'reference',v_reference);
end;
$$;

create or replace function public.kpi_pr_dev_post_movement(p_token_hash text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_item public.kpi_pr_items%rowtype;
  v_location public.kpi_pr_locations%rowtype;
  v_balance public.kpi_pr_stock_balances%rowtype;
  v_existing public.kpi_pr_movements%rowtype;
  v_type text;
  v_delta numeric;
  v_unit_cost numeric;
  v_new_stock numeric;
  v_new_avg numeric;
  v_value_delta numeric;
  v_work_order text;
  v_registration text;
  v_vin text;
  v_idempotency text;
  v_movement_id uuid;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  select * into v_item from public.kpi_pr_items where reference=trim(p_payload->>'reference') limit 1;
  if v_item.id is null then raise exception 'Référence PR inconnue.'; end if;
  select * into v_location from public.kpi_pr_locations where code=coalesce(nullif(trim(p_payload->>'locationCode'),''),'MAG-PR') limit 1;
  if v_location.id is null then raise exception 'Emplacement PR inconnu.'; end if;

  v_type := trim(p_payload->>'movementType');
  if v_type not in ('initial_stock','receipt','issue_work_order','return_work_order','inventory_adjustment','transfer_in','transfer_out','manual_adjustment','package_issue') then raise exception 'Type de mouvement PR invalide.'; end if;
  v_delta := nullif(p_payload->>'quantityDelta','')::numeric;
  if v_delta is null or v_delta=0 then raise exception 'Quantité de mouvement invalide.'; end if;
  v_idempotency := nullif(trim(p_payload->>'idempotencyKey'),'');

  if v_idempotency is not null then
    select * into v_existing from public.kpi_pr_movements where idempotency_key=v_idempotency limit 1;
    if v_existing.id is not null then
      return jsonb_build_object('ok',true,'idempotent',true,'movementId',v_existing.id,'balanceAfter',v_existing.balance_after,'averageCostAfter',v_existing.average_cost_after);
    end if;
  end if;

  insert into public.kpi_pr_stock_balances(item_id,location_id,on_hand,reserved,average_cost_ht)
  values(v_item.id,v_location.id,0,0,0)
  on conflict(item_id,location_id) do nothing;

  select * into v_balance from public.kpi_pr_stock_balances where item_id=v_item.id and location_id=v_location.id for update;

  v_new_stock := v_balance.on_hand + v_delta;
  if v_new_stock < 0 then raise exception 'Stock négatif interdit pour cette référence.'; end if;
  if v_new_stock < v_balance.reserved then raise exception 'Mouvement impossible : stock réservé supérieur au stock restant.'; end if;

  v_unit_cost := nullif(p_payload->>'unitCostHt','')::numeric;
  if v_delta < 0 then
    v_unit_cost := v_balance.average_cost_ht;
    v_new_avg := v_balance.average_cost_ht;
  else
    v_unit_cost := coalesce(v_unit_cost, nullif(v_item.standard_purchase_price_ht,0), v_balance.average_cost_ht, 0);
    if v_new_stock > 0 then
      v_new_avg := case
        when v_balance.on_hand <= 0 then v_unit_cost
        when v_type in ('receipt','initial_stock','inventory_adjustment','manual_adjustment','return_work_order','transfer_in') then ((v_balance.on_hand*v_balance.average_cost_ht)+(v_delta*v_unit_cost))/v_new_stock
        else v_balance.average_cost_ht
      end;
    else
      v_new_avg := v_balance.average_cost_ht;
    end if;
  end if;
  v_new_avg := coalesce(v_new_avg,0);
  v_value_delta := round(v_delta*v_unit_cost,4);

  v_work_order := nullif(trim(p_payload->>'workOrder'),'');
  v_registration := nullif(trim(p_payload->>'registration'),'');
  v_vin := nullif(trim(p_payload->>'vin'),'');
  if v_work_order is not null and (v_registration is null or v_vin is null) then
    select coalesce(v_registration,m.registration), coalesce(v_vin,m.vin)
      into v_registration,v_vin
      from public.kpi_vehicle_identity_map m
     where m.work_order=v_work_order
     order by m.last_seen_at desc nulls last
     limit 1;
  end if;

  update public.kpi_pr_stock_balances
     set on_hand=v_new_stock, average_cost_ht=v_new_avg, updated_at=now()
   where item_id=v_item.id and location_id=v_location.id;

  insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,work_order,registration,vin,supplier_reference,document_reference,reason,idempotency_key,actor_user_id,actor_name,metadata)
  values(v_item.id,v_location.id,v_type,v_delta,v_unit_cost,v_value_delta,v_new_stock,v_new_avg,v_work_order,v_registration,v_vin,nullif(trim(p_payload->>'supplierReference'),''),nullif(trim(p_payload->>'documentReference'),''),nullif(trim(p_payload->>'reason'),''),v_idempotency,v_auth.user_id,v_auth.display_name,coalesce(p_payload->'metadata','{}'::jsonb))
  returning id into v_movement_id;

  return jsonb_build_object('ok',true,'movementId',v_movement_id,'reference',v_item.reference,'locationCode',v_location.code,'balanceAfter',v_new_stock,'averageCostAfter',v_new_avg,'valueDeltaHt',v_value_delta);
end;
$$;

create or replace function public.kpi_pr_dev_create_inventory(p_token_hash text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_session uuid;
  v_code text;
  v_location_code text;
  v_count integer;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  v_code := 'INV-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS');
  v_location_code := nullif(trim(p_filters->>'locationCode'),'');
  insert into public.kpi_pr_inventory_sessions(code,inventory_type,status,blind_count,filters,quantity_recount_threshold,value_recount_threshold,created_by)
  values(v_code,coalesce(nullif(p_filters->>'inventoryType',''),'cycle'),'counting',coalesce((p_filters->>'blindCount')::boolean,true),coalesce(p_filters,'{}'::jsonb),coalesce(nullif(p_filters->>'quantityRecountThreshold','')::numeric,1),coalesce(nullif(p_filters->>'valueRecountThreshold','')::numeric,50),v_auth.display_name)
  returning id into v_session;

  insert into public.kpi_pr_inventory_lines(session_id,item_id,location_id,theoretical_qty,average_cost_snapshot)
  select v_session,b.item_id,b.location_id,b.on_hand,b.average_cost_ht
    from public.kpi_pr_stock_balances b
    join public.kpi_pr_locations l on l.id=b.location_id
    join public.kpi_pr_items i on i.id=b.item_id
   where (v_location_code is null or l.code=v_location_code)
     and (nullif(trim(p_filters->>'family'),'') is null or i.family=trim(p_filters->>'family'))
     and (nullif(trim(p_filters->>'category'),'') is null or i.category=trim(p_filters->>'category'))
     and (coalesce((p_filters->>'includeZeroStock')::boolean,false) or b.on_hand<>0)
   order by l.code,i.reference;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok',true,'sessionId',v_session,'code',v_code,'lineCount',v_count);
end;
$$;

create or replace function public.kpi_pr_dev_count_inventory_line(p_token_hash text, p_line_id uuid, p_count numeric)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_line public.kpi_pr_inventory_lines%rowtype;
  v_session public.kpi_pr_inventory_sessions%rowtype;
  v_variance numeric;
  v_value numeric;
  v_recount boolean;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if p_count is null or p_count<0 then raise exception 'Comptage invalide.'; end if;

  select * into v_line from public.kpi_pr_inventory_lines where id=p_line_id for update;
  if v_line.id is null then raise exception 'Ligne inventaire introuvable.'; end if;
  select * into v_session from public.kpi_pr_inventory_sessions where id=v_line.session_id for update;
  if v_session.status not in ('counting','recount') then raise exception 'Inventaire non modifiable.'; end if;

  v_variance := p_count-v_line.theoretical_qty;
  v_value := round(v_variance*v_line.average_cost_snapshot,2);
  v_recount := abs(v_variance)>=v_session.quantity_recount_threshold or abs(v_value)>=v_session.value_recount_threshold;

  if v_line.first_count_qty is null then
    update public.kpi_pr_inventory_lines set first_count_qty=p_count,variance_qty=v_variance,variance_value=v_value,recount_required=v_recount,counted_by=v_auth.display_name,counted_at=now(),final_qty=case when v_recount then null else p_count end where id=p_line_id;
  else
    update public.kpi_pr_inventory_lines set second_count_qty=p_count,variance_qty=v_variance,variance_value=v_value,recount_required=false,recounted_by=v_auth.display_name,recounted_at=now(),final_qty=p_count where id=p_line_id;
  end if;

  if v_recount then update public.kpi_pr_inventory_sessions set status='recount' where id=v_session.id; end if;
  return jsonb_build_object('ok',true,'lineId',p_line_id,'varianceQty',v_variance,'varianceValue',v_value,'recountRequired',v_recount);
end;
$$;

create or replace function public.kpi_pr_dev_close_inventory(p_token_hash text, p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_session public.kpi_pr_inventory_sessions%rowtype;
  v_line record;
  v_balance public.kpi_pr_stock_balances%rowtype;
  v_delta numeric;
  v_new_stock numeric;
  v_total_value numeric:=0;
  v_adjustments integer:=0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  select * into v_session from public.kpi_pr_inventory_sessions where id=p_session_id for update;
  if v_session.id is null then raise exception 'Inventaire introuvable.'; end if;
  if v_session.status='closed' then return jsonb_build_object('ok',true,'alreadyClosed',true,'sessionId',p_session_id); end if;
  if exists(select 1 from public.kpi_pr_inventory_lines where session_id=p_session_id and final_qty is null) then raise exception 'Toutes les lignes doivent être comptées ou recomptées avant clôture.'; end if;

  for v_line in select * from public.kpi_pr_inventory_lines where session_id=p_session_id order by id loop
    v_delta := v_line.final_qty-v_line.theoretical_qty;
    if v_delta<>0 then
      select * into v_balance from public.kpi_pr_stock_balances where item_id=v_line.item_id and location_id=v_line.location_id for update;
      v_new_stock := v_balance.on_hand+v_delta;
      if v_new_stock<0 then raise exception 'Clôture impossible : stock négatif.'; end if;
      if v_new_stock<v_balance.reserved then raise exception 'Clôture impossible : stock réservé supérieur au stock compté.'; end if;
      update public.kpi_pr_stock_balances set on_hand=v_new_stock,updated_at=now() where item_id=v_line.item_id and location_id=v_line.location_id;
      insert into public.kpi_pr_movements(item_id,location_id,movement_type,quantity_delta,applied_unit_cost_ht,value_delta_ht,balance_after,average_cost_after,inventory_session_id,inventory_line_id,reason,idempotency_key,actor_user_id,actor_name)
      values(v_line.item_id,v_line.location_id,'inventory_adjustment',v_delta,v_balance.average_cost_ht,round(v_delta*v_balance.average_cost_ht,4),v_new_stock,v_balance.average_cost_ht,p_session_id,v_line.id,'Clôture inventaire '||v_session.code,'inventory:'||p_session_id::text||':'||v_line.id::text,v_auth.user_id,v_auth.display_name)
      on conflict(idempotency_key) do nothing;
      v_adjustments:=v_adjustments+1;
      v_total_value:=v_total_value+round(v_delta*v_balance.average_cost_ht,2);
    end if;
    update public.kpi_pr_inventory_lines set closed_at=now() where id=v_line.id;
  end loop;

  update public.kpi_pr_inventory_sessions set status='closed',closed_by=v_auth.display_name,closed_at=now() where id=p_session_id;
  return jsonb_build_object('ok',true,'sessionId',p_session_id,'adjustmentCount',v_adjustments,'varianceValue',v_total_value);
end;
$$;

create or replace function public.kpi_pr_dev_snapshot(p_token_hash text, p_query text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_cmm_months integer:=6;
  v_q text:=nullif(trim(coalesce(p_query,'')),'');
  v_items jsonb;
  v_movements jsonb;
  v_inventories jsonb;
  v_packages jsonb;
  v_discounts jsonb;
  v_settings jsonb;
  v_summary jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  select coalesce((value->>'windowMonths')::integer,6) into v_cmm_months from public.kpi_pr_settings where key='cmm_policy';
  v_cmm_months:=greatest(1,least(coalesce(v_cmm_months,6),24));

  with stock as (
    select i.id,i.reference,i.manufacturer_code,i.manufacturer_label,i.description,i.ean,i.family,i.category,i.unit,i.list_price_ht,i.standard_purchase_price_ht,i.vat_rate,i.is_active,
           coalesce(sum(b.on_hand),0) on_hand,coalesce(sum(b.reserved),0) reserved,
           case when coalesce(sum(b.on_hand),0)=0 then coalesce(max(b.average_cost_ht),0) else coalesce(sum(b.on_hand*b.average_cost_ht)/nullif(sum(b.on_hand),0),0) end average_cost,
           coalesce(sum(b.on_hand*b.average_cost_ht),0) stock_value
      from public.kpi_pr_items i
      left join public.kpi_pr_stock_balances b on b.item_id=i.id
     where v_q is null or i.reference ilike '%'||v_q||'%' or i.description ilike '%'||v_q||'%' or coalesce(i.ean,'') ilike '%'||v_q||'%'
     group by i.id
  ), consumption as (
    select m.item_id,
           coalesce(sum(case when m.quantity_delta<0 and m.movement_type in ('issue_work_order','package_issue') then -m.quantity_delta else 0 end),0)/v_cmm_months::numeric cmm,
           max(m.created_at) filter(where m.quantity_delta<0 and m.movement_type in ('issue_work_order','package_issue')) last_issue_at
      from public.kpi_pr_movements m
     where m.created_at>=now()-make_interval(months=>v_cmm_months)
     group by m.item_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'reference',s.reference,'manufacturerCode',s.manufacturer_code,'manufacturerLabel',s.manufacturer_label,'description',s.description,'ean',s.ean,'family',s.family,'category',s.category,'unit',s.unit,
    'listPriceHt',s.list_price_ht,'standardPurchasePriceHt',s.standard_purchase_price_ht,'vatRate',s.vat_rate,'isActive',s.is_active,
    'onHand',s.on_hand,'reserved',s.reserved,'available',s.on_hand-s.reserved,'averageCostHt',round(s.average_cost,4),'stockValueHt',round(s.stock_value,2),
    'cmm',round(coalesce(c.cmm,0),3),'coverageDays',case when coalesce(c.cmm,0)>0 then round(((s.on_hand-s.reserved)/c.cmm)*30,1) else null end,'lastIssueAt',c.last_issue_at
  ) order by s.stock_value desc,s.reference),'[]'::jsonb) into v_items
  from stock s left join consumption c on c.item_id=s.id;

  select coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb) into v_movements from (
    select m.created_at,jsonb_build_object('id',m.id,'createdAt',m.created_at,'movementType',m.movement_type,'reference',i.reference,'description',i.description,'locationCode',l.code,'quantityDelta',m.quantity_delta,'unitCostHt',m.applied_unit_cost_ht,'valueDeltaHt',m.value_delta_ht,'balanceAfter',m.balance_after,'workOrder',m.work_order,'registration',m.registration,'vin',m.vin,'documentReference',m.document_reference,'reason',m.reason,'actorName',m.actor_name) obj
      from public.kpi_pr_movements m join public.kpi_pr_items i on i.id=m.item_id join public.kpi_pr_locations l on l.id=m.location_id
     order by m.created_at desc limit 100
  ) x;

  select coalesce(jsonb_agg(x.obj order by x.created_at desc),'[]'::jsonb) into v_inventories from (
    select s.created_at,jsonb_build_object('id',s.id,'code',s.code,'inventoryType',s.inventory_type,'status',s.status,'blindCount',s.blind_count,'createdAt',s.created_at,'closedAt',s.closed_at,'lineCount',count(l.id),'countedCount',count(l.id) filter(where l.first_count_qty is not null),'recountCount',count(l.id) filter(where l.recount_required),'varianceValue',coalesce(sum(l.variance_value),0)) obj
      from public.kpi_pr_inventory_sessions s left join public.kpi_pr_inventory_lines l on l.session_id=s.id
     group by s.id order by s.created_at desc limit 30
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'label',p.label,'description',p.description,'fixedPriceHt',p.fixed_price_ht,'discountPercent',p.discount_percent,'isActive',p.is_active,'lineCount',(select count(*) from public.kpi_pr_package_lines l where l.package_id=p.id)) order by p.code),'[]'::jsonb) into v_packages from public.kpi_pr_packages p;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'label',d.label,'scopeType',d.scope_type,'scopeValue',d.scope_value,'discountType',d.discount_type,'discountValue',d.discount_value,'priority',d.priority,'validFrom',d.valid_from,'validTo',d.valid_to,'isActive',d.is_active) order by d.priority,d.code),'[]'::jsonb) into v_discounts from public.kpi_pr_discount_rules d;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_settings from public.kpi_pr_settings;

  select jsonb_build_object(
    'references',count(*),
    'stockUnits',coalesce(sum(on_hand),0),
    'reservedUnits',coalesce(sum(reserved),0),
    'availableUnits',coalesce(sum(on_hand-reserved),0),
    'stockValueHt',coalesce(round(sum(on_hand*average_cost_ht),2),0),
    'locations',(select count(*) from public.kpi_pr_locations where is_active),
    'openInventories',(select count(*) from public.kpi_pr_inventory_sessions where status not in ('closed','cancelled')),
    'movements30d',(select count(*) from public.kpi_pr_movements where created_at>=now()-interval '30 days'),
    'cmmWindowMonths',v_cmm_months
  ) into v_summary
  from public.kpi_pr_stock_balances;

  return jsonb_build_object('connected',true,'mode','development-pr','summary',v_summary,'items',v_items,'movements',v_movements,'inventories',v_inventories,'packages',v_packages,'discountRules',v_discounts,'settings',v_settings);
end;
$$;

revoke all on function public.kpi_pr_dev_upsert_item(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_post_movement(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_create_inventory(text,jsonb) from public;
revoke all on function public.kpi_pr_dev_count_inventory_line(text,uuid,numeric) from public;
revoke all on function public.kpi_pr_dev_close_inventory(text,uuid) from public;
revoke all on function public.kpi_pr_dev_snapshot(text,text) from public;
grant execute on function public.kpi_pr_dev_upsert_item(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_post_movement(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_create_inventory(text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_count_inventory_line(text,uuid,numeric) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_close_inventory(text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_snapshot(text,text) to anon,authenticated,service_role;
