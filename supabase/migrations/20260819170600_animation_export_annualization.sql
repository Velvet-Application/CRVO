-- Additive modules only: Animation du centre / Export + worktime annualization.

create table if not exists public.kpi_worktime_annualization (
  id uuid primary key default gen_random_uuid(), entity text not null check (entity in ('CRVO','TRANSPHERE')),
  employee_key text not null, employee_name text not null, team_code text null, service text null, sector_key text null,
  work_date date not null, hours numeric(7,2) not null check (hours <> 0 and abs(hours) <= 24), comment text null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  created_by uuid not null references public.crvo_auth_users(id), created_by_name text not null, created_at timestamptz not null default now(),
  closed_by uuid null references public.crvo_auth_users(id), closed_by_name text null, closed_at timestamptz null
);
create index if not exists kpi_worktime_annualization_period_idx on public.kpi_worktime_annualization(entity,work_date);
create index if not exists kpi_worktime_annualization_employee_idx on public.kpi_worktime_annualization(entity,employee_key,work_date);
revoke all on public.kpi_worktime_annualization from anon,authenticated;

create or replace function public.kpi_worktime_add_annualization(p_session_hash text,p_entity text,p_employee_key text,p_work_date date,p_hours numeric,p_comment text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_scope record; v_name text; v_team text; v_service text; v_sector text; v_id uuid; v_entity text:=upper(p_entity);
begin
 select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
 if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
 if p_hours=0 or abs(p_hours)>24 then raise exception 'Volume annualisation invalide.' using errcode='22023'; end if;
 select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,v_entity) limit 1;
 if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
 if v_entity='CRVO' then
   select d.full_name,d.team_code,d.service,coalesce(m.sector_key,'autre') into v_name,v_team,v_service,v_sector from public.kpi_rh_staff_dimension d left join public.kpi_worktime_service_sector_map m on m.service_code=d.service where d.active and d.employee_key=p_employee_key limit 1;
 else
   select full_name,team_code,service,'transphere' into v_name,v_team,v_service,v_sector from public.kpi_worktime_people where entity='TRANSPHERE' and active and employee_key=p_employee_key limit 1;
 end if;
 if v_name is null then raise exception 'Collaborateur introuvable.' using errcode='22023'; end if;
 if not v_scope.all_access and not ('*'=any(v_scope.team_codes) or v_team=any(v_scope.team_codes)) then raise exception 'Collaborateur hors périmètre équipe.' using errcode='42501'; end if;
 if not v_scope.all_access and not ('*'=any(v_scope.sector_keys) or v_sector=any(v_scope.sector_keys)) then raise exception 'Collaborateur hors périmètre secteur.' using errcode='42501'; end if;
 insert into public.kpi_worktime_annualization(entity,employee_key,employee_name,team_code,service,sector_key,work_date,hours,comment,created_by,created_by_name) values(v_entity,p_employee_key,v_name,v_team,v_service,v_sector,p_work_date,p_hours,nullif(trim(p_comment),''),v_user.id,v_user.display_name) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id);
end $$;

create or replace function public.kpi_worktime_annualization_list(p_session_hash text,p_entity text,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_scope record; v_entity text:=upper(p_entity); v_rows jsonb; v_balances jsonb;
begin
 select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
 if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
 select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,v_entity) limit 1;
 if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'employeeKey',a.employee_key,'employeeName',a.employee_name,'team',a.team_code,'service',a.service,'sector',a.sector_key,'workDate',a.work_date,'hours',a.hours,'comment',a.comment,'status',a.status,'createdBy',a.created_by_name,'createdAt',a.created_at,'closedBy',a.closed_by_name,'closedAt',a.closed_at) order by a.work_date desc,a.employee_name),'[]'::jsonb) into v_rows from public.kpi_worktime_annualization a where a.entity=v_entity and a.status<>'cancelled' and a.work_date between p_from and p_to and (v_scope.all_access or ('*'=any(v_scope.team_codes) or a.team_code=any(v_scope.team_codes)) and ('*'=any(v_scope.sector_keys) or a.sector_key=any(v_scope.sector_keys)));
 select coalesce(jsonb_agg(jsonb_build_object('employeeKey',employee_key,'employeeName',employee_name,'balanceHours',balance) order by employee_name),'[]'::jsonb) into v_balances from (select a.employee_key,max(a.employee_name) employee_name,round(sum(a.hours) filter(where a.status<>'cancelled')::numeric,2) balance from public.kpi_worktime_annualization a where a.entity=v_entity and (v_scope.all_access or ('*'=any(v_scope.team_codes) or a.team_code=any(v_scope.team_codes)) and ('*'=any(v_scope.sector_keys) or a.sector_key=any(v_scope.sector_keys))) group by a.employee_key) x;
 return jsonb_build_object('rows',v_rows,'balances',v_balances);
end $$;

create or replace function public.kpi_worktime_annualization_status(p_session_hash text,p_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_row public.kpi_worktime_annualization%rowtype;
begin
 select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
 select * into v_row from public.kpi_worktime_annualization where id=p_id for update;
 if v_row.id is null then raise exception 'Annualisation introuvable.' using errcode='22023'; end if;
 if p_action='close' then if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Clôture RH requise.' using errcode='42501'; end if; update public.kpi_worktime_annualization set status='closed',closed_by=v_user.id,closed_by_name=v_user.display_name,closed_at=now() where id=p_id and status='open';
 elsif p_action='reopen' then if not (v_user.role='admin' or v_user.access_profile='hr') then raise exception 'Réouverture RH requise.' using errcode='42501'; end if; update public.kpi_worktime_annualization set status='open',closed_by=null,closed_by_name=null,closed_at=null where id=p_id and status='closed';
 elsif p_action='cancel' then if v_row.status<>'open' then raise exception 'Annualisation verrouillée.' using errcode='42501'; end if; if not (v_user.role='admin' or v_user.access_profile='hr' or v_row.created_by=v_user.id) then raise exception 'Annulation interdite.' using errcode='42501'; end if; update public.kpi_worktime_annualization set status='cancelled' where id=p_id;
 else raise exception 'Action invalide.' using errcode='22023'; end if;
 return jsonb_build_object('ok',true);
end $$;

grant execute on function public.kpi_worktime_add_annualization(text,text,text,date,numeric,text),public.kpi_worktime_annualization_list(text,text,date,date),public.kpi_worktime_annualization_status(text,uuid,text) to anon,authenticated,service_role;

-- The export read model uses the certified current intelligence view. Store metrics are dossier-level because the FTP does not expose physical part-line counts.
create or replace function public.kpi_animation_export(p_session_hash text,p_position_key text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_user public.crvo_auth_users%rowtype; v_own text; v_pos public.kpi_worktime_org_positions%rowtype; v_positions jsonb; v_sectors text[]; v_teams text[]; v_all boolean:=false; v_vehicles jsonb; v_sector_summary jsonb; v_store jsonb; v_source timestamptz;
begin
 select u.* into v_user from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
 if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
 select up.position_key into v_own from public.kpi_worktime_user_position up where up.user_id=v_user.id limit 1;
 if coalesce(p_position_key,'')='' then if v_user.role='admin' then v_all:=true;v_sectors:=array['*'];v_teams:=array['*']; elsif v_own is not null then select * into v_pos from public.kpi_worktime_org_positions where position_key=v_own and active;v_all:=v_pos.all_access;v_sectors:=v_pos.sector_keys;v_teams:=v_pos.team_codes; else raise exception 'Périmètre organigramme requis.' using errcode='42501'; end if;
 else if v_user.role<>'admin' and p_position_key<>v_own then raise exception 'Périmètre interdit.' using errcode='42501'; end if;select * into v_pos from public.kpi_worktime_org_positions where position_key=p_position_key and active and entity='CRVO';if v_pos.position_key is null then raise exception 'Poste introuvable.' using errcode='22023'; end if;v_all:=v_pos.all_access;v_sectors:=v_pos.sector_keys;v_teams:=v_pos.team_codes;end if;
 select max(latest_source_modified_at) into v_source from public.kpi_intelligence_vehicle_public;
 select coalesce(jsonb_agg(jsonb_build_object('positionKey',position_key,'name',person_name,'title',title,'level',level_code,'teams',team_codes,'sectors',sector_keys,'allAccess',all_access) order by sort_order),'[]'::jsonb) into v_positions from public.kpi_worktime_org_positions where active and entity='CRVO' and level_code in ('industrial_manager','supervisor','team_leader');
 with scoped as (select * from public.kpi_intelligence_vehicle_public v where v_all or '*'=any(v_sectors) or v.current_sector_key=any(v_sectors)), ranked as (select s.*,row_number() over(partition by current_sector_key order by coalesce(effective_factory_age_days,factory_age_days,0) desc,registration) rn from scoped s) select coalesce(jsonb_agg(jsonb_build_object('sector',current_sector_key,'registration',registration,'workOrder',work_order,'model',model,'status',status,'ageDays',coalesce(effective_factory_age_days,factory_age_days,0),'urgency',urgency,'alert',alert,'partOrderedDays',part_ordered_days,'blockingCause',blocking_cause) order by current_sector_key,rn),'[]'::jsonb) into v_vehicles from ranked where rn<=10;
 with scoped as (select * from public.kpi_intelligence_vehicle_public v where v_all or '*'=any(v_sectors) or v.current_sector_key=any(v_sectors)) select coalesce(jsonb_agg(jsonb_build_object('sector',current_sector_key,'stock',cnt,'over15',over15,'over20',over20,'avgAge',avg_age,'oldestAge',oldest_age,'urgents',urgents) order by cnt desc),'[]'::jsonb) into v_sector_summary from (select current_sector_key,count(*) cnt,count(*) filter(where coalesce(effective_factory_age_days,factory_age_days,0)>15) over15,count(*) filter(where coalesce(effective_factory_age_days,factory_age_days,0)>20) over20,round(avg(coalesce(effective_factory_age_days,factory_age_days,0))::numeric,1) avg_age,max(coalesce(effective_factory_age_days,factory_age_days,0)) oldest_age,count(*) filter(where coalesce(urgency,'')<>'') urgents from scoped group by current_sector_key) x;
 select jsonb_build_object('avgOrderLeadDays',round(avg(part_ordered_days) filter(where part_ordered_days is not null)::numeric,1),'foldersOver3Days',count(*) filter(where part_ordered_days>3),'foldersWithPartsOrder',count(*) filter(where part_ordered_days is not null),'oldestOrderDays',max(part_ordered_days),'oldest',coalesce((select jsonb_agg(jsonb_build_object('registration',registration,'workOrder',work_order,'model',model,'status',status,'partOrderedDays',part_ordered_days,'ageDays',coalesce(effective_factory_age_days,factory_age_days,0)) order by part_ordered_days desc) from (select * from public.kpi_intelligence_vehicle_public where part_ordered_days is not null order by part_ordered_days desc limit 10) q),'[]'::jsonb)) into v_store from public.kpi_intelligence_vehicle_public;
 return jsonb_build_object('connected',true,'generatedAt',now(),'sourceModifiedAt',v_source,'selected',case when v_pos.position_key is null then jsonb_build_object('positionKey',null,'name','Vue globale','title','CRVO Lens','teams',v_teams,'sectors',v_sectors,'allAccess',v_all) else jsonb_build_object('positionKey',v_pos.position_key,'name',v_pos.person_name,'title',v_pos.title,'teams',v_teams,'sectors',v_sectors,'allAccess',v_all) end,'positions',v_positions,'sectorSummary',v_sector_summary,'oldestVehicles',v_vehicles,'store',v_store);
end $$;
grant execute on function public.kpi_animation_export(text,text) to anon,authenticated,service_role;
