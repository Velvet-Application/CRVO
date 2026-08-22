create or replace function public.kpi_pr_dev_upsert_item(p_token_hash text,p_item jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_id uuid; v_reference text; v_description text; v_brand text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  v_reference:=nullif(btrim(p_item->>'reference'),''); v_description:=nullif(btrim(p_item->>'description'),''); v_brand:=nullif(btrim(p_item->>'manufacturerLabel'),'');
  if v_reference is null or v_description is null then raise exception 'Référence et désignation requises.'; end if;
  insert into public.kpi_pr_items(reference,manufacturer_code,manufacturer_label,description,ean,family,category,unit,list_price_ht,standard_purchase_price_ht,vat_rate,replacement_reference,is_active,metadata,reference_key,manufacturer_key,updated_at)
  values(v_reference,nullif(btrim(p_item->>'manufacturerCode'),''),v_brand,v_description,nullif(btrim(p_item->>'ean'),''),nullif(btrim(p_item->>'family'),''),nullif(btrim(p_item->>'category'),''),coalesce(nullif(btrim(p_item->>'unit'),''),'U'),nullif(p_item->>'listPriceHt','')::numeric,nullif(p_item->>'standardPurchasePriceHt','')::numeric,coalesce(nullif(p_item->>'vatRate','')::numeric,20),nullif(btrim(p_item->>'replacementReference'),''),coalesce((p_item->>'isActive')::boolean,true),coalesce(p_item->'metadata','{}'::jsonb),upper(v_reference),upper(coalesce(v_brand,'')),now())
  on conflict(reference_key,manufacturer_key) do update set manufacturer_code=excluded.manufacturer_code,manufacturer_label=excluded.manufacturer_label,description=excluded.description,ean=excluded.ean,family=excluded.family,category=excluded.category,unit=excluded.unit,list_price_ht=excluded.list_price_ht,standard_purchase_price_ht=excluded.standard_purchase_price_ht,vat_rate=excluded.vat_rate,replacement_reference=excluded.replacement_reference,is_active=excluded.is_active,metadata=public.kpi_pr_items.metadata||excluded.metadata,updated_at=now()
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'reference',v_reference,'manufacturerLabel',v_brand);
end;
$$;

create or replace function public.kpi_pr_dev_import_begin(p_token_hash text,p_source_name text,p_source_fingerprint text,p_mapping jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_batch public.kpi_pr_import_batches%rowtype;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_source_fingerprint,'')),'') is not null then
    select * into v_batch from public.kpi_pr_import_batches where source_fingerprint=btrim(p_source_fingerprint) limit 1;
    if v_batch.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'batchId',v_batch.id,'status',v_batch.status,'rowCount',v_batch.row_count,'importedCount',v_batch.imported_count,'report',v_batch.report); end if;
  end if;
  insert into public.kpi_pr_import_batches(import_type,source_name,source_fingerprint,status,mapping,created_by)
  values('catalog',nullif(btrim(p_source_name),''),nullif(btrim(p_source_fingerprint),''),'received',coalesce(p_mapping,'{}'::jsonb),v_auth.display_name) returning * into v_batch;
  return jsonb_build_object('ok',true,'duplicate',false,'batchId',v_batch.id,'status',v_batch.status);
end;
$$;

create or replace function public.kpi_pr_dev_import_catalog_chunk(p_token_hash text,p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_batch public.kpi_pr_import_batches%rowtype; v_source_count integer:=0; v_valid_count integer:=0; v_item_count integer:=0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_batch from public.kpi_pr_import_batches where id=p_batch_id and import_type='catalog' for update;
  if v_batch.id is null then raise exception 'Lot import catalogue introuvable.'; end if;
  if v_batch.status not in ('received','validated') then raise exception 'Lot import déjà clôturé.'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'Le lot de lignes doit être un tableau JSON.'; end if;

  with rows as (select * from jsonb_to_recordset(p_rows) as x(row_no integer,reference text,manufacturer_label text,description text,purchase_price_ht numeric,source_stock_qty numeric,source_cmm numeric,source_pamp numeric,location_code text,last_entry_date text,last_issue_date text,category_code text,accounting_class text,replacement_reference text,raw jsonb))
  insert into public.kpi_pr_catalog_source_rows(batch_id,row_no,reference,manufacturer_label,description,purchase_price_ht,source_stock_qty,source_cmm,source_pamp,location_code,last_entry_date,last_issue_date,category_code,accounting_class,replacement_reference,raw)
  select p_batch_id,row_no,nullif(btrim(reference),''),nullif(btrim(manufacturer_label),''),nullif(btrim(description),''),purchase_price_ht,source_stock_qty,source_cmm,source_pamp,nullif(btrim(location_code),''),nullif(last_entry_date,'')::date,nullif(last_issue_date,'')::date,nullif(btrim(category_code),''),nullif(btrim(accounting_class),''),nullif(btrim(replacement_reference),''),coalesce(raw,'{}'::jsonb)
  from rows where row_no is not null
  on conflict(batch_id,row_no) do update set reference=excluded.reference,manufacturer_label=excluded.manufacturer_label,description=excluded.description,purchase_price_ht=excluded.purchase_price_ht,source_stock_qty=excluded.source_stock_qty,source_cmm=excluded.source_cmm,source_pamp=excluded.source_pamp,location_code=excluded.location_code,last_entry_date=excluded.last_entry_date,last_issue_date=excluded.last_issue_date,category_code=excluded.category_code,accounting_class=excluded.accounting_class,replacement_reference=excluded.replacement_reference,raw=excluded.raw;
  get diagnostics v_source_count=row_count;

  with rows as (select * from jsonb_to_recordset(p_rows) as x(row_no integer,reference text,manufacturer_label text,description text,purchase_price_ht numeric,source_stock_qty numeric,source_cmm numeric,source_pamp numeric,location_code text,last_entry_date text,last_issue_date text,category_code text,accounting_class text,replacement_reference text,raw jsonb)),
  valid as (select row_no,btrim(reference) reference,nullif(btrim(manufacturer_label),'') manufacturer_label,btrim(description) description,purchase_price_ht,source_stock_qty,source_cmm,source_pamp,nullif(btrim(location_code),'') location_code,nullif(last_entry_date,'') last_entry_date,nullif(last_issue_date,'') last_issue_date,nullif(btrim(category_code),'') category_code,nullif(btrim(accounting_class),'') accounting_class,nullif(btrim(replacement_reference),'') replacement_reference,upper(btrim(reference)) reference_key,upper(coalesce(nullif(btrim(manufacturer_label),''),'')) manufacturer_key from rows where nullif(btrim(coalesce(reference,'')),'') is not null and nullif(btrim(coalesce(description,'')),'') is not null),
  canonical as (select distinct on(reference_key,manufacturer_key) * from valid order by reference_key,manufacturer_key,row_no desc)
  insert into public.kpi_pr_items(reference,manufacturer_label,description,family,category,unit,standard_purchase_price_ht,replacement_reference,is_active,metadata,reference_key,manufacturer_key,updated_at)
  select reference,manufacturer_label,description,accounting_class,category_code,'U',purchase_price_ht,replacement_reference,true,jsonb_strip_nulls(jsonb_build_object('managedReferenceKnown',true,'managedReferenceImportBatch',p_batch_id,'sourceRowNo',row_no,'sourceStockQty',source_stock_qty,'sourceCmm',source_cmm,'sourcePamp',source_pamp,'sourceLocation',location_code,'sourceLastEntryDate',last_entry_date,'sourceLastIssueDate',last_issue_date,'sourceAccountingClass',accounting_class,'sourceCategoryCode',category_code)),reference_key,manufacturer_key,now() from canonical
  on conflict(reference_key,manufacturer_key) do update set description=excluded.description,family=coalesce(excluded.family,public.kpi_pr_items.family),category=coalesce(excluded.category,public.kpi_pr_items.category),standard_purchase_price_ht=coalesce(excluded.standard_purchase_price_ht,public.kpi_pr_items.standard_purchase_price_ht),replacement_reference=coalesce(excluded.replacement_reference,public.kpi_pr_items.replacement_reference),metadata=public.kpi_pr_items.metadata||excluded.metadata,is_active=true,updated_at=now();
  get diagnostics v_item_count=row_count;
  select count(*) into v_valid_count from jsonb_array_elements(p_rows) r where nullif(btrim(coalesce(r->>'reference','')),'') is not null and nullif(btrim(coalesce(r->>'description','')),'') is not null;
  update public.kpi_pr_import_batches set status='validated' where id=p_batch_id;
  return jsonb_build_object('ok',true,'batchId',p_batch_id,'sourceRowsTouched',v_source_count,'validRows',v_valid_count,'catalogItemsTouched',v_item_count,'rejectedRows',jsonb_array_length(p_rows)-v_valid_count);
end;
$$;

create or replace function public.kpi_pr_dev_import_complete(p_token_hash text,p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_auth record; v_batch public.kpi_pr_import_batches%rowtype; v_report jsonb; v_rows integer; v_valid integer; v_unique_items integer; v_distinct_refs integer; v_collisions integer; v_pair_duplicates integer; v_brands integer; v_positive integer; v_negative integer; v_qty numeric; v_cmm integer; v_pamp integer; v_locations integer;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_batch from public.kpi_pr_import_batches where id=p_batch_id and import_type='catalog' for update;
  if v_batch.id is null then raise exception 'Lot import catalogue introuvable.'; end if;
  select count(*),count(*) filter(where reference is not null and description is not null),count(distinct upper(coalesce(manufacturer_label,''))),count(*) filter(where source_stock_qty>0),count(*) filter(where source_stock_qty<0),coalesce(sum(source_stock_qty) filter(where source_stock_qty>0),0),count(*) filter(where source_cmm is not null),count(*) filter(where source_pamp is not null),count(*) filter(where location_code is not null)
  into v_rows,v_valid,v_brands,v_positive,v_negative,v_qty,v_cmm,v_pamp,v_locations from public.kpi_pr_catalog_source_rows where batch_id=p_batch_id;
  select count(*) into v_unique_items from (select upper(btrim(reference)),upper(coalesce(btrim(manufacturer_label),'')) from public.kpi_pr_catalog_source_rows where batch_id=p_batch_id and reference is not null and description is not null group by 1,2) x;
  select count(distinct upper(btrim(reference))) into v_distinct_refs from public.kpi_pr_catalog_source_rows where batch_id=p_batch_id and reference is not null and description is not null;
  select count(*) into v_collisions from (select upper(btrim(reference)) from public.kpi_pr_catalog_source_rows where batch_id=p_batch_id and reference is not null and description is not null group by 1 having count(distinct upper(coalesce(btrim(manufacturer_label),'')))>1) x;
  v_pair_duplicates:=greatest(v_valid-v_unique_items,0);
  v_report:=jsonb_build_object('sourceRows',v_rows,'validRows',v_valid,'uniqueCatalogItems',v_unique_items,'distinctReferences',v_distinct_refs,'brands',v_brands,'crossBrandReferenceCollisions',v_collisions,'duplicateReferenceBrandRows',v_pair_duplicates,'sourcePositiveStockRows',v_positive,'sourceNegativeStockRows',v_negative,'sourcePositiveStockQuantity',v_qty,'sourceCmmRows',v_cmm,'sourcePampRows',v_pamp,'sourceLocationRows',v_locations,'stockImported',false,'stockImportNote','Les quantités du fichier Références Gérées sont conservées comme information source mais ne créent aucun mouvement de stock.');
  update public.kpi_pr_import_batches set status='imported',row_count=v_rows,imported_count=v_unique_items,rejected_count=greatest(v_rows-v_valid,0),report=v_report,completed_at=now() where id=p_batch_id;
  return jsonb_build_object('ok',true,'batchId',p_batch_id,'report',v_report);
end;
$$;

grant execute on function public.kpi_pr_dev_import_begin(text,text,text,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_import_catalog_chunk(text,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_import_complete(text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_pr_dev_upsert_item(text,jsonb) to anon,authenticated,service_role;
