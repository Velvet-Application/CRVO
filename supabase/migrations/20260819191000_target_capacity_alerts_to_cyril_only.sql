alter table public.kpi_notifications
  add column if not exists audience_user_id uuid references public.crvo_auth_users(id) on delete cascade;

create index if not exists kpi_notifications_audience_user_idx
  on public.kpi_notifications(audience_user_id)
  where audience_user_id is not null;

update public.kpi_notifications
set audience_user_id=(select id from public.crvo_auth_users where username='cyril' and is_active limit 1)
where kind='capacity_warning' or source_key like 'capacity:%';

create or replace function public.kpi_notifications_list(p_session_hash text, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_rows jsonb; v_unread integer;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'kind',q.kind,'severity',q.severity,'title',q.title,'message',q.message,
    'workDate',q.work_date,'team',q.team_code,'sector',q.sector_key,'createdAt',q.created_at,
    'resolvedAt',q.resolved_at,'read',q.read_at is not null,'metadata',q.metadata
  ) order by q.created_at desc),'[]'::jsonb) into v_rows
  from (
    select n.*,r.read_at
    from public.kpi_notifications n
    left join public.kpi_notification_reads r on r.notification_id=n.id and r.user_id=v_user.id
    where n.audience_user_id=v_user.id
       or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key))
    order by n.created_at desc
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) q;

  select count(*) into v_unread
  from public.kpi_notifications n
  left join public.kpi_notification_reads r on r.notification_id=n.id and r.user_id=v_user.id
  where n.resolved_at is null and r.notification_id is null
    and (n.audience_user_id=v_user.id
      or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key)));

  return jsonb_build_object('notifications',v_rows,'unread',v_unread);
end
$function$;

create or replace function public.kpi_notifications_mark_read(p_session_hash text, p_notification_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_count integer:=0;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  insert into public.kpi_notification_reads(notification_id,user_id)
  select n.id,v_user.id
  from public.kpi_notifications n
  where (p_notification_id is null or n.id=p_notification_id)
    and (n.audience_user_id=v_user.id
      or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key)))
  on conflict(notification_id,user_id) do update set read_at=excluded.read_at;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'read',v_count);
end
$function$;

create or replace function public.kpi_free_tier_capacity_guard()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_db bigint := pg_database_size(current_database());
  v_storage bigint := coalesce((select sum(coalesce((metadata->>'size')::bigint,0)) from storage.objects),0);
  v_db_warn bigint := 350*1024*1024;
  v_db_crit bigint := 450*1024*1024;
  v_storage_warn bigint := 700*1024*1024;
  v_storage_crit bigint := 900*1024*1024;
  v_db_sev text;
  v_storage_sev text;
  v_cyril uuid;
begin
  select id into v_cyril from public.crvo_auth_users where username='cyril' and is_active limit 1;
  v_db_sev := case when v_db>=v_db_crit then 'critical' when v_db>=v_db_warn then 'warning' else null end;
  v_storage_sev := case when v_storage>=v_storage_crit then 'critical' when v_storage>=v_storage_warn then 'warning' else null end;

  if v_db_sev is not null then
    insert into public.kpi_notifications(kind,severity,entity,source_key,title,message,metadata,audience_user_id)
    values('capacity_warning',v_db_sev,'CRVO','capacity:supabase:database','Capacité Supabase · base',
      format('Base KPI CRVO à %.1f MB sur 500 MB Free.',v_db/1048576.0),
      jsonb_build_object('bytes',v_db,'limitBytes',500*1024*1024,'warningBytes',v_db_warn),v_cyril)
    on conflict(source_key) do update
      set severity=excluded.severity,message=excluded.message,metadata=excluded.metadata,
          audience_user_id=excluded.audience_user_id,resolved_at=null,created_at=now();
  else
    update public.kpi_notifications set resolved_at=coalesce(resolved_at,now())
    where source_key='capacity:supabase:database' and resolved_at is null;
  end if;

  if v_storage_sev is not null then
    insert into public.kpi_notifications(kind,severity,entity,source_key,title,message,metadata,audience_user_id)
    values('capacity_warning',v_storage_sev,'CRVO','capacity:supabase:storage','Capacité Supabase · Storage',
      format('Storage KPI CRVO à %.1f MB sur 1 GB Free.',v_storage/1048576.0),
      jsonb_build_object('bytes',v_storage,'limitBytes',1024*1024*1024,'warningBytes',v_storage_warn),v_cyril)
    on conflict(source_key) do update
      set severity=excluded.severity,message=excluded.message,metadata=excluded.metadata,
          audience_user_id=excluded.audience_user_id,resolved_at=null,created_at=now();
  else
    update public.kpi_notifications set resolved_at=coalesce(resolved_at,now())
    where source_key='capacity:supabase:storage' and resolved_at is null;
  end if;

  return jsonb_build_object(
    'databaseBytes',v_db,'storageBytes',v_storage,
    'databasePctFreeLimit',round(v_db::numeric/(500*1024*1024)*100,1),
    'storagePctFreeLimit',round(v_storage::numeric/(1024*1024*1024)*100,1)
  );
end
$function$;

revoke all on function public.kpi_notifications_list(text,integer) from public;
revoke all on function public.kpi_notifications_mark_read(text,uuid) from public;
revoke all on function public.kpi_free_tier_capacity_guard() from public,anon,authenticated;
grant execute on function public.kpi_notifications_list(text,integer) to service_role;
grant execute on function public.kpi_notifications_mark_read(text,uuid) to service_role;
grant execute on function public.kpi_free_tier_capacity_guard() to service_role;
