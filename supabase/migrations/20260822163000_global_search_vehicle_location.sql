create or replace function public.kpi_global_vehicle_location(
  p_token_hash text,
  p_vin text default null,
  p_registration text default null,
  p_work_order text default null
)
returns table(location text, source_modified_at text, site text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth record;
  v_batch uuid;
begin
  select * into v_auth from public.crvo_auth_context_v3(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) then
    raise exception 'session required' using errcode='42501';
  end if;

  select b.id into v_batch
  from public.kpi_import_batches b
  where b.original_filename in ('EtatduParc-Nuit.csv','Etat-du-parc.csv')
    and b.metadata->>'vehicle_state_status'='ready'
  order by b.imported_at desc
  limit 1;

  if v_batch is null then return; end if;

  if nullif(trim(coalesce(p_vin,'')),'') is not null then
    return query
    select trim(v.metadata->>'position'), v.source_modified_at::text, nullif(trim(v.metadata->>'site'),'')
    from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch
      and v.vin=p_vin
      and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null
    order by v.source_modified_at desc nulls last
    limit 1;
    if found then return; end if;
  end if;

  if nullif(trim(coalesce(p_registration,'')),'') is not null then
    return query
    select trim(v.metadata->>'position'), v.source_modified_at::text, nullif(trim(v.metadata->>'site'),'')
    from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch
      and upper(coalesce(v.registration,''))=upper(p_registration)
      and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null
    order by v.source_modified_at desc nulls last
    limit 1;
    if found then return; end if;
  end if;

  if nullif(trim(coalesce(p_work_order,'')),'') is not null then
    return query
    select trim(v.metadata->>'position'), v.source_modified_at::text, nullif(trim(v.metadata->>'site'),'')
    from public.kpi_ftp_vehicle_state v
    where v.import_batch_id=v_batch
      and v.work_order=p_work_order
      and nullif(trim(coalesce(v.metadata->>'position','')),'') is not null
    order by v.source_modified_at desc nulls last
    limit 1;
  end if;
end;
$$;

revoke all on function public.kpi_global_vehicle_location(text,text,text,text) from public;
grant execute on function public.kpi_global_vehicle_location(text,text,text,text) to anon, authenticated;
