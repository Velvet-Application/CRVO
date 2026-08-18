create or replace function public.kpi_industrial_health_v3_public()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_level text := 'green';
  v_age numeric := null;
begin
  v_base := public.kpi_industrial_health_v2_public();
  v_age := nullif(v_base->'ftp'->>'syncAgeMinutes','')::numeric;

  select coalesce(jsonb_agg(w),'[]'::jsonb) into v_warnings
  from jsonb_array_elements(coalesce(v_base->'warnings','[]'::jsonb)) w
  where coalesce(w->>'code','') not in ('ftp_sync_stale','ftp_sync_watch');

  if v_age is null or v_age > 60 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','ftp_sync_stale',
      'severity','critical',
      'message','Aucune synchronisation FTP réussie depuis plus d’une heure.',
      'ageMinutes',round(coalesce(v_age,99999),1)
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
  return v_base;
end;
$$;

revoke all on function public.kpi_industrial_health_v3_public() from public;
grant execute on function public.kpi_industrial_health_v3_public() to anon, authenticated, service_role;
