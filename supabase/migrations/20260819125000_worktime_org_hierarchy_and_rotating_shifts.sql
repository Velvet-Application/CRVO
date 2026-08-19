-- Worktime organizational hierarchy and rotating shift model.
-- Applied to production on 2026-08-19.

alter table public.kpi_worktime_shift_config add column if not exists break_start time null;
alter table public.kpi_worktime_shift_config add column if not exists break_end time null;
alter table public.kpi_worktime_shift_config add column if not exists alternate_start_time time null;
alter table public.kpi_worktime_shift_config add column if not exists alternate_end_time time null;
alter table public.kpi_worktime_shift_config add column if not exists rotation_mode text not null default 'fixed';
alter table public.kpi_worktime_shift_config add column if not exists rotation_anchor_monday date null;
alter table public.kpi_worktime_shift_config add column if not exists rotation_anchor_primary boolean not null default true;
alter table public.kpi_worktime_shift_config drop constraint if exists kpi_worktime_shift_rotation_ck;
alter table public.kpi_worktime_shift_config add constraint kpi_worktime_shift_rotation_ck check(rotation_mode in ('fixed','weekly_alternate'));

update public.kpi_worktime_shift_config set start_time='05:00',end_time='13:00',alternate_start_time='13:00',alternate_end_time='21:00',break_start=null,break_end=null,rotation_mode='weekly_alternate',rotation_anchor_monday=null,rotation_anchor_primary=true,label='Equipe A - rotation matin / après-midi' where entity='CRVO' and team_code='A';
update public.kpi_worktime_shift_config set start_time='13:00',end_time='21:00',alternate_start_time='05:00',alternate_end_time='13:00',break_start=null,break_end=null,rotation_mode='weekly_alternate',rotation_anchor_monday=null,rotation_anchor_primary=true,label='Equipe B - rotation après-midi / matin' where entity='CRVO' and team_code='B';
update public.kpi_worktime_shift_config set start_time='21:00',end_time='05:00',alternate_start_time=null,alternate_end_time=null,break_start=null,break_end=null,rotation_mode='fixed',label='Equipe C - nuit' where entity='CRVO' and team_code='C';
update public.kpi_worktime_shift_config set start_time='08:30',end_time='17:00',alternate_start_time=null,alternate_end_time=null,break_start='12:30',break_end='13:00',rotation_mode='fixed',label='Journée Admin / MPR' where entity='CRVO' and team_code='J';

create table if not exists public.kpi_worktime_service_sector_map(service_code text primary key,sector_key text not null,sector_label text not null,updated_at timestamptz not null default now());
insert into public.kpi_worktime_service_sector_map(service_code,sector_key,sector_label) values
('EXP','expertise','Expertise'),('MEC','mecanique','Mécanique'),('DSP','carrosserie','Carrosserie'),('BOX','carrosserie','Carrosserie'),('FIX','carrosserie','Carrosserie'),('TOL','carrosserie','Carrosserie'),('PRE','preparation','Préparation'),('LAV','preparation','Préparation'),('PHO','preparation','Préparation'),('QUA','qualite','Qualité'),('MGN','magasin','Magasin / MPR'),('ACH','magasin','Magasin / MPR'),('ADMIN','admin','Administratif'),('ADM','admin','Administratif'),('JAN','jantes','Jantes'),('JOC','jockey','Jockey'),('TRA','encadrement','Encadrement / transverse'),('CHE','encadrement','Encadrement / transverse'),('APP','autre','Autre')
on conflict(service_code) do update set sector_key=excluded.sector_key,sector_label=excluded.sector_label,updated_at=now();

create table if not exists public.kpi_worktime_org_positions(
 position_key text primary key,entity text not null check(entity in ('CRVO','TRANSPHERE')),person_name text not null,title text not null,
 level_code text not null check(level_code in ('industrial_manager','supervisor','team_leader','entity_manager')),
 parent_position_key text null references public.kpi_worktime_org_positions(position_key),team_codes text[] not null default array[]::text[],sector_keys text[] not null default array[]::text[],
 all_access boolean not null default false,preferred_profile text not null default 'team_manager',shift_group text null,sort_order integer not null default 100,active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.kpi_worktime_user_position(user_id uuid primary key references public.crvo_auth_users(id) on delete cascade,position_key text not null references public.kpi_worktime_org_positions(position_key),assigned_at timestamptz not null default now(),assigned_by uuid null references public.crvo_auth_users(id));
create index if not exists kpi_worktime_org_parent_idx on public.kpi_worktime_org_positions(parent_position_key,sort_order);

insert into public.kpi_worktime_org_positions(position_key,entity,person_name,title,level_code,parent_position_key,team_codes,sector_keys,all_access,preferred_profile,shift_group,sort_order) values
('crvo_industrial_piasecki','CRVO','Jean-François PIASECKI','Responsable industriel','industrial_manager',null,array['*'],array['*'],true,'admin',null,10),
('crvo_supervisor_day_cavrois','CRVO','Giovanny CAVROIS','Superviseur de jour','supervisor','crvo_industrial_piasecki',array['A','B'],array['mecanique','carrosserie','preparation'],false,'team_manager','AB',20),
('crvo_supervisor_night_theron','CRVO','Yves-Marie THERON','Superviseur de nuit','supervisor','crvo_industrial_piasecki',array['C'],array['*'],false,'team_manager','C',30),
('crvo_supervisor_exp_quality_velle','CRVO','Yohan VELLE','Superviseur Expertise / Qualité','supervisor','crvo_industrial_piasecki',array['A','B'],array['expertise','qualite'],false,'team_manager','AB',40),
('crvo_lead_exp_ab_legrand','CRVO','Vanessa LEGRAND','Cheffe d’équipe Expertise A & B','team_leader','crvo_supervisor_exp_quality_velle',array['A','B'],array['expertise'],false,'team_manager','AB',100),
('crvo_lead_exp_a_bartczak','CRVO','Frédéric BARTCZAK','Chef d’équipe Expertise A','team_leader','crvo_supervisor_exp_quality_velle',array['A'],array['expertise'],false,'team_manager','A',110),
('crvo_lead_mec_a_lemort','CRVO','Christopher LEMORT','Chef d’équipe Mécanique A','team_leader','crvo_supervisor_day_cavrois',array['A'],array['mecanique'],false,'team_manager','A',120),
('crvo_lead_body_a_spreux','CRVO','Anthony SPREUX','Chef d’équipe Carrosserie A','team_leader','crvo_supervisor_day_cavrois',array['A'],array['carrosserie'],false,'team_manager','A',130),
('crvo_lead_body_a_colaert','CRVO','Jean-François COLAERT','Chef d’équipe Carrosserie A','team_leader','crvo_supervisor_day_cavrois',array['A'],array['carrosserie'],false,'team_manager','A',131),
('crvo_lead_prep_a_atmania','CRVO','Audrey ATMANIA','Cheffe d’équipe Préparation A','team_leader','crvo_supervisor_day_cavrois',array['A'],array['preparation'],false,'team_manager','A',140),
('crvo_lead_quality_a_destunder','CRVO','Steven DESTUNDER','Chef d’équipe Qualité A','team_leader','crvo_supervisor_exp_quality_velle',array['A'],array['qualite'],false,'team_manager','A',150),
('crvo_lead_exp_b_hourde','CRVO','Karine HOURDE','Cheffe d’équipe Expertise B','team_leader','crvo_supervisor_exp_quality_velle',array['B'],array['expertise'],false,'team_manager','B',160),
('crvo_lead_mec_b_coillot','CRVO','Jeffrey COILLOT','Chef d’équipe Mécanique B','team_leader','crvo_supervisor_day_cavrois',array['B'],array['mecanique'],false,'team_manager','B',170),
('crvo_lead_body_b_clabaut','CRVO','Jordan CLABAUT','Chef d’équipe Carrosserie B','team_leader','crvo_supervisor_day_cavrois',array['B'],array['carrosserie'],false,'team_manager','B',180),
('crvo_lead_body_b_degardin','CRVO','Jean-Marc DEGARDIN','Chef d’équipe Carrosserie B','team_leader','crvo_supervisor_day_cavrois',array['B'],array['carrosserie'],false,'team_manager','B',181),
('crvo_lead_prep_b_marmuse','CRVO','Anthony MARMUSE','Chef d’équipe Préparation B','team_leader','crvo_supervisor_day_cavrois',array['B'],array['preparation'],false,'team_manager','B',190),
('crvo_lead_quality_b_lopes','CRVO','Morgane LOPES','Cheffe d’équipe Qualité B','team_leader','crvo_supervisor_exp_quality_velle',array['B'],array['qualite'],false,'team_manager','B',200),
('crvo_lead_store_balingon','CRVO','Benjamin BALINGON','Chef d’équipe Magasin / MPR','team_leader','crvo_industrial_piasecki',array['*'],array['magasin'],false,'team_manager','J',210),
('crvo_lead_admin_maniez','CRVO','Céline MANIEZ','Cheffe d’équipe Administratif','team_leader','crvo_industrial_piasecki',array['*'],array['admin'],false,'team_manager','J',220),
('transphere_manager_corbeau','TRANSPHERE','Baptiste CORBEAU','Responsable Transphère','entity_manager',null,array['*'],array['*'],true,'transphere_manager','TRANSPHERE',10),
('transphere_lead_gronus','TRANSPHERE','Fabien GRONUS','Chef d’équipe Transphère','team_leader','transphere_manager_corbeau',array['*'],array['*'],false,'transphere_manager','TRANSPHERE',20)
on conflict(position_key) do update set person_name=excluded.person_name,title=excluded.title,level_code=excluded.level_code,parent_position_key=excluded.parent_position_key,team_codes=excluded.team_codes,sector_keys=excluded.sector_keys,all_access=excluded.all_access,preferred_profile=excluded.preferred_profile,shift_group=excluded.shift_group,sort_order=excluded.sort_order,active=true,updated_at=now();

insert into public.kpi_worktime_user_position(user_id,position_key,assigned_by)
select id,'crvo_lead_admin_maniez',id from public.crvo_auth_users where username='celine.maniez'
on conflict(user_id) do update set position_key=excluded.position_key,assigned_at=now();

create or replace function public.kpi_worktime_scope_for_user(p_user_id uuid,p_entity text)
returns table(all_access boolean,team_codes text[],sector_keys text[],can_close boolean,can_config boolean,level_code text,position_key text)
language plpgsql stable security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_pos public.kpi_worktime_org_positions%rowtype; v_entity text:=upper(p_entity);
begin
 select * into v_user from public.crvo_auth_users where id=p_user_id and is_active;
 if v_user.id is null then return; end if;
 if v_user.role='admin' then return query select true,array['*']::text[],array['*']::text[],true,true,'admin'::text,null::text; return; end if;
 if v_user.access_profile='hr' then return query select true,array['*']::text[],array['*']::text[],true,true,'hr'::text,null::text; return; end if;
 select p.* into v_pos from public.kpi_worktime_user_position up join public.kpi_worktime_org_positions p on p.position_key=up.position_key where up.user_id=p_user_id and p.active and p.entity=v_entity limit 1;
 if v_pos.position_key is not null then return query select v_pos.all_access,coalesce(v_pos.team_codes,array[]::text[]),coalesce(v_pos.sector_keys,array[]::text[]),false,false,v_pos.level_code,v_pos.position_key; return; end if;
 if v_user.access_profile='team_manager' and v_entity='CRVO' then return query select false,coalesce(v_user.team_scopes,array[]::text[]),array['*']::text[],false,false,'team_leader'::text,null::text; return; end if;
 if v_user.access_profile='transphere_manager' and v_entity='TRANSPHERE' then return query select true,array['*']::text[],array['*']::text[],false,false,'team_leader'::text,null::text; return; end if;
 if 'worktime'=any(coalesce(v_user.page_permissions,array[]::text[])) then return query select ('*'=any(coalesce(v_user.team_scopes,array[]::text[]))),coalesce(v_user.team_scopes,array[]::text[]),array['*']::text[],false,false,'custom'::text,null::text; return; end if;
end $$;

create or replace function public.kpi_worktime_organization_admin(p_session_hash text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_admin uuid;
begin
 select u.id into v_admin from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active and u.role='admin' limit 1;
 if v_admin is null then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
 return jsonb_build_object('positions',coalesce((select jsonb_agg(jsonb_build_object('key',p.position_key,'entity',p.entity,'name',p.person_name,'title',p.title,'level',p.level_code,'parent',p.parent_position_key,'teams',p.team_codes,'sectors',p.sector_keys,'allAccess',p.all_access,'preferredProfile',p.preferred_profile,'shiftGroup',p.shift_group,'userId',u.id,'username',u.username) order by p.entity,p.sort_order,p.person_name) from public.kpi_worktime_org_positions p left join public.kpi_worktime_user_position up on up.position_key=p.position_key left join public.crvo_auth_users u on u.id=up.user_id where p.active),'[]'::jsonb));
end $$;

create or replace function public.kpi_worktime_bind_position(p_session_hash text,p_position_key text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_admin uuid; v_profile text;
begin
 select u.id into v_admin from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active and u.role='admin' limit 1;
 if v_admin is null then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
 if not exists(select 1 from public.crvo_auth_users where id=p_user_id and is_active) then raise exception 'Utilisateur introuvable.' using errcode='22023'; end if;
 select preferred_profile into v_profile from public.kpi_worktime_org_positions where position_key=p_position_key and active;
 if v_profile is null then raise exception 'Poste introuvable.' using errcode='22023'; end if;
 insert into public.kpi_worktime_user_position(user_id,position_key,assigned_by) values(p_user_id,p_position_key,v_admin) on conflict(user_id) do update set position_key=excluded.position_key,assigned_at=now(),assigned_by=excluded.assigned_by;
 return jsonb_build_object('ok',true,'positionKey',p_position_key,'preferredProfile',v_profile);
end $$;

grant execute on function public.kpi_worktime_scope_for_user(uuid,text),public.kpi_worktime_organization_admin(text),public.kpi_worktime_bind_position(text,text,uuid) to anon,authenticated,service_role;
