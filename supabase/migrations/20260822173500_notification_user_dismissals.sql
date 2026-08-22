create table if not exists public.kpi_notification_dismissals (
  notification_id uuid not null references public.kpi_notifications(id) on delete cascade,
  user_id uuid not null references public.crvo_auth_users(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (notification_id,user_id)
);

create index if not exists kpi_notification_dismissals_user_idx
  on public.kpi_notification_dismissals(user_id,dismissed_at desc);

revoke all on table public.kpi_notification_dismissals from public,anon,authenticated;
grant all on table public.kpi_notification_dismissals to service_role;
alter table public.kpi_notification_dismissals enable row level security;

create or replace function public.kpi_notifications_list(p_session_hash text,p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_rows jsonb; v_unread integer;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'kind',q.kind,'severity',q.severity,'title',q.title,'message',q.message,'workDate',q.work_date,'team',q.team_code,'sector',q.sector_key,
    'createdAt',q.created_at,'resolvedAt',q.resolved_at,'read',q.read_at is not null,'metadata',q.metadata
  ) order by q.created_at desc),'[]'::jsonb) into v_rows
  from (
    select n.*,r.read_at
    from public.kpi_notifications n
    left join public.kpi_notification_reads r
      on r.notification_id=n.id and r.user_id=v_user.id
    left join public.kpi_notification_dismissals d
      on d.notification_id=n.id and d.user_id=v_user.id
    where d.notification_id is null
      and ((n.audience_user_id=v_user.id)
        or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key)))
    order by n.created_at desc
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) q;

  select count(*) into v_unread
  from public.kpi_notifications n
  left join public.kpi_notification_reads r
    on r.notification_id=n.id and r.user_id=v_user.id
  left join public.kpi_notification_dismissals d
    on d.notification_id=n.id and d.user_id=v_user.id
  where n.resolved_at is null
    and r.notification_id is null
    and d.notification_id is null
    and ((n.audience_user_id=v_user.id)
      or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key)));

  return jsonb_build_object('notifications',v_rows,'unread',v_unread);
end
$function$;

create or replace function public.kpi_notifications_dismiss(p_session_hash text,p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_count integer:=0;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  if p_notification_id is null then raise exception 'Notification requise.' using errcode='22023'; end if;

  insert into public.kpi_notification_dismissals(notification_id,user_id)
  select n.id,v_user.id
  from public.kpi_notifications n
  where n.id=p_notification_id
    and ((n.audience_user_id=v_user.id)
      or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key)))
  on conflict(notification_id,user_id) do update set dismissed_at=excluded.dismissed_at;
  get diagnostics v_count=row_count;

  return jsonb_build_object('ok',true,'dismissed',v_count);
end
$function$;

create or replace function public.kpi_notifications_purge_read(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare v_user public.crvo_auth_users%rowtype; v_count integer:=0;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  insert into public.kpi_notification_dismissals(notification_id,user_id)
  select n.id,v_user.id
  from public.kpi_notifications n
  join public.kpi_notification_reads r
    on r.notification_id=n.id and r.user_id=v_user.id
  where ((n.audience_user_id=v_user.id)
      or (n.audience_user_id is null and public.kpi_notification_visible(v_user.id,n.position_key)))
  on conflict(notification_id,user_id) do update set dismissed_at=excluded.dismissed_at;
  get diagnostics v_count=row_count;

  return jsonb_build_object('ok',true,'dismissed',v_count);
end
$function$;

revoke all on function public.kpi_notifications_dismiss(text,uuid) from public;
revoke all on function public.kpi_notifications_purge_read(text) from public;
grant execute on function public.kpi_notifications_dismiss(text,uuid) to anon,authenticated,service_role;
grant execute on function public.kpi_notifications_purge_read(text) to anon,authenticated,service_role;
