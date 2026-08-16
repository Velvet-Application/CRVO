create or replace function public.kpi_data_rh_access(p_session_hash text)
returns table(display_name text, username text, role text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.display_name,c.username,c.role
  from public.crvo_auth_context_v2(p_session_hash) c
  where c.ok
    and (
      c.role='admin'
      or '*'=any(coalesce(c.page_permissions,array[]::text[]))
      or 'data_rh'=any(coalesce(c.page_permissions,array[]::text[]))
    )
  limit 1
$$;

revoke all on function public.kpi_data_rh_access(text) from public, anon, authenticated;

do $$
declare
  r record;
  vdef text;
begin
  for r in
    select p.oid,p.proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'kpi_rh_batch_start_admin','kpi_rh_batch_chunk_admin','kpi_rh_batch_commit_step_admin','kpi_rh_batch_finish_admin',
        'kpi_ops_batch_start_admin','kpi_ops_batch_chunk_admin','kpi_ops_batch_commit_step_admin'
      )
  loop
    vdef:=pg_get_functiondef(r.oid);
    vdef:=regexp_replace(
      vdef,
      'select \* into v_user from public\.crvo_auth_validate\(p_session_hash\) where ok and role=''admin'' limit 1;',
      'select * into v_user from public.kpi_data_rh_access(p_session_hash) limit 1;',
      'g'
    );
    vdef:=regexp_replace(
      vdef,
      'select \* into v_user from public\.crvo_auth_validate\(p_session_hash\) where ok limit 1;[[:space:]]*if v_user is null or v_user\.role<>''admin'' then',
      'select * into v_user from public.kpi_data_rh_access(p_session_hash) limit 1; if v_user is null then',
      'g'
    );
    vdef:=replace(vdef,'Accès administrateur CRVO requis.','Droit Data RH requis.');
    if position('crvo_auth_validate(p_session_hash)' in vdef)>0 then
      raise exception 'Data RH authorization replacement failed for %',r.proname;
    end if;
    execute vdef;
  end loop;
end $$;

create or replace function public.kpi_create_direct_import_token_admin(
  p_session_hash text,
  p_token_sha256 text,
  p_source_key text,
  p_ttl_seconds integer default 300
)
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'public'
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

  select a.display_name into v_created_by
  from public.kpi_data_rh_access(p_session_hash) a
  limit 1;

  if v_created_by is null then
    raise exception 'data rh permission required' using errcode='42501';
  end if;

  delete from public.kpi_direct_import_tokens where expires_at < now() - interval '1 day';
  v_expires := now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds,300),900)));

  insert into public.kpi_direct_import_tokens(token_sha256,source_key,expires_at,created_by,metadata)
  values(p_token_sha256,p_source_key,v_expires,v_created_by,jsonb_build_object('channel','direct_upload','version',2,'authorization','data_rh'));

  return v_expires;
end;
$$;
