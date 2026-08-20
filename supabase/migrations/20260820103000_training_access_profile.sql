-- Permission racine Formation & Compétences + profil FORMATEUR.

create or replace function public.crvo_auth_create_user_v4(
  p_token_hash text,
  p_username text,
  p_display_name text,
  p_temporary_password text,
  p_access_profile text default 'custom',
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
  admin_id uuid;
  new_id uuid;
  clean_username text:=lower(trim(p_username));
  profile text:=coalesce(nullif(trim(p_access_profile),''),'custom');
  role_value text;
  pages text[];
  scopes text[];
  teams text[];
  allowed_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence','transphere','worktime','data_rh','settings','training'];
  service_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence','worktime','training'];
  allowed_scopes constant text[]:=array['*','administratif','autre','carrosserie','dsp','expertise','jantes','jockey','lavage','magasin','mecanique','qualite','photo','preparation','diagnostic','encadrement'];
  allowed_teams constant text[]:=array['*','A','B','C','J','TRANSPHERE'];
begin
  select u.id into admin_id
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and u.is_active and u.role='admin'
  limit 1;
  if admin_id is null then return query select false,null::uuid,'forbidden';return;end if;
  if clean_username !~ '^[a-z0-9._-]{3,40}$' then return query select false,null::uuid,'invalid_username';return;end if;
  if length(coalesce(p_temporary_password,''))<12 then return query select false,null::uuid,'password_too_short';return;end if;
  if profile not in ('admin','service_manager','team_manager','custom','transphere','transphere_manager','hr','trainer') then return query select false,null::uuid,'invalid_profile';return;end if;
  if exists(select 1 from public.crvo_auth_users where lower(username)=clean_username) then return query select false,null::uuid,'username_exists';return;end if;

  if profile='admin' then role_value:='admin';pages:=array['*'];scopes:=array['*'];teams:=array['*'];
  elsif profile='hr' then role_value:='user';pages:=array['worktime','data_rh','training'];scopes:=array['*'];teams:=array['*'];
  elsif profile='trainer' then role_value:='user';pages:=array['training'];scopes:=array[]::text[];teams:=array[]::text[];
  elsif profile='team_manager' then role_value:='user';pages:=array['reporting','worktime'];scopes:=array[]::text[];teams:=p_team_scopes;if coalesce(array_length(teams,1),0)=0 then return query select false,null::uuid,'team_scope_required';return;end if;
  elsif profile='transphere' then role_value:='user';pages:=array['transphere'];scopes:=array[]::text[];teams:=array[]::text[];
  elsif profile='transphere_manager' then role_value:='user';pages:=array['transphere','worktime'];scopes:=array[]::text[];teams:=case when coalesce(array_length(p_team_scopes,1),0)=0 then array['TRANSPHERE'] else p_team_scopes end;
  elsif profile='service_manager' then role_value:='user';pages:=service_pages;scopes:=case when coalesce(array_length(p_productivity_scopes,1),0)=0 then array['*'] else p_productivity_scopes end;teams:=array['*'];
  else role_value:='user';pages:=array(select distinct x from unnest(coalesce(p_page_permissions,array[]::text[]))x where x=any(allowed_pages));scopes:=array(select distinct x from unnest(coalesce(p_productivity_scopes,array[]::text[]))x where x=any(allowed_scopes));teams:=array(select distinct x from unnest(coalesce(p_team_scopes,array[]::text[]))x where x=any(allowed_teams));end if;

  insert into public.crvo_auth_users(username,display_name,password_hash,role,is_active,must_change_password,created_by,access_profile,page_permissions,productivity_scopes,team_scopes)
  values(clean_username,coalesce(nullif(trim(p_display_name),''),clean_username),crypt(p_temporary_password,gen_salt('bf',12)),role_value,true,true,admin_id,profile,pages,scopes,teams)
  returning id into new_id;

  if profile='trainer' then
    update public.kpi_training_trainers set user_id=new_id,updated_at=now()
    where id=(select id from public.kpi_training_trainers where user_id is null and public.kpi_training_normalize_name(display_name)=public.kpi_training_normalize_name(coalesce(nullif(trim(p_display_name),''),clean_username)) order by created_at limit 1);
    if not exists(select 1 from public.kpi_training_trainers where user_id=new_id) then
      insert into public.kpi_training_trainers(display_name,user_id,specialty) values(coalesce(nullif(trim(p_display_name),''),clean_username),new_id,'Carrosserie');
    end if;
  end if;

  return query select true,new_id,null::text;
end$$;

create or replace function public.crvo_auth_update_user_access_v4(
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
  admin_id uuid;
  profile text:=coalesce(nullif(trim(p_access_profile),''),'custom');
  role_value text;
  pages text[];
  scopes text[];
  teams text[];
  target_name text;
  allowed_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence','transphere','worktime','data_rh','settings','training'];
  service_pages constant text[]:=array['reporting','productivity','monthly_animation','book','cockpit','bodyshop','client_dashboard','intelligence','worktime','training'];
begin
  select u.id into admin_id from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and u.is_active and u.role='admin' limit 1;
  if admin_id is null then return query select false,'forbidden';return;end if;
  if admin_id=p_user_id and profile<>'admin' then return query select false,'cannot_change_self_access';return;end if;
  select display_name into target_name from public.crvo_auth_users where id=p_user_id;
  if target_name is null then return query select false,'not_found';return;end if;

  if profile='admin' then role_value:='admin';pages:=array['*'];scopes:=array['*'];teams:=array['*'];
  elsif profile='hr' then role_value:='user';pages:=array['worktime','data_rh','training'];scopes:=array['*'];teams:=array['*'];
  elsif profile='trainer' then role_value:='user';pages:=array['training'];scopes:=array[]::text[];teams:=array[]::text[];
  elsif profile='team_manager' then role_value:='user';pages:=array['reporting','worktime'];scopes:=array[]::text[];teams:=p_team_scopes;if coalesce(array_length(teams,1),0)=0 then return query select false,'team_scope_required';return;end if;
  elsif profile='transphere' then role_value:='user';pages:=array['transphere'];scopes:=array[]::text[];teams:=array[]::text[];
  elsif profile='transphere_manager' then role_value:='user';pages:=array['transphere','worktime'];scopes:=array[]::text[];teams:=case when coalesce(array_length(p_team_scopes,1),0)=0 then array['TRANSPHERE'] else p_team_scopes end;
  elsif profile='service_manager' then role_value:='user';pages:=service_pages;scopes:=case when coalesce(array_length(p_productivity_scopes,1),0)=0 then array['*'] else p_productivity_scopes end;teams:=array['*'];
  elsif profile='custom' then role_value:='user';pages:=array(select distinct x from unnest(coalesce(p_page_permissions,array[]::text[]))x where x=any(allowed_pages));scopes:=p_productivity_scopes;teams:=p_team_scopes;
  else return query select false,'invalid_profile';return;end if;

  update public.crvo_auth_users set role=role_value,access_profile=profile,page_permissions=pages,productivity_scopes=scopes,team_scopes=teams,updated_at=now() where id=p_user_id;

  if profile='trainer' then
    update public.kpi_training_trainers set user_id=p_user_id,updated_at=now()
    where id=(select id from public.kpi_training_trainers where (user_id=p_user_id) or (user_id is null and public.kpi_training_normalize_name(display_name)=public.kpi_training_normalize_name(target_name)) order by (user_id=p_user_id) desc,created_at limit 1);
    if not exists(select 1 from public.kpi_training_trainers where user_id=p_user_id) then insert into public.kpi_training_trainers(display_name,user_id,specialty) values(target_name,p_user_id,'Carrosserie');end if;
  else
    update public.kpi_training_trainers set user_id=null,updated_at=now() where user_id=p_user_id;
  end if;

  update public.crvo_auth_sessions set revoked_at=now() where user_id=p_user_id and user_id<>admin_id and revoked_at is null;
  return query select true,null::text;
end$$;

revoke all on function public.crvo_auth_create_user_v4(text,text,text,text,text,text[],text[],text[]) from public;
revoke all on function public.crvo_auth_update_user_access_v4(text,uuid,text,text[],text[],text[]) from public;
grant execute on function public.crvo_auth_create_user_v4(text,text,text,text,text,text[],text[],text[]) to anon,authenticated,service_role;
grant execute on function public.crvo_auth_update_user_access_v4(text,uuid,text,text[],text[],text[]) to anon,authenticated,service_role;

-- Les profils déjà en place récupèrent automatiquement le nouveau module.
update public.crvo_auth_users
set page_permissions=case when page_permissions @> array['training']::text[] then page_permissions else array_append(coalesce(page_permissions,array[]::text[]),'training') end,updated_at=now()
where role<>'admin' and access_profile in ('service_manager','hr');
