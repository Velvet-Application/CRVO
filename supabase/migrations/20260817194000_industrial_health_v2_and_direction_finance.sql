create or replace function public.kpi_direction_finance(p_session_hash text, p_history boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user record;
  v_payload jsonb;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then
    raise exception 'Session CRVO requise.' using errcode='42501';
  end if;
  v_payload := public.kpi_kiosk_direction_finance(coalesce(p_history,false));
  return jsonb_set(v_payload,'{backend}',to_jsonb('authenticated-direction-finance'::text),true);
end;
$$;
revoke all on function public.kpi_direction_finance(text,boolean) from public;
grant execute on function public.kpi_direction_finance(text,boolean) to anon, authenticated, service_role;

create or replace function public.kpi_industrial_health_v2_public()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_level text := 'green';
  v_operational_unmapped int := 0;
  v_admin_unmapped int := 0;
  v_dup_total int := 0;
  v_dup_production int := 0;
  v_dup_transport int := 0;
begin
  v_base := public.kpi_industrial_health_public();

  select
    count(*) filter(where not (
      lower(coalesce(service,'')) like 'admin%'
      or lower(coalesce(metadata->>'rosterCategory',''))='administratif'
      or coalesce(primary_population,'')='administratif'
    )),
    count(*) filter(where (
      lower(coalesce(service,'')) like 'admin%'
      or lower(coalesce(metadata->>'rosterCategory',''))='administratif'
      or coalesce(primary_population,'')='administratif'
    ))
  into v_operational_unmapped, v_admin_unmapped
  from public.kpi_staff_effective
  where active and not coalesce(neutralized,false)
    and (primary_job_key is null or primary_sector_key is null or primary_scope is null);

  with latest_batch as (
    select import_batch_id
    from public.kpi_ftp_vehicle_state
    group by import_batch_id
    order by max(source_modified_at) desc nulls last, max(created_at) desc
    limit 1
  ), park as (
    select * from public.kpi_ftp_vehicle_state
    where import_batch_id=(select import_batch_id from latest_batch)
  ), dups as (
    select vin,
      bool_or(
        nullif(trim(coalesce(work_order,'')),'') is not null
        or lower(coalesce(status,'')) not in (
          'transport à vide','en attente de transport aller','en attente de transport retour',
          'transport retour planifié','transport retour effectué','sortie usine'
        )
      ) as production_impact
    from park
    where nullif(trim(coalesce(vin,'')),'') is not null
    group by vin
    having count(*)>1
  )
  select count(*),count(*) filter(where production_impact),count(*) filter(where not production_impact)
  into v_dup_total,v_dup_production,v_dup_transport
  from dups;

  select coalesce(jsonb_agg(x),'[]'::jsonb) into v_warnings
  from jsonb_array_elements(coalesce(v_base->'warnings','[]'::jsonb)) x
  where x->>'code' not in ('rh_unmapped_staff','park_duplicate_vin');

  if v_operational_unmapped>0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','rh_unmapped_operational_staff','severity','warning',
      'message','Des collaborateurs opérationnels actifs ne sont pas encore rattachés à un métier/secteur.',
      'count',v_operational_unmapped
    ));
  end if;

  if v_dup_production>0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','park_duplicate_vin_production','severity','warning',
      'message','Des VIN dupliqués concernent le parc de production et nécessitent un contrôle source.',
      'count',v_dup_production
    ));
  elsif v_dup_transport>0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','park_duplicate_vin_transport','severity','info',
      'message','Doublons VIN limités aux flux transport sans OR; ils sont exclus du stock industriel par déduplication.',
      'count',v_dup_transport
    ));
  end if;

  if exists(select 1 from jsonb_array_elements(v_warnings) w where w->>'severity'='critical') then
    v_level := 'red';
  elsif exists(select 1 from jsonb_array_elements(v_warnings) w where w->>'severity'='warning') then
    v_level := 'amber';
  else
    v_level := 'green';
  end if;

  v_base := jsonb_set(v_base,'{warnings}',v_warnings,true);
  v_base := jsonb_set(v_base,'{trustLevel}',to_jsonb(v_level),true);
  v_base := jsonb_set(v_base,'{ok}',to_jsonb(v_level<>'red'),true);
  v_base := jsonb_set(v_base,'{rh}',coalesce(v_base->'rh','{}'::jsonb)||jsonb_build_object(
    'unmappedStaff',v_operational_unmapped,
    'unmappedOperationalStaff',v_operational_unmapped,
    'unmappedAdministrativeStaff',v_admin_unmapped
  ),true);
  v_base := jsonb_set(v_base,'{parkQuality}',coalesce(v_base->'parkQuality','{}'::jsonb)||jsonb_build_object(
    'duplicateVin',v_dup_total,
    'duplicateVinProductionImpact',v_dup_production,
    'duplicateVinTransportOnly',v_dup_transport
  ),true);
  return v_base;
end;
$$;
revoke all on function public.kpi_industrial_health_v2_public() from public;
grant execute on function public.kpi_industrial_health_v2_public() to anon, authenticated, service_role;
