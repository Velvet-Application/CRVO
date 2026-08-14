create or replace function public.kpi_set_email_gateway_token(p_token_sha256 text, p_updated_by text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_at timestamptz := now();
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash';
  end if;

  insert into public.kpi_email_gateway_config(id, token_sha256, updated_at, updated_by, metadata)
  values (1, p_token_sha256, v_updated_at, nullif(trim(p_updated_by), ''), jsonb_build_object('channel','make_mailhook','token_version',1))
  on conflict (id) do update set
    token_sha256 = excluded.token_sha256,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by,
    metadata = excluded.metadata;

  return v_updated_at;
end;
$$;

revoke all on function public.kpi_set_email_gateway_token(text,text) from public, anon, authenticated;
grant execute on function public.kpi_set_email_gateway_token(text,text) to service_role;
