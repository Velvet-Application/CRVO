create or replace function public.kpi_objectives_save(p_token_hash text, p_month date, p_objectives jsonb, p_daily_targets jsonb default '{}'::jsonb)
returns table(payload jsonb)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_month date := date_trunc('month', coalesce(p_month,current_date))::date;
  v_next date := (v_month + interval '1 month')::date;
  v_item jsonb;
  v_key text;
  v_value jsonb;
  v_saved int := 0;
  v_daily int := 0;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if v_auth.ok is distinct from true then
    raise exception 'unauthorized' using errcode='42501';
  end if;
  if not (v_auth.role='admin' or '*'=any(coalesce(v_auth.page_permissions,array[]::text[])) or 'settings'=any(coalesce(v_auth.page_permissions,array[]::text[]))) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if jsonb_typeof(coalesce(p_objectives,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_objectives,'[]'::jsonb))=0 then
    raise exception 'no_objectives';
  end if;

  for v_item in select * from jsonb_array_elements(p_objectives)
  loop
    if nullif(trim(v_item->>'sectorKey'),'') is null or nullif(trim(v_item->>'sectorLabel'),'') is null then continue; end if;
    insert into public.kpi_monthly_objectives(month,sector_key,sector_label,daily_target,min_threshold,max_threshold,updated_at)
    values(
      v_month,
      trim(v_item->>'sectorKey'),
      trim(v_item->>'sectorLabel'),
      greatest(0,coalesce((v_item->>'dailyTarget')::numeric,0)),
      case when v_item->>'minThreshold' is null or v_item->>'minThreshold'='' then null else greatest(0,(v_item->>'minThreshold')::numeric) end,
      case when v_item->>'maxThreshold' is null or v_item->>'maxThreshold'='' then null else greatest(0,(v_item->>'maxThreshold')::numeric) end,
      now()
    )
    on conflict(month,sector_key) do update set
      sector_label=excluded.sector_label,
      daily_target=excluded.daily_target,
      min_threshold=excluded.min_threshold,
      max_threshold=excluded.max_threshold,
      updated_at=excluded.updated_at;
    v_saved := v_saved + 1;
  end loop;

  if jsonb_typeof(coalesce(p_daily_targets,'{}'::jsonb))='object' then
    delete from public.kpi_daily_exit_objectives
      where target_date>=v_month and target_date<v_next;
    for v_key,v_value in select * from jsonb_each(p_daily_targets)
    loop
      if v_key ~ '^\d{4}-\d{2}-\d{2}$' and v_key::date>=v_month and v_key::date<v_next then
        insert into public.kpi_daily_exit_objectives(target_date,target_value,updated_at)
        values(v_key::date,greatest(0,coalesce((v_value#>>'{}')::numeric,0)),now())
        on conflict(target_date) do update set target_value=excluded.target_value,updated_at=excluded.updated_at;
        v_daily:=v_daily+1;
      end if;
    end loop;
  end if;

  return query select jsonb_build_object('saved',v_saved,'dailySaved',v_daily,'month',v_month,'storage','supabase','by',coalesce(v_auth.display_name,v_auth.username));
end $$;

revoke all on function public.kpi_objectives_save(text,date,jsonb,jsonb) from public;
grant execute on function public.kpi_objectives_save(text,date,jsonb,jsonb) to anon,authenticated,service_role;
