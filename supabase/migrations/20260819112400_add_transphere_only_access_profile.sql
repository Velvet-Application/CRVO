-- Dedicated access profile for users who must only see the Transphere environment.
-- Admins keep global access; Transphere-only users can read the dashboard/reporting,
-- while Book imports remain protected by the application admin guard.

alter table public.crvo_auth_users drop constraint if exists crvo_auth_users_access_profile_chk;
alter table public.crvo_auth_users add constraint crvo_auth_users_access_profile_chk
check (access_profile = any (array[
  'admin'::text,
  'service_manager'::text,
  'team_manager'::text,
  'custom'::text,
  'transphere'::text
]));

create or replace function public.crvo_auth_has_page_permission(p_token_hash text, p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists(
    select 1
    from public.crvo_auth_sessions s
    join public.crvo_auth_users u on u.id=s.user_id
    where s.token_hash=p_token_hash
      and s.revoked_at is null
      and s.expires_at>now()
      and u.is_active
      and (
        u.role='admin'
        or '*'=any(coalesce(u.page_permissions,array[]::text[]))
        or p_permission=any(coalesce(u.page_permissions,array[]::text[]))
      )
  );
$$;

revoke all on function public.crvo_auth_has_page_permission(text,text) from public;
grant execute on function public.crvo_auth_has_page_permission(text,text) to anon, authenticated, service_role;

create or replace function public.crvo_auth_create_user_v3(
  p_token_hash text,
  p_username text,
  p_display_name text,
  p_temporary_password text,
  p_access_profile text default 'custom'::text,
  p_page_permissions text[] default array[]::text[],
  p_productivity_scopes text[] default array[]::text[],
  p_team_scopes text[] default array[]::text[]
)
returns table(ok boolean,user_id uuid,error_code text)
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  admin_id uuid; new_id uuid; clean_username text:=lower(trim(p_username));
  profile text:=coalesce(nullif(trim(p_access_profile),''),'custom'); role_value text; pages text[]; scopes text[]; teams text[];
  allowed_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence','transphere'];
  service_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence'];
  allowed_scopes constant text[]:=array['*','administratif','autre','carrosserie','dsp','expertise','jantes','jockey','lavage','magasin','mecanique','qualite','photo','preparation','diagnostic','encadrement'];
  allowed_teams constant text[]:=array['*','A','B','C','J'];
begin
  select u.id into admin_id
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and u.is_active and u.role='admin'
  limit 1;
  if admin_id is null then return query select false,null::uuid,'forbidden'; return; end if;
  if clean_username !~ '^[a-z0-9._-]{3,40}$' then return query select false,null::uuid,'invalid_username'; return; end if;
  if length(coalesce(p_temporary_password,''))<12 then return query select false,null::uuid,'password_too_short'; return; end if;
  if profile not in ('admin','service_manager','team_manager','custom','transphere') then return query select false,null::uuid,'invalid_profile'; return; end if;
  if exists(select 1 from public.crvo_auth_users where lower(username)=clean_username) then return query select false,null::uuid,'username_exists'; return; end if;
  if exists(select 1 from unnest(coalesce(p_productivity_scopes,array[]::text[])) x where not (x=any(allowed_scopes))) then return query select false,null::uuid,'invalid_scope'; return; end if;
  if exists(select 1 from unnest(coalesce(p_team_scopes,array[]::text[])) x where not (x=any(allowed_teams))) then return query select false,null::uuid,'invalid_team_scope'; return; end if;

  if profile='admin' then
    role_value:='admin'; pages:=array['*']; scopes:=array['*']; teams:=array['*'];
  elsif profile='transphere' then
    role_value:='user'; pages:=array['transphere']; scopes:=array[]::text[]; teams:=array[]::text[];
  elsif profile='service_manager' then
    role_value:='user'; pages:=service_pages; scopes:=case when coalesce(array_length(p_productivity_scopes,1),0)=0 then array['*'] else p_productivity_scopes end; teams:=array['*'];
  elsif profile='team_manager' then
    role_value:='user'; pages:=array['reporting','productivity','monthly_animation']; scopes:=p_productivity_scopes; teams:=p_team_scopes;
    if coalesce(array_length(scopes,1),0)=0 or coalesce(array_length(teams,1),0)=0 then return query select false,null::uuid,'team_scope_required'; return; end if;
  else
    role_value:='user';
    pages:=array(select distinct x from unnest(coalesce(p_page_permissions,array[]::text[])) x where x=any(allowed_pages));
    scopes:=array(select distinct x from unnest(coalesce(p_productivity_scopes,array[]::text[])) x where x=any(allowed_scopes));
    teams:=array(select distinct x from unnest(coalesce(p_team_scopes,array[]::text[])) x where x=any(allowed_teams));
    if exists(select 1 from unnest(coalesce(p_page_permissions,array[]::text[])) x where not (x=any(allowed_pages))) then return query select false,null::uuid,'invalid_permission'; return; end if;
  end if;
  if '*'=any(scopes) then scopes:=array['*']; end if;
  if '*'=any(teams) then teams:=array['*']; end if;

  insert into public.crvo_auth_users(username,display_name,password_hash,role,is_active,must_change_password,created_by,access_profile,page_permissions,productivity_scopes,team_scopes)
  values(clean_username,coalesce(nullif(trim(p_display_name),''),clean_username),crypt(p_temporary_password,gen_salt('bf',12)),role_value,true,true,admin_id,profile,pages,scopes,teams)
  returning id into new_id;
  return query select true,new_id,null::text;
end
$$;

create or replace function public.crvo_auth_update_user_access_v3(
  p_token_hash text,
  p_user_id uuid,
  p_access_profile text,
  p_page_permissions text[] default array[]::text[],
  p_productivity_scopes text[] default array[]::text[],
  p_team_scopes text[] default array[]::text[]
)
returns table(ok boolean,error_code text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_id uuid; profile text:=coalesce(nullif(trim(p_access_profile),''),'custom'); role_value text; pages text[]; scopes text[]; teams text[];
  allowed_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence','transphere'];
  service_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence'];
  allowed_scopes constant text[]:=array['*','administratif','autre','carrosserie','dsp','expertise','jantes','jockey','lavage','magasin','mecanique','qualite','photo','preparation','diagnostic','encadrement'];
  allowed_teams constant text[]:=array['*','A','B','C','J'];
begin
  select u.id into admin_id from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and u.is_active and u.role='admin' limit 1;
  if admin_id is null then return query select false,'forbidden'; return; end if;
  if profile not in ('admin','service_manager','team_manager','custom','transphere') then return query select false,'invalid_profile'; return; end if;
  if admin_id=p_user_id and profile<>'admin' then return query select false,'cannot_change_self_access'; return; end if;
  if not exists(select 1 from public.crvo_auth_users where id=p_user_id) then return query select false,'not_found'; return; end if;
  if exists(select 1 from unnest(coalesce(p_productivity_scopes,array[]::text[])) x where not (x=any(allowed_scopes))) then return query select false,'invalid_scope'; return; end if;
  if exists(select 1 from unnest(coalesce(p_team_scopes,array[]::text[])) x where not (x=any(allowed_teams))) then return query select false,'invalid_team_scope'; return; end if;

  if profile='admin' then
    role_value:='admin'; pages:=array['*']; scopes:=array['*']; teams:=array['*'];
  elsif profile='transphere' then
    role_value:='user'; pages:=array['transphere']; scopes:=array[]::text[]; teams:=array[]::text[];
  elsif profile='service_manager' then
    role_value:='user'; pages:=service_pages; scopes:=case when coalesce(array_length(p_productivity_scopes,1),0)=0 then array['*'] else p_productivity_scopes end; teams:=array['*'];
  elsif profile='team_manager' then
    role_value:='user'; pages:=array['reporting','productivity','monthly_animation']; scopes:=p_productivity_scopes; teams:=p_team_scopes;
    if coalesce(array_length(scopes,1),0)=0 or coalesce(array_length(teams,1),0)=0 then return query select false,'team_scope_required'; return; end if;
  else
    role_value:='user'; pages:=array(select distinct x from unnest(coalesce(p_page_permissions,array[]::text[])) x where x=any(allowed_pages)); scopes:=p_productivity_scopes; teams:=p_team_scopes;
    if exists(select 1 from unnest(coalesce(p_page_permissions,array[]::text[])) x where not (x=any(allowed_pages))) then return query select false,'invalid_permission'; return; end if;
  end if;
  if '*'=any(scopes) then scopes:=array['*']; end if;
  if '*'=any(teams) then teams:=array['*']; end if;
  update public.crvo_auth_users set role=role_value,access_profile=profile,page_permissions=pages,productivity_scopes=scopes,team_scopes=teams,updated_at=now() where id=p_user_id;
  update public.crvo_auth_sessions set revoked_at=now() where user_id=p_user_id and user_id<>admin_id and revoked_at is null;
  return query select true,null::text;
end
$$;

create or replace function public.kpi_transphere_dashboard_admin(p_session_hash text,p_report_date date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_date date; v_month date; v_day public.kpi_transphere_daily_stats%rowtype; v_target integer;
  v_month_in integer; v_month_out integer; v_month_total integer; v_service numeric; v_fuel numeric; v_days integer;
begin
  if not public.crvo_auth_has_page_permission(p_session_hash,'transphere') then
    raise exception 'Accès Transphère requis.' using errcode='42501';
  end if;
  select coalesce(p_report_date,max(stat_date)) into v_date from public.kpi_transphere_daily_stats;
  if v_date is null then return jsonb_build_object('connected',false,'error','Aucune donnée Transphère.'); end if;
  select * into v_day from public.kpi_transphere_daily_stats where stat_date=v_date;
  if v_day.stat_date is null then select * into v_day from public.kpi_transphere_daily_stats where stat_date<=v_date order by stat_date desc limit 1; v_date:=v_day.stat_date; end if;
  v_month:=date_trunc('month',v_date)::date;
  select target_transports into v_target from public.kpi_transphere_month_targets where month=v_month;
  select coalesce(sum(in_crvo),0),coalesce(sum(out_crvo),0),coalesce(sum(total_transports),0),coalesce(sum(service_hours),0),round(avg(fuel_l_per_100) filter(where fuel_l_per_100 is not null),2),count(*)
    into v_month_in,v_month_out,v_month_total,v_service,v_fuel,v_days from public.kpi_transphere_daily_stats where stat_date between v_month and v_date;
  return jsonb_build_object(
    'connected',true,'entity','TRANSPHERE','reportDate',to_char(v_date,'YYYY-MM-DD'),'month',to_char(v_month,'YYYY-MM-DD'),'sourceFile',v_day.source_file,
    'day',jsonb_build_object('entries',v_day.in_crvo,'exits',v_day.out_crvo,'total',v_day.total_transports,'objective',v_day.daily_objective,'delta',v_day.total_transports-v_day.daily_objective,'achievement',case when v_day.daily_objective>0 then round(v_day.total_transports::numeric/v_day.daily_objective*100,1) else null end,'serviceHours',v_day.service_hours,'fuelLPer100',v_day.fuel_l_per_100),
    'monthToDate',jsonb_build_object('entries',v_month_in,'exits',v_month_out,'total',v_month_total,'objectiveAtDate',v_day.cumulative_objective,'delta',v_month_total-v_day.cumulative_objective,'achievementAtDate',case when v_day.cumulative_objective>0 then round(v_month_total::numeric/v_day.cumulative_objective*100,1) else null end,'monthlyTarget',v_target,'monthlyProgress',case when coalesce(v_target,0)>0 then round(v_month_total::numeric/v_target*100,1) else null end,'remainingToTarget',case when v_target is null then null else greatest(v_target-v_month_total,0) end,'serviceHours',round(v_service,2),'averageFuelLPer100',v_fuel,'workedDays',v_days,'averageDaily',case when v_days>0 then round(v_month_total::numeric/v_days,1) else null end),
    'trend',coalesce((select jsonb_agg(jsonb_build_object('date',to_char(stat_date,'YYYY-MM-DD'),'entries',in_crvo,'exits',out_crvo,'total',total_transports,'objective',daily_objective,'cumulative',cumulative_transports,'cumulativeObjective',cumulative_objective,'serviceHours',service_hours,'fuelLPer100',fuel_l_per_100) order by stat_date) from public.kpi_transphere_daily_stats where stat_date between v_month and v_date),'[]'::jsonb)
  );
end
$$;
