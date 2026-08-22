alter table public.kpi_pr_items drop constraint if exists kpi_pr_items_reference_key;
alter table public.kpi_pr_items add column if not exists reference_key text;
alter table public.kpi_pr_items add column if not exists manufacturer_key text;
update public.kpi_pr_items set reference=btrim(reference), manufacturer_label=nullif(btrim(manufacturer_label),''), reference_key=upper(btrim(reference)), manufacturer_key=upper(coalesce(nullif(btrim(manufacturer_label),''),''));
alter table public.kpi_pr_items alter column reference_key set not null;
alter table public.kpi_pr_items alter column manufacturer_key set not null;
create unique index if not exists kpi_pr_items_reference_manufacturer_uq on public.kpi_pr_items(reference_key,manufacturer_key);
create index if not exists kpi_pr_items_reference_key_idx on public.kpi_pr_items(reference_key);

create or replace function public.kpi_pr_items_identity_biu() returns trigger language plpgsql set search_path=public as $$
begin
  new.reference:=btrim(new.reference);
  if new.reference is null or new.reference='' then raise exception 'Référence PR requise.'; end if;
  new.manufacturer_label:=nullif(btrim(new.manufacturer_label),'');
  new.reference_key:=upper(new.reference);
  new.manufacturer_key:=upper(coalesce(new.manufacturer_label,''));
  return new;
end;
$$;
drop trigger if exists kpi_pr_items_identity_biu on public.kpi_pr_items;
create trigger kpi_pr_items_identity_biu before insert or update of reference,manufacturer_label on public.kpi_pr_items for each row execute function public.kpi_pr_items_identity_biu();

create table if not exists public.kpi_pr_catalog_source_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.kpi_pr_import_batches(id) on delete cascade,
  row_no integer not null,
  reference text,
  manufacturer_label text,
  description text,
  purchase_price_ht numeric(14,4),
  source_stock_qty numeric(16,3),
  source_cmm numeric(16,3),
  source_pamp numeric(14,4),
  location_code text,
  last_entry_date date,
  last_issue_date date,
  category_code text,
  accounting_class text,
  replacement_reference text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(batch_id,row_no)
);
create index if not exists kpi_pr_catalog_source_rows_batch_idx on public.kpi_pr_catalog_source_rows(batch_id,row_no);
create index if not exists kpi_pr_catalog_source_rows_ref_idx on public.kpi_pr_catalog_source_rows(batch_id,upper(btrim(reference)));
alter table public.kpi_pr_catalog_source_rows enable row level security;
revoke all on public.kpi_pr_catalog_source_rows from anon,authenticated;

create or replace function public.kpi_pr_internal_resolve_item_id(p_item_id uuid,p_reference text,p_manufacturer_label text default null)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare v_id uuid; v_count integer;
begin
  if p_item_id is not null then
    select id into v_id from public.kpi_pr_items where id=p_item_id and is_active limit 1;
    if v_id is null then raise exception 'Référence PR inconnue.'; end if;
    return v_id;
  end if;
  if nullif(btrim(coalesce(p_reference,'')),'') is null then raise exception 'Référence PR requise.'; end if;
  if nullif(btrim(coalesce(p_manufacturer_label,'')),'') is not null then
    select count(*),min(id) into v_count,v_id from public.kpi_pr_items where reference_key=upper(btrim(p_reference)) and manufacturer_key=upper(btrim(p_manufacturer_label)) and is_active;
  else
    select count(*),min(id) into v_count,v_id from public.kpi_pr_items where reference_key=upper(btrim(p_reference)) and is_active;
  end if;
  if v_count=0 then raise exception 'Référence PR inconnue.'; end if;
  if v_count>1 then raise exception 'Référence PR ambiguë : précisez la marque ou sélectionnez la fiche pièce.'; end if;
  return v_id;
end;
$$;
revoke all on function public.kpi_pr_internal_resolve_item_id(uuid,text,text) from public,anon,authenticated;
