create or replace function public.kpi_pr_dev_upsert_package(p_token_hash text,p_package jsonb)
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
      v_item_id:=public.kpi_pr_internal_resolve_item_id(nullif(v_line->>'itemId','')::uuid,v_line->>'reference',v_line->>'manufacturerLabel');
    end if;
    insert into public.kpi_pr_package_lines(package_id,line_type,item_id,label,quantity,labor_minutes,public_unit_price_ht,cost_unit_ht,sort_order)
    values(v_id,coalesce(nullif(v_line->>'lineType',''),'fee'),v_item_id,coalesce(nullif(trim(v_line->>'label'),''),coalesce(v_line->>'reference','Ligne forfait')),coalesce(nullif(v_line->>'quantity','')::numeric,1),nullif(v_line->>'laborMinutes','')::numeric,nullif(v_line->>'publicUnitPriceHt','')::numeric,nullif(v_line->>'costUnitHt','')::numeric,v_count);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'id',v_id,'code',v_code,'lineCount',v_count);
end;
$$;
grant execute on function public.kpi_pr_dev_upsert_package(text,jsonb) to anon,authenticated,service_role;
