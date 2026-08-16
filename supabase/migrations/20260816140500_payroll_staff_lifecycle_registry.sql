alter table public.kpi_rh_staff_dimension
  add column if not exists active boolean not null default true,
  add column if not exists entry_date date,
  add column if not exists exit_date date,
  add column if not exists job_title text,
  add column if not exists employment_status text not null default 'active';

create table if not exists public.kpi_staff_registry (
  employee_key text primary key,
  matricule text,
  first_name text,
  last_name text,
  full_name text not null,
  name_key text not null,
  service text,
  team_code text check (team_code is null or team_code in ('A','B','C')),
  job_title text,
  entry_date date,
  exit_date date,
  employment_status text not null default 'active' check (employment_status in ('active','exited','pending')),
  active boolean not null default true,
  source_filename text,
  source_sha256 text,
  source_imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists kpi_staff_registry_matricule_idx on public.kpi_staff_registry(matricule) where matricule is not null;
create index if not exists kpi_staff_registry_name_key_idx on public.kpi_staff_registry(name_key);
create index if not exists kpi_staff_registry_active_idx on public.kpi_staff_registry(active, service, team_code);

create table if not exists public.kpi_staff_import_runs (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_sha256 text,
  imported_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'processing' check (status in ('processing','success','failed')),
  total_rows integer not null default 0,
  active_rows integer not null default 0,
  exit_rows integer not null default 0,
  configured_bonus_rows integer not null default 0,
  pending_bonus_rows integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.kpi_staff_events (
  id bigint generated always as identity primary key,
  import_run_id uuid references public.kpi_staff_import_runs(id),
  employee_key text not null,
  matricule text,
  full_name text not null,
  event_type text not null check (event_type in ('entry','reactivation','update','exit','pending_configuration')),
  effective_date date,
  actor_id uuid,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);
create index if not exists kpi_staff_events_employee_idx on public.kpi_staff_events(employee_key,created_at desc);
create index if not exists kpi_staff_events_run_idx on public.kpi_staff_events(import_run_id);

insert into public.kpi_staff_registry(employee_key,matricule,first_name,last_name,full_name,name_key,service,team_code,active,employment_status,source_filename,source_imported_at,metadata)
select d.employee_key,d.matricule,d.first_name,d.last_name,d.full_name,d.name_key,d.service,d.team_code,true,'active',d.source_filename,d.source_updated_at,
       coalesce(d.metadata,'{}'::jsonb)||jsonb_build_object('seeded_from','kpi_rh_staff_dimension')
from public.kpi_rh_staff_dimension d
on conflict(employee_key) do nothing;

create or replace function public.kpi_staff_assignment_map(p_service text,p_job_title text)
returns jsonb
language plpgsql immutable
set search_path to 'public'
as $$
declare s text:=lower(coalesce(p_job_title,'')||' '||coalesce(p_service,''));
begin
  if s ~ '(chef d.?equipe|chef equipe|responsable d.?equipe)' then return jsonb_build_object('population','chef_equipe','jobKey','chef_equipe','sectorKey','encadrement','sectorLabel','Chef d’équipe','scope','encadrement'); end if;
  if s ~ '(fixline|\mfix\M)' then return jsonb_build_object('population','fixline','jobKey','fixline','sectorKey','carrosserie','sectorLabel','Carrosserie / Fixline','scope','fixline'); end if;
  if s ~ '(acheteur|approvision)' then return jsonb_build_object('population','preprod','jobKey','acheteur','sectorKey','magasin','sectorLabel','Acheteur','scope','magasin'); end if;
  if s ~ '(assistante|assistant administratif|assistante administrative)' then return jsonb_build_object('population','preprod','jobKey','assistante','sectorKey','administratif','sectorLabel','Assistante','scope','administratif'); end if;
  if s ~ '(entretien|nettoyage)' then return jsonb_build_object('population','preprod','jobKey','entretien','sectorKey','autre','sectorLabel','Entretien','scope','autre'); end if;
  if s ~ '(expert.*dynam|dynam.*expert|\mdyn\M)' then return jsonb_build_object('population','preprod','jobKey','expert_dynamique','sectorKey','expertise','sectorLabel','Expert dynamique','scope','expertise'); end if;
  if s ~ '(facturation|facturier)' then return jsonb_build_object('population','preprod','jobKey','facturation','sectorKey','administratif','sectorLabel','Facturation','scope','administratif'); end if;
  if s ~ '(jockey.*ct|ct.*jockey)' then return jsonb_build_object('population','preprod','jobKey','jockey_ct','sectorKey','jockey','sectorLabel','Jockey CT','scope','jockey'); end if;
  if s ~ '(jockey)' then return jsonb_build_object('population','preprod','jobKey','jockey','sectorKey','jockey','sectorLabel','Jockey','scope','jockey'); end if;
  if s ~ '(magasin|magasinier)' then return jsonb_build_object('population','preprod','jobKey','magasin','sectorKey','magasin','sectorLabel','Magasin','scope','magasin'); end if;
  if s ~ '(^|[^a-z])(rh|ressources humaines)([^a-z]|$)' then return jsonb_build_object('population','preprod','jobKey','rh','sectorKey','administratif','sectorLabel','RH','scope','administratif'); end if;
  if s ~ '(apprenti|alternant)' then return jsonb_build_object('population','productif','jobKey','apprenti','sectorKey','autre','sectorLabel','Apprenti','scope','autre'); end if;
  if s ~ '(box|peintre|peinture)' then return jsonb_build_object('population','productif','jobKey','box','sectorKey','carrosserie','sectorLabel','BOX / Peinture','scope','box'); end if;
  if s ~ '(dsp|deboss|déboss)' then return jsonb_build_object('population','productif','jobKey','dsp','sectorKey','dsp','sectorLabel','DSP','scope','dsp'); end if;
  if s ~ '(expertise|expert )' then return jsonb_build_object('population','productif','jobKey','expertise','sectorKey','expertise','sectorLabel','Expertise','scope','expertise'); end if;
  if s ~ '(jante)' then return jsonb_build_object('population','productif','jobKey','jante','sectorKey','jantes','sectorLabel','Jantes','scope','jantes'); end if;
  if s ~ '(lavage|laveur)' then return jsonb_build_object('population','productif','jobKey','lavage','sectorKey','lavage','sectorLabel','Lavage','scope','lavage'); end if;
  if s ~ '(mecan|mécan|\mmec\M)' then return jsonb_build_object('population','productif','jobKey','mecanique','sectorKey','mecanique','sectorLabel','Mécanique','scope','mecanique'); end if;
  if s ~ '(photo|photographe)' then return jsonb_build_object('population','productif','jobKey','photo','sectorKey','photo','sectorLabel','Photo','scope','photo'); end if;
  if s ~ '(prepar|prépar|\mpre\M)' then return jsonb_build_object('population','productif','jobKey','preparation','sectorKey','preparation','sectorLabel','Préparation','scope','preparation'); end if;
  if s ~ '(qualit|qualité|\mqua\M|\moqf\M)' then return jsonb_build_object('population','productif','jobKey','qualite','sectorKey','qualite','sectorLabel','Qualité','scope','qualite'); end if;
  if s ~ '(toler|tôler|tolier|tôlier|carrossier|\mtol\M)' then return jsonb_build_object('population','productif','jobKey','tolerie','sectorKey','carrosserie','sectorLabel','Tôlerie','scope','tolerie'); end if;
  if s ~ '(diagnostic|transverse|\mtra\M)' then return jsonb_build_object('population','productif','jobKey','transverse','sectorKey','diagnostic','sectorLabel','Transverse','scope','diagnostic'); end if;
  return '{}'::jsonb;
end $$;

create or replace function public.kpi_payroll_staff_import(p_session_hash text,p_source_filename text,p_source_sha256 text,p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_user record; v_run uuid; r jsonb; v_mat text; v_first text; v_last text; v_full text; v_name_key text; v_employee_key text; v_service text; v_team text; v_job text; v_entry date; v_exit date; v_status text; v_active boolean; v_map jsonb; v_population text; v_job_key text; v_sector_key text; v_sector_label text; v_scope text; v_cfg_id uuid; v_cfg_count integer; v_prev public.kpi_staff_registry%rowtype; v_event text; v_active_count integer:=0; v_exit_count integer:=0; v_bonus_ok integer:=0; v_bonus_pending integer:=0; v_total integer:=0;
begin
  select * into v_user from public.kpi_data_rh_access(p_session_hash) limit 1;
  if v_user is null then raise exception 'Droit Data RH requis.' using errcode='42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'Aucun collaborateur à importer.'; end if;
  if jsonb_array_length(p_rows)>2000 then raise exception 'Import limité à 2000 collaborateurs par fichier.'; end if;
  insert into public.kpi_staff_import_runs(filename,file_sha256,imported_by,total_rows) values(coalesce(nullif(btrim(p_source_filename),''),'Import paie'),nullif(btrim(p_source_sha256),''),v_user.user_id,jsonb_array_length(p_rows)) returning id into v_run;
  begin
    for r in select value from jsonb_array_elements(p_rows) loop
      v_total:=v_total+1; v_mat:=nullif(btrim(r->>'matricule'),''); v_first:=nullif(btrim(r->>'firstName'),''); v_last:=nullif(btrim(r->>'lastName'),''); v_full:=nullif(btrim(coalesce(r->>'fullName',concat_ws(' ',v_first,v_last))),'');
      if v_full is null then raise exception 'Ligne % : nom/prénom manquant.',v_total; end if;
      v_name_key:=public.kpi_normalize_person_name(v_full); if v_mat is not null then v_employee_key:='matricule:'||lower(v_mat); else v_employee_key:='nom:'||encode(extensions.digest(v_name_key,'sha256'),'hex'); end if;
      v_service:=nullif(btrim(r->>'service'),''); v_team:=upper(nullif(btrim(r->>'teamCode'),'')); if v_team not in ('A','B','C') then v_team:=null; end if; v_job:=nullif(btrim(r->>'jobTitle'),''); v_entry:=nullif(r->>'entryDate','')::date; v_exit:=nullif(r->>'exitDate','')::date; v_status:=lower(coalesce(nullif(btrim(r->>'status'),''),'active'));
      v_active:=not (v_status ~ '(sorti|sortie|quitte|quitté|inactif|inactive|terminated|exit|radié|radie)' or (v_exit is not null and v_exit<=current_date));
      select * into v_prev from public.kpi_staff_registry where employee_key=v_employee_key;
      if v_active then v_event:=case when v_prev.employee_key is null then 'entry' when not coalesce(v_prev.active,false) then 'reactivation' else 'update' end; else v_event:='exit'; end if;
      insert into public.kpi_staff_registry(employee_key,matricule,first_name,last_name,full_name,name_key,service,team_code,job_title,entry_date,exit_date,employment_status,active,source_filename,source_sha256,source_imported_at,metadata)
      values(v_employee_key,v_mat,v_first,v_last,v_full,v_name_key,v_service,v_team,v_job,v_entry,v_exit,case when v_active then 'active' else 'exited' end,v_active,p_source_filename,p_source_sha256,now(),jsonb_build_object('source','payroll_import','lastImportRun',v_run))
      on conflict(employee_key) do update set matricule=coalesce(excluded.matricule,kpi_staff_registry.matricule),first_name=coalesce(excluded.first_name,kpi_staff_registry.first_name),last_name=coalesce(excluded.last_name,kpi_staff_registry.last_name),full_name=excluded.full_name,name_key=excluded.name_key,service=coalesce(excluded.service,kpi_staff_registry.service),team_code=coalesce(excluded.team_code,kpi_staff_registry.team_code),job_title=coalesce(excluded.job_title,kpi_staff_registry.job_title),entry_date=coalesce(excluded.entry_date,kpi_staff_registry.entry_date),exit_date=excluded.exit_date,employment_status=excluded.employment_status,active=excluded.active,source_filename=excluded.source_filename,source_sha256=excluded.source_sha256,source_imported_at=excluded.source_imported_at,metadata=kpi_staff_registry.metadata||excluded.metadata;
      if v_mat is not null then update public.kpi_rh_staff_dimension set active=false,employment_status='exited',exit_date=coalesce(exit_date,current_date),source_updated_at=now() where matricule=v_mat and employee_key<>v_employee_key and name_key<>v_name_key; end if;
      insert into public.kpi_rh_staff_dimension(employee_key,matricule,first_name,last_name,full_name,name_key,service,team_code,source_filename,source_updated_at,metadata,active,entry_date,exit_date,job_title,employment_status)
      values(v_employee_key,v_mat,v_first,v_last,v_full,v_name_key,v_service,v_team,p_source_filename,now(),jsonb_build_object('source','payroll_import','source_file_sha256',p_source_sha256,'source_import_run',v_run),v_active,v_entry,v_exit,v_job,case when v_active then 'active' else 'exited' end)
      on conflict(employee_key) do update set matricule=coalesce(excluded.matricule,kpi_rh_staff_dimension.matricule),first_name=coalesce(excluded.first_name,kpi_rh_staff_dimension.first_name),last_name=coalesce(excluded.last_name,kpi_rh_staff_dimension.last_name),full_name=excluded.full_name,name_key=excluded.name_key,service=coalesce(excluded.service,kpi_rh_staff_dimension.service),team_code=coalesce(excluded.team_code,kpi_rh_staff_dimension.team_code),source_filename=excluded.source_filename,source_updated_at=excluded.source_updated_at,metadata=kpi_rh_staff_dimension.metadata||excluded.metadata,active=excluded.active,entry_date=coalesce(excluded.entry_date,kpi_rh_staff_dimension.entry_date),exit_date=excluded.exit_date,job_title=coalesce(excluded.job_title,kpi_rh_staff_dimension.job_title),employment_status=excluded.employment_status;
      if v_prev.name_key is not null and v_prev.name_key<>v_name_key then update public.kpi_productivity_team_assignment set active=false,updated_at=now() where name_key=v_prev.name_key; update public.kpi_bodyshop_staff_map set active=false,updated_at=now() where mechanic_key=v_prev.name_key or public.kpi_normalize_person_name(public.kpi_rh_base_name(mechanic_name))=v_prev.name_key; end if;
      if not v_active then
        v_exit_count:=v_exit_count+1; update public.kpi_productivity_team_assignment set active=false,updated_at=now() where name_key=v_name_key; update public.kpi_bodyshop_staff_map set active=false,updated_at=now() where mechanic_key=v_name_key or public.kpi_normalize_person_name(public.kpi_rh_base_name(mechanic_name))=v_name_key;
        update public.kpi_bonus_employee_config set active=false,metadata=metadata||jsonb_build_object('employmentStatus','exited','exitDate',v_exit,'source','payroll_import','sourceImportRun',v_run),updated_at=now() where name_key=v_name_key or (v_mat is not null and matricule=v_mat and name_key=v_name_key);
      else
        v_active_count:=v_active_count+1; v_map:=public.kpi_staff_assignment_map(v_service,v_job); v_population:=nullif(v_map->>'population',''); v_job_key:=nullif(v_map->>'jobKey',''); v_sector_key:=nullif(v_map->>'sectorKey',''); v_sector_label:=nullif(v_map->>'sectorLabel',''); v_scope:=nullif(v_map->>'scope','');
        if v_team is not null and v_scope is not null and v_population in ('productif','fixline') then insert into public.kpi_productivity_team_assignment(name_key,mechanic_name,team_code,scope,role_label,active,updated_at) values(v_name_key,v_full,v_team,v_scope,v_job,true,now()) on conflict(name_key) do update set mechanic_name=excluded.mechanic_name,team_code=excluded.team_code,scope=excluded.scope,role_label=excluded.role_label,active=true,updated_at=now(); end if;
        v_cfg_id:=null; v_cfg_count:=0; select id into v_cfg_id from public.kpi_bonus_employee_config where name_key=v_name_key and (v_mat is null or matricule=v_mat) order by active desc,updated_at desc limit 1;
        if v_cfg_id is null and v_mat is not null then select count(*) into v_cfg_count from public.kpi_bonus_employee_config where matricule=v_mat; if v_cfg_count=1 then select id into v_cfg_id from public.kpi_bonus_employee_config where matricule=v_mat limit 1; end if; end if;
        if v_job_key is not null and v_population is not null then
          if v_cfg_id is not null then update public.kpi_bonus_employee_config set matricule=coalesce(v_mat,matricule),source_name='Paie RH',employee_name=v_full,name_key=v_name_key,population=v_population,job_key=v_job_key,sector_key=v_sector_key,sector_label=v_sector_label,team_code=coalesce(v_team,team_code),active=true,source_reference=p_source_filename,metadata=metadata||jsonb_build_object('employmentStatus','active','entryDate',v_entry,'jobTitle',v_job,'source','payroll_import','sourceImportRun',v_run,'needsPayplanConfig',false),updated_at=now() where id=v_cfg_id;
          else insert into public.kpi_bonus_employee_config(source_component_key,matricule,source_name,employee_name,name_key,population,job_key,sector_key,sector_label,team_code,active,source_reference,metadata) values('payroll:'||replace(v_employee_key,':','_'),v_mat,'Paie RH',v_full,v_name_key,v_population,v_job_key,v_sector_key,v_sector_label,v_team,true,p_source_filename,jsonb_build_object('employmentStatus','active','entryDate',v_entry,'jobTitle',v_job,'source','payroll_import','sourceImportRun',v_run,'needsPayplanConfig',false)) on conflict(source_component_key) do update set matricule=excluded.matricule,employee_name=excluded.employee_name,name_key=excluded.name_key,population=excluded.population,job_key=excluded.job_key,sector_key=excluded.sector_key,sector_label=excluded.sector_label,team_code=excluded.team_code,active=true,source_reference=excluded.source_reference,metadata=kpi_bonus_employee_config.metadata||excluded.metadata,updated_at=now(); end if;
          v_bonus_ok:=v_bonus_ok+1;
        else
          if v_cfg_id is null then insert into public.kpi_bonus_employee_config(source_component_key,matricule,source_name,employee_name,name_key,population,job_key,sector_key,sector_label,team_code,active,source_reference,metadata) values('payroll:'||replace(v_employee_key,':','_'),v_mat,'Paie RH',v_full,v_name_key,'pending','pending','autre','À paramétrer',v_team,false,p_source_filename,jsonb_build_object('employmentStatus','active','entryDate',v_entry,'jobTitle',v_job,'service',v_service,'source','payroll_import','sourceImportRun',v_run,'needsPayplanConfig',true)) on conflict(source_component_key) do update set matricule=excluded.matricule,employee_name=excluded.employee_name,name_key=excluded.name_key,team_code=excluded.team_code,active=false,source_reference=excluded.source_reference,metadata=kpi_bonus_employee_config.metadata||excluded.metadata,updated_at=now(); else update public.kpi_bonus_employee_config set employee_name=v_full,name_key=v_name_key,team_code=coalesce(v_team,team_code),active=false,metadata=metadata||jsonb_build_object('employmentStatus','active','jobTitle',v_job,'service',v_service,'source','payroll_import','sourceImportRun',v_run,'needsPayplanConfig',true),updated_at=now() where id=v_cfg_id; end if;
          v_bonus_pending:=v_bonus_pending+1; v_event:='pending_configuration';
        end if;
      end if;
      insert into public.kpi_staff_events(import_run_id,employee_key,matricule,full_name,event_type,effective_date,actor_id,payload) values(v_run,v_employee_key,v_mat,v_full,v_event,coalesce(v_exit,v_entry,current_date),v_user.user_id,jsonb_build_object('service',v_service,'teamCode',v_team,'jobTitle',v_job,'active',v_active,'bonusMapped',v_job_key is not null));
    end loop;
    update public.kpi_staff_import_runs set completed_at=now(),status='success',active_rows=v_active_count,exit_rows=v_exit_count,configured_bonus_rows=v_bonus_ok,pending_bonus_rows=v_bonus_pending,metadata=jsonb_build_object('source','payroll_import','historyPreserved',true,'physicalDelete',false) where id=v_run;
    return jsonb_build_object('ok',true,'runId',v_run,'rows',v_total,'active',v_active_count,'exits',v_exit_count,'bonusConfigured',v_bonus_ok,'bonusPending',v_bonus_pending,'historyPreserved',true);
  exception when others then update public.kpi_staff_import_runs set completed_at=now(),status='failed',error_message=sqlerrm where id=v_run; return jsonb_build_object('ok',false,'runId',v_run,'error',sqlerrm); end;
end $$;

create or replace view public.kpi_bodyshop_staff_effective as
with manual as (
  select 'manual:'::text||m.id::text id,public.kpi_rh_base_name(m.mechanic_name) mechanic_name,public.kpi_normalize_person_name(public.kpi_rh_base_name(m.mechanic_name)) name_key,m.team_code,m.workcenter,null::text matricule,null::text service,'manual'::text mapping_source,m.active
  from public.kpi_bodyshop_staff_map m where m.active
), auto_staff as (
  select distinct on(d.name_key) 'rh:'::text||d.employee_key id,d.full_name mechanic_name,d.name_key,d.team_code,case upper(coalesce(d.service,'')) when 'FIX' then 'mixed' when 'BOX' then 'box' when 'TOL' then 'heavy' else 'mixed' end workcenter,d.matricule,d.service,'rh_import'::text mapping_source,true active
  from public.kpi_rh_staff_dimension d
  where d.active and d.team_code in('A','B','C') and (upper(coalesce(d.service,'')) in('FIX','BOX','TOL') or coalesce(d.service,'') ~* '(carross|t[oô]ler|body|fixline)')
  order by d.name_key,d.source_updated_at desc
)
select * from manual
union all
select a.* from auto_staff a where not exists(select 1 from manual m where m.name_key=a.name_key);

alter table public.kpi_staff_registry enable row level security;
alter table public.kpi_staff_import_runs enable row level security;
alter table public.kpi_staff_events enable row level security;
revoke all on public.kpi_staff_registry from anon,authenticated;
revoke all on public.kpi_staff_import_runs from anon,authenticated;
revoke all on public.kpi_staff_events from anon,authenticated;
revoke all on function public.kpi_payroll_staff_import(text,text,text,jsonb) from public;
grant execute on function public.kpi_payroll_staff_import(text,text,text,jsonb) to anon,authenticated;
