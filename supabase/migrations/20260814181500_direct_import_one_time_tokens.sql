create table if not exists public.kpi_direct_import_tokens (
  token_sha256 text primary key,
  source_key text not null check (source_key in ('rh','finance','billed_time')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by text,
  metadata jsonb not null default '{}'::jsonb,
  constraint kpi_direct_import_tokens_hash_chk check (token_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists kpi_direct_import_tokens_expires_idx on public.kpi_direct_import_tokens(expires_at);
create index if not exists kpi_direct_import_tokens_source_idx on public.kpi_direct_import_tokens(source_key, used_at, expires_at);
alter table public.kpi_direct_import_tokens enable row level security;
revoke all on public.kpi_direct_import_tokens from anon, authenticated;
grant select, insert, update, delete on public.kpi_direct_import_tokens to service_role;

create or replace function public.kpi_create_direct_import_token_admin(
  p_session_hash text,
  p_token_sha256 text,
  p_source_key text,
  p_ttl_seconds integer default 300
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_by text;
  v_expires timestamptz;
begin
  if p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid direct import token hash';
  end if;
  if p_source_key not in ('rh','finance','billed_time') then
    raise exception 'invalid direct import source';
  end if;

  select coalesce(nullif(u.display_name,''),u.username)
    into v_created_by
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active=true
    and u.role='admin'
  limit 1;

  if v_created_by is null then
    raise exception 'admin session required' using errcode='42501';
  end if;

  delete from public.kpi_direct_import_tokens where expires_at < now() - interval '1 day';
  v_expires := now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds,300),900)));

  insert into public.kpi_direct_import_tokens(token_sha256,source_key,expires_at,created_by,metadata)
  values(p_token_sha256,p_source_key,v_expires,v_created_by,jsonb_build_object('channel','direct_upload','version',1));

  return v_expires;
end;
$$;

create or replace function public.kpi_consume_direct_import_token(
  p_token_sha256 text,
  p_source_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.kpi_direct_import_tokens
     set used_at=now()
   where token_sha256=lower(trim(p_token_sha256))
     and source_key=p_source_key
     and used_at is null
     and expires_at>now();
  get diagnostics v_count = row_count;
  return v_count=1;
end;
$$;

revoke all on function public.kpi_create_direct_import_token_admin(text,text,text,integer) from public;
revoke all on function public.kpi_consume_direct_import_token(text,text) from public;
grant execute on function public.kpi_create_direct_import_token_admin(text,text,text,integer) to anon, authenticated, service_role;
grant execute on function public.kpi_consume_direct_import_token(text,text) to service_role;
