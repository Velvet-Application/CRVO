create or replace function public.kpi_email_gateway_admin_status(p_session_hash text)
returns table(configured boolean, updated_at timestamptz, updated_by text)
language sql
stable
security definer
set search_path = public
as $$
  with admin_session as (
    select 1
    from public.crvo_auth_sessions s
    join public.crvo_auth_users u on u.id = s.user_id
    where s.token_hash = p_session_hash
      and s.revoked_at is null
      and s.expires_at > now()
      and u.is_active = true
      and u.role = 'admin'
    limit 1
  )
  select (c.id is not null) as configured, c.updated_at, c.updated_by
  from admin_session a
  left join public.kpi_email_gateway_config c on c.id = 1;
$$;

create or replace function public.kpi_set_email_gateway_token_admin(
  p_session_hash text,
  p_token_sha256 text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_at timestamptz := now();
  v_updated_by text;
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid gateway token hash';
  end if;

  select coalesce(nullif(u.display_name, ''), u.username)
    into v_updated_by
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id = s.user_id
  where s.token_hash = p_session_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true
    and u.role = 'admin'
  limit 1;

  if v_updated_by is null then
    raise exception 'admin session required' using errcode = '42501';
  end if;

  insert into public.kpi_email_gateway_config(id, token_sha256, updated_at, updated_by, metadata)
  values (1, p_token_sha256, v_updated_at, v_updated_by, jsonb_build_object('channel','make_mailhook','token_version',2))
  on conflict (id) do update
  set token_sha256 = excluded.token_sha256,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      metadata = excluded.metadata;

  return v_updated_at;
end;
$$;

create or replace function public.kpi_validate_email_gateway_token(p_token_sha256 text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.kpi_email_gateway_config
    where id = 1 and token_sha256 = p_token_sha256
  );
$$;

revoke all on function public.kpi_email_gateway_admin_status(text) from public;
revoke all on function public.kpi_set_email_gateway_token_admin(text,text) from public;
revoke all on function public.kpi_validate_email_gateway_token(text) from public;

grant execute on function public.kpi_email_gateway_admin_status(text) to anon, authenticated, service_role;
grant execute on function public.kpi_set_email_gateway_token_admin(text,text) to anon, authenticated, service_role;
grant execute on function public.kpi_validate_email_gateway_token(text) to anon, authenticated, service_role;
