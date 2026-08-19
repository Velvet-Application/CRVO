-- Keep Direction finance private while allowing the server route to authenticate
-- either an administrator CRVO session or the dedicated Direction kiosk cookie.
create or replace function public.kpi_direction_finance_access(
  p_session_hash text default null,
  p_kiosk_token text default null,
  p_history boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_user record;
  v_kiosk_ok boolean := false;
begin
  if nullif(p_kiosk_token, '') is not null then
    v_kiosk_ok := encode(digest(convert_to(p_kiosk_token, 'UTF8'), 'sha256'), 'hex') = 'cfec2c633ed2bfc5ac54785f9681b21bb6170667e5bf979bd28421673ecb7582';
  end if;

  if not v_kiosk_ok then
    select * into v_user
    from public.crvo_auth_validate(p_session_hash)
    where ok
    limit 1;

    if v_user is null or v_user.role <> 'admin' then
      raise exception 'Accès Direction requis.' using errcode='42501';
    end if;
  end if;

  return public.kpi_kiosk_direction_finance(p_history);
end
$$;

revoke all on function public.kpi_direction_finance_access(text,text,boolean) from public;
grant execute on function public.kpi_direction_finance_access(text,text,boolean)
to anon, authenticated, service_role;
