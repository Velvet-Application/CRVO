create or replace function public.kpi_pr_dev_save_setting(p_token_hash text,p_key text,p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_auth record;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  if p_key not in ('stock_policy','cmm_policy','sage_mapping','inventory_policy','bodyshop_consumables') then raise exception 'Paramètre Magasin non autorisé.'; end if;
  insert into public.kpi_pr_settings(key,value,updated_by,updated_at)
  values(p_key,coalesce(p_value,'{}'::jsonb),v_auth.display_name,now())
  on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now();
  return jsonb_build_object('ok',true,'key',p_key,'value',p_value);
end;
$function$;
