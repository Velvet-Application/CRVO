create extension if not exists pgcrypto;

create table if not exists public.kpi_maintenance_targets (
  target_key text primary key,
  label text not null,
  category text not null,
  target_type text not null,
  enabled boolean not null default true,
  auto_repair_enabled boolean not null default false,
  expected_heartbeat_seconds integer,
  capabilities text[] not null default array[]::text[],
  agent_token_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_maintenance_heartbeats (
  target_key text primary key references public.kpi_maintenance_targets(target_key) on delete cascade,
  heartbeat_at timestamptz not null default now(),
  status text not null default 'online',
  app_version text,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_maintenance_commands (
  id uuid primary key default gen_random_uuid(),
  target_key text not null references public.kpi_maintenance_targets(target_key),
  action text not null,
  status text not null default 'queued' check (status in ('queued','running','success','failed','cancelled')),
  requested_by uuid references public.crvo_auth_users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  request jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists kpi_maintenance_commands_queue_idx
  on public.kpi_maintenance_commands(status, requested_at);
create index if not exists kpi_maintenance_commands_target_idx
  on public.kpi_maintenance_commands(target_key, requested_at desc);

create table if not exists public.kpi_maintenance_events (
  id bigint generated always as identity primary key,
  target_key text references public.kpi_maintenance_targets(target_key),
  command_id uuid references public.kpi_maintenance_commands(id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  message text not null,
  actor_user_id uuid references public.crvo_auth_users(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kpi_maintenance_events_created_idx
  on public.kpi_maintenance_events(created_at desc);
create index if not exists kpi_maintenance_events_target_idx
  on public.kpi_maintenance_events(target_key, created_at desc);

alter table public.kpi_maintenance_targets enable row level security;
alter table public.kpi_maintenance_heartbeats enable row level security;
alter table public.kpi_maintenance_commands enable row level security;
alter table public.kpi_maintenance_events enable row level security;

revoke all on public.kpi_maintenance_targets from anon, authenticated;
revoke all on public.kpi_maintenance_heartbeats from anon, authenticated;
revoke all on public.kpi_maintenance_commands from anon, authenticated;
revoke all on public.kpi_maintenance_events from anon, authenticated;

insert into public.kpi_maintenance_targets(target_key,label,category,target_type,auto_repair_enabled,expected_heartbeat_seconds,capabilities,metadata)
values
  ('platform.supabase','Supabase','Application','service',false,null,array['test_service'],jsonb_build_object('order',10)),
  ('source.ftp','FTP CRVO','Sources & données','source',true,null,array['test_ftp','refresh_ftp','refresh_all_feeds'],jsonb_build_object('order',20)),
  ('bridge.ftp','Bridge FTP','Sources & données','runner',true,600,array['restart_bridge','refresh_ftp','refresh_all_feeds','rebuild_kpi'],jsonb_build_object('order',30)),
  ('data.factory','Factory J+1','Sources & données','feed',true,null,array['refresh_factory','refresh_all_feeds','rebuild_kpi'],jsonb_build_object('order',40,'critical_age_minutes',145)),
  ('data.park','Etat du Parc','Sources & données','feed',true,null,array['refresh_ftp','refresh_all_feeds','rebuild_kpi'],jsonb_build_object('order',50,'critical_age_minutes',145)),
  ('api.health','API Santé','Application','api',false,null,array['test_api'],jsonb_build_object('order',60)),
  ('api.atelier','API Atelier','Application','api',false,null,array['test_api'],jsonb_build_object('order',70)),
  ('api.direction','API Direction','Application','api',false,null,array['test_api'],jsonb_build_object('order',80)),
  ('screen.atelier','Écran Atelier','Écrans CRVO','screen',false,75,array['reload_page','clear_cache','restart_browser','restart_guardian','reboot_device'],jsonb_build_object('order',90,'setup_path','/atelier')),
  ('screen.direction','Écran Direction','Écrans CRVO','screen',false,75,array['reload_page','clear_cache','restart_browser','restart_guardian','reboot_device'],jsonb_build_object('order',100,'setup_path','/direction')),
  ('module.client_dashboard','Dashboard Client','Modules métier','module',false,null,array['test_api','rebuild_kpi'],jsonb_build_object('order',110)),
  ('module.quality_claims','Réclamations Qualité','Modules métier','module',false,null,array['test_api'],jsonb_build_object('order',120)),
  ('module.notifications','Notifications','Modules métier','module',false,null,array['test_api'],jsonb_build_object('order',130))
on conflict(target_key) do update set
  label=excluded.label,
  category=excluded.category,
  target_type=excluded.target_type,
  enabled=true,
  auto_repair_enabled=excluded.auto_repair_enabled,
  expected_heartbeat_seconds=excluded.expected_heartbeat_seconds,
  capabilities=excluded.capabilities,
  metadata=public.kpi_maintenance_targets.metadata || excluded.metadata,
  updated_at=now();

create or replace function public.kpi_maintenance_admin_user(p_token_hash text)
returns uuid
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_user uuid;
begin
  select u.id into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_token_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active=true
    and u.role='admin'
  limit 1;
  if v_user is null then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  return v_user;
end
$$;

create or replace function public.kpi_maintenance_overview(p_token_hash text)
returns table(payload jsonb)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_user uuid;
  v_health jsonb;
  v_live record;
  v_bridge record;
  v_targets jsonb;
  v_commands jsonb;
  v_events jsonb;
begin
  v_user:=public.kpi_maintenance_admin_user(p_token_hash);
  v_health:=public.kpi_industrial_health_v4_public();

  select snapshot_at,source_modified_at,factory_modified_at,park_modified_at
    into v_live
  from public.kpi_ftp_live_dashboard
  order by snapshot_at desc limit 1;

  select started_at,finished_at,status,files_seen,files_imported,details
    into v_bridge
  from public.kpi_bridge_runs
  order by started_at desc limit 1;

  select coalesce(jsonb_agg(item order by (item->>'order')::int),'[]'::jsonb)
    into v_targets
  from (
    select jsonb_build_object(
      'key',t.target_key,
      'label',t.label,
      'category',t.category,
      'type',t.target_type,
      'order',coalesce((t.metadata->>'order')::int,999),
      'enabled',t.enabled,
      'autoRepairEnabled',t.auto_repair_enabled,
      'capabilities',to_jsonb(t.capabilities),
      'expectedHeartbeatSeconds',t.expected_heartbeat_seconds,
      'guardianConfigured',t.agent_token_hash is not null,
      'heartbeatAt',h.heartbeat_at,
      'heartbeatStatus',h.status,
      'appVersion',h.app_version,
      'heartbeatDetails',coalesce(h.details,'{}'::jsonb),
      'status',case
        when t.target_key='platform.supabase' then 'green'
        when t.target_key='source.ftp' then case
          when v_bridge.finished_at is null then 'red'
          when v_bridge.status<>'success' then 'red'
          when extract(epoch from (now()-v_bridge.finished_at))/60.0>80 then 'red'
          when extract(epoch from (now()-v_bridge.finished_at))/60.0>60 then 'amber'
          else 'green' end
        when t.target_key='bridge.ftp' then case
          when h.heartbeat_at is not null and extract(epoch from (now()-h.heartbeat_at))<=coalesce(t.expected_heartbeat_seconds,600) then 'green'
          when v_bridge.finished_at is null then 'red'
          when v_bridge.status<>'success' then 'red'
          when extract(epoch from (now()-v_bridge.finished_at))/60.0>80 then 'red'
          when extract(epoch from (now()-v_bridge.finished_at))/60.0>60 then 'amber'
          else 'green' end
        when t.target_key='data.factory' then case
          when v_live.factory_modified_at is null then 'red'
          when extract(epoch from (now()-v_live.factory_modified_at))/60.0>145 then 'red'
          when extract(epoch from (now()-v_live.factory_modified_at))/60.0>100 then 'amber'
          else 'green' end
        when t.target_key='data.park' then case
          when v_live.park_modified_at is null then 'red'
          when extract(epoch from (now()-v_live.park_modified_at))/60.0>145 then 'red'
          when extract(epoch from (now()-v_live.park_modified_at))/60.0>100 then 'amber'
          else 'green' end
        when t.target_type='screen' then case
          when h.heartbeat_at is null then 'unknown'
          when extract(epoch from (now()-h.heartbeat_at))>coalesce(t.expected_heartbeat_seconds,75)*3 then 'red'
          when extract(epoch from (now()-h.heartbeat_at))>coalesce(t.expected_heartbeat_seconds,75) then 'amber'
          else 'green' end
        else 'unknown' end,
      'ageMinutes',case
        when t.target_key in ('source.ftp','bridge.ftp') and v_bridge.finished_at is not null then round((extract(epoch from (now()-v_bridge.finished_at))/60.0)::numeric,1)
        when t.target_key='data.factory' and v_live.factory_modified_at is not null then round((extract(epoch from (now()-v_live.factory_modified_at))/60.0)::numeric,1)
        when t.target_key='data.park' and v_live.park_modified_at is not null then round((extract(epoch from (now()-v_live.park_modified_at))/60.0)::numeric,1)
        when t.target_type='screen' and h.heartbeat_at is not null then round((extract(epoch from (now()-h.heartbeat_at))/60.0)::numeric,1)
        else null end,
      'lastActivityAt',case
        when t.target_key in ('source.ftp','bridge.ftp') then v_bridge.finished_at
        when t.target_key='data.factory' then v_live.factory_modified_at
        when t.target_key='data.park' then v_live.park_modified_at
        when t.target_type='screen' then h.heartbeat_at
        else null end,
      'metadata',t.metadata
    ) item
    from public.kpi_maintenance_targets t
    left join public.kpi_maintenance_heartbeats h on h.target_key=t.target_key
    where t.enabled=true
  ) q;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.requested_at desc),'[]'::jsonb)
    into v_commands
  from (
    select id,target_key,action,status,requested_at,started_at,finished_at,result,error
    from public.kpi_maintenance_commands
    order by requested_at desc limit 30
  ) c;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]'::jsonb)
    into v_events
  from (
    select e.id,e.target_key,e.command_id,e.event_type,e.severity,e.message,e.created_at,
           coalesce(u.display_name,u.username) actor_name,e.details
    from public.kpi_maintenance_events e
    left join public.crvo_auth_users u on u.id=e.actor_user_id
    order by e.created_at desc limit 40
  ) e;

  return query select jsonb_build_object(
    'ok',true,
    'generatedAt',now(),
    'health',v_health,
    'targets',v_targets,
    'commands',v_commands,
    'events',v_events,
    'bridge',jsonb_build_object(
      'startedAt',v_bridge.started_at,
      'finishedAt',v_bridge.finished_at,
      'status',v_bridge.status,
      'filesSeen',coalesce(v_bridge.files_seen,0),
      'filesImported',coalesce(v_bridge.files_imported,0)
    ),
    'live',jsonb_build_object(
      'snapshotAt',v_live.snapshot_at,
      'sourceModifiedAt',v_live.source_modified_at,
      'factoryModifiedAt',v_live.factory_modified_at,
      'parkModifiedAt',v_live.park_modified_at
    )
  );
end
$$;

create or replace function public.kpi_maintenance_command_request(
  p_token_hash text,
  p_target_key text,
  p_action text,
  p_request jsonb default '{}'::jsonb
)
returns table(payload jsonb)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid;
  v_target public.kpi_maintenance_targets%rowtype;
  v_existing uuid;
  v_command uuid;
begin
  v_user:=public.kpi_maintenance_admin_user(p_token_hash);
  select * into v_target from public.kpi_maintenance_targets where target_key=p_target_key and enabled=true;
  if not found then raise exception 'Cible de maintenance inconnue.' using errcode='22023'; end if;
  if not (p_action=any(v_target.capabilities)) then raise exception 'Action non autorisée pour cette cible.' using errcode='22023'; end if;

  select id into v_existing
  from public.kpi_maintenance_commands
  where target_key=p_target_key and action=p_action and status in ('queued','running')
    and requested_at>now()-interval '15 minutes'
  order by requested_at desc limit 1;

  if v_existing is not null then
    return query select jsonb_build_object('ok',true,'deduplicated',true,'commandId',v_existing);
    return;
  end if;

  insert into public.kpi_maintenance_commands(target_key,action,requested_by,request)
  values(p_target_key,p_action,v_user,coalesce(p_request,'{}'::jsonb)) returning id into v_command;

  insert into public.kpi_maintenance_events(target_key,command_id,event_type,severity,message,actor_user_id,details)
  values(p_target_key,v_command,'command_requested','info','Action de maintenance demandée.',v_user,jsonb_build_object('action',p_action));

  return query select jsonb_build_object('ok',true,'deduplicated',false,'commandId',v_command,'status','queued');
end
$$;

create or replace function public.kpi_maintenance_event_admin(
  p_token_hash text,
  p_target_key text,
  p_event_type text,
  p_severity text,
  p_message text,
  p_details jsonb default '{}'::jsonb
)
returns table(payload jsonb)
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid; v_id bigint;
begin
  v_user:=public.kpi_maintenance_admin_user(p_token_hash);
  if p_severity not in ('info','warning','critical') then raise exception 'Sévérité invalide.' using errcode='22023'; end if;
  insert into public.kpi_maintenance_events(target_key,event_type,severity,message,actor_user_id,details)
  values(nullif(p_target_key,''),left(p_event_type,80),p_severity,left(p_message,1000),v_user,coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return query select jsonb_build_object('ok',true,'eventId',v_id);
end
$$;

create or replace function public.kpi_maintenance_agent_token_rotate(
  p_token_hash text,
  p_target_key text
)
returns table(payload jsonb)
language plpgsql
security definer
set search_path=public
as $$
declare v_user uuid; v_token text;
begin
  v_user:=public.kpi_maintenance_admin_user(p_token_hash);
  if not exists(select 1 from public.kpi_maintenance_targets where target_key=p_target_key and target_type='screen' and enabled=true) then
    raise exception 'Cible Guardian invalide.' using errcode='22023';
  end if;
  v_token:=encode(gen_random_bytes(32),'hex');
  update public.kpi_maintenance_targets
     set agent_token_hash=encode(digest(v_token,'sha256'),'hex'),updated_at=now()
   where target_key=p_target_key;
  insert into public.kpi_maintenance_events(target_key,event_type,severity,message,actor_user_id)
  values(p_target_key,'guardian_token_rotated','info','Jeton Guardian renouvelé.',v_user);
  return query select jsonb_build_object('ok',true,'targetKey',p_target_key,'token',v_token);
end
$$;

grant execute on function public.kpi_maintenance_overview(text) to anon, authenticated;
grant execute on function public.kpi_maintenance_command_request(text,text,text,jsonb) to anon, authenticated;
grant execute on function public.kpi_maintenance_event_admin(text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.kpi_maintenance_agent_token_rotate(text,text) to anon, authenticated;
