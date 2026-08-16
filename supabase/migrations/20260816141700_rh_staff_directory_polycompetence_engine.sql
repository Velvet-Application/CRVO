alter table public.kpi_staff_registry
  add column if not exists primary_population text,
  add column if not exists primary_job_key text,
  add column if not exists primary_sector_key text,
  add column if not exists primary_sector_label text,
  add column if not exists primary_scope text;

create table if not exists public.kpi_skill_catalog (
  skill_key text primary key,
  label text not null,
  sector_key text not null,
  sector_label text not null,
  workcenter_keys text[] not null default array[]::text[],
  productive boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.kpi_skill_catalog(skill_key,label,sector_key,sector_label,workcenter_keys,productive)
values
 ('mecanique','Mécanique','mecanique','Mécanique',array['mecanique'],true),
 ('expertise','Expertise','expertise','Expertise',array['expertise'],true),
 ('jantes','Jantes','jantes','Jantes',array['jantes'],true),
 ('dsp','DSP','dsp','DSP',array['dsp'],true),
 ('preparation','Préparation','preparation','Préparation',array['preparation'],true),
 ('qualite','Qualité','qualite','Qualité',array['qualite'],true),
 ('photo','Photo','photo','Photo',array['photo'],true),
 ('lavage','Lavage','lavage','Lavage',array['lavage'],true),
 ('diagnostic','Diagnostic / transverse','diagnostic','Diagnostic',array['diagnostic'],true),
 ('fixline','Fixline','carrosserie','Carrosserie',array['fixline'],true),
 ('box','Box / peinture','carrosserie','Carrosserie',array['box'],true),
 ('tolerie','Tôlerie','carrosserie','Carrosserie',array['tolerie','carrosserie'],true)
on conflict(skill_key) do update set label=excluded.label,sector_key=excluded.sector_key,sector_label=excluded.sector_label,workcenter_keys=excluded.workcenter_keys,productive=excluded.productive,active=true,updated_at=now();

create table if not exists public.kpi_staff_competencies (
  employee_key text not null references public.kpi_staff_registry(employee_key) on delete restrict,
  skill_key text not null references public.kpi_skill_catalog(skill_key) on delete restrict,
  status text not null default 'active' check(status in ('active','training','inactive')),
  validated_at date,
  valid_from date,
  valid_until date,
  source text not null default 'manual_rh',
  note text,
  created_by uuid references public.crvo_auth_users(id) on delete set null,
  updated_by uuid references public.crvo_auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key(employee_key,skill_key)
);

create table if not exists public.kpi_staff_competency_events (
  id bigserial primary key,
  employee_key text not null,
  skill_key text not null,
  event_type text not null,
  actor_id uuid references public.crvo_auth_users(id) on delete set null,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index if not exists kpi_staff_competencies_skill_status_idx on public.kpi_staff_competencies(skill_key,status);
create index if not exists kpi_staff_competency_events_employee_idx on public.kpi_staff_competency_events(employee_key,created_at desc);
create index if not exists kpi_staff_registry_active_primary_idx on public.kpi_staff_registry(active,primary_sector_key,primary_job_key);

alter table public.kpi_skill_catalog enable row level security;
alter table public.kpi_staff_competencies enable row level security;
alter table public.kpi_staff_competency_events enable row level security;
revoke all on public.kpi_skill_catalog from public,anon,authenticated;
revoke all on public.kpi_staff_competencies from public,anon,authenticated;
revoke all on public.kpi_staff_competency_events from public,anon,authenticated;
revoke all on sequence public.kpi_staff_competency_events_id_seq from public,anon,authenticated;

create or replace function public.kpi_staff_registry_derive_primary()
returns trigger language plpgsql security definer set search_path=public as $$
declare m jsonb;
begin
  m:=public.kpi_staff_assignment_map(new.service,new.job_title);
  if nullif(m->>'jobKey','') is not null then
    new.primary_population:=m->>'population'; new.primary_job_key:=m->>'jobKey'; new.primary_sector_key:=m->>'sectorKey'; new.primary_sector_label:=m->>'sectorLabel'; new.primary_scope:=m->>'scope';
  elsif tg_op='INSERT' then
    new.primary_population:=null; new.primary_job_key:=null; new.primary_sector_key:=null; new.primary_sector_label:=null; new.primary_scope:=null;
  end if;
  return new;
end $$;

drop trigger if exists trg_kpi_staff_registry_derive_primary on public.kpi_staff_registry;
create trigger trg_kpi_staff_registry_derive_primary before insert or update of service,job_title on public.kpi_staff_registry for each row execute function public.kpi_staff_registry_derive_primary();
update public.kpi_staff_registry set service=service;

with ranked as (
  select r.employee_key,c.population,c.job_key,c.sector_key,c.sector_label,row_number() over(partition by r.employee_key order by c.active desc,c.updated_at desc) rn
  from public.kpi_staff_registry r join public.kpi_bonus_employee_config c on c.active and ((r.matricule is not null and c.matricule=r.matricule and c.name_key=r.name_key) or c.name_key=r.name_key)
  where r.primary_job_key is null and c.population<>'pending' and c.job_key<>'pending'
)
update public.kpi_staff_registry r set primary_population=x.population,primary_job_key=x.job_key,primary_sector_key=x.sector_key,primary_sector_label=x.sector_label,primary_scope=case when x.population='fixline' then 'fixline' else x.sector_key end from ranked x where x.rn=1 and x.employee_key=r.employee_key;

create or replace view public.kpi_staff_skill_usage with (security_invoker=true) as
with resolved as (
  select b.*,r.employee_key from public.kpi_billed_time_facts b join lateral (
    select rr.employee_key from public.kpi_staff_registry rr
    where rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))
       or (nullif(btrim(b.matricule),'') is not null and rr.matricule=btrim(b.matricule) and (select count(*) from public.kpi_staff_registry rx where rx.matricule=btrim(b.matricule))=1)
    order by (rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))) desc,rr.active desc,rr.source_imported_at desc limit 1
  ) r on true where b.source_name='Direct Temps pointé facturé'
), mapped as (
  select r.employee_key,c.skill_key,coalesce(r.work_date,r.invoice_date) usage_date,r.labor_hours,r.work_order from resolved r join public.kpi_skill_catalog c on c.active and r.workcenter_key=any(c.workcenter_keys) where coalesce(r.work_date,r.invoice_date) is not null
)
select employee_key,skill_key,max(usage_date) last_used_date,round(sum(labor_hours),2) total_hours,round(sum(labor_hours) filter(where usage_date>=current_date-90),2) hours_90d,count(distinct work_order) filter(where usage_date>=current_date-90) jobs_90d,count(distinct usage_date) filter(where usage_date>=current_date-90) days_90d from mapped group by employee_key,skill_key;
revoke all on public.kpi_staff_skill_usage from public,anon,authenticated;

create or replace function public.kpi_rh_staff_directory(p_session_hash text,p_month date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; v_start date:=date_trunc('month',coalesce(p_month,current_date))::date; v_end date:=(date_trunc('month',coalesce(p_month,current_date))+interval '1 month')::date; v_presence_through date; v_billed_through date; v_payroll_at timestamptz; v_result jsonb;
begin
  select * into a from public.kpi_data_rh_access(p_session_hash) limit 1; if a is null then raise exception 'Droit Data RH requis.' using errcode='42501'; end if;
  select max(work_date) into v_presence_through from public.kpi_sql_presence_facts where source_name='Direct Data RH';
  select max(coalesce(work_date,invoice_date)) into v_billed_through from public.kpi_billed_time_facts where source_name='Direct Temps pointé facturé';
  select max(source_imported_at) into v_payroll_at from public.kpi_staff_registry where metadata->>'source'='payroll_import';
  with presence as (
    select r.employee_key,sum(p.time_value) bought from public.kpi_staff_registry r join public.kpi_sql_presence_facts p on public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))=r.name_key join public.kpi_rh_presence_code_map m on m.time_code=p.time_code and m.counts_as_presence and not m.excluded where p.work_date>=v_start and p.work_date<v_end group by r.employee_key
  ), billed_resolved as (
    select b.labor_hours,b.work_order,coalesce(b.work_date,b.invoice_date) work_date,r.employee_key from public.kpi_billed_time_facts b join lateral (
      select rr.employee_key from public.kpi_staff_registry rr where rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) or (nullif(btrim(b.matricule),'') is not null and rr.matricule=btrim(b.matricule) and (select count(*) from public.kpi_staff_registry rx where rx.matricule=btrim(b.matricule))=1) order by (rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))) desc,rr.active desc,rr.source_imported_at desc limit 1
    ) r on true where b.source_name='Direct Temps pointé facturé' and coalesce(b.work_date,b.invoice_date)>=v_start and coalesce(b.work_date,b.invoice_date)<v_end
  ), billed as (select employee_key,sum(labor_hours) sold,count(distinct work_order) jobs from billed_resolved group by employee_key), rows as (
    select r.*,p.bought,b.sold,b.jobs,case when r.primary_population='productif' and p.bought>0 and b.sold is not null then round(b.sold/p.bought*100,1) else null end productivity,case when r.primary_population='productif' then 'individual' when r.primary_population='fixline' then 'team_only' else 'not_applicable' end productivity_mode,
      coalesce((select jsonb_agg(jsonb_build_object('skillKey',c.skill_key,'label',sc.label,'sectorKey',sc.sector_key,'sectorLabel',sc.sector_label,'status',c.status,'validatedAt',c.validated_at,'validFrom',c.valid_from,'validUntil',c.valid_until,'note',c.note,'lastUsedDate',u.last_used_date,'hours90d',coalesce(u.hours_90d,0),'jobs90d',coalesce(u.jobs_90d,0),'days90d',coalesce(u.days_90d,0)) order by sc.label) from public.kpi_staff_competencies c join public.kpi_skill_catalog sc on sc.skill_key=c.skill_key left join public.kpi_staff_skill_usage u on u.employee_key=c.employee_key and u.skill_key=c.skill_key where c.employee_key=r.employee_key and c.status<>'inactive'),'[]'::jsonb) competencies,
      coalesce((select jsonb_agg(jsonb_build_object('skillKey',sc.skill_key,'label',sc.label,'sectorKey',sc.sector_key,'sectorLabel',sc.sector_label,'lastUsedDate',u.last_used_date,'hours90d',coalesce(u.hours_90d,0),'jobs90d',coalesce(u.jobs_90d,0),'days90d',coalesce(u.days_90d,0)) order by u.last_used_date desc,sc.label) from public.kpi_staff_skill_usage u join public.kpi_skill_catalog sc on sc.skill_key=u.skill_key where u.employee_key=r.employee_key and u.skill_key is distinct from r.primary_job_key and not exists(select 1 from public.kpi_staff_competencies c where c.employee_key=r.employee_key and c.skill_key=u.skill_key and c.status<>'inactive')),'[]'::jsonb) observed_skills,
      (select max(u.last_used_date) from public.kpi_staff_competencies c join public.kpi_staff_skill_usage u on u.employee_key=c.employee_key and u.skill_key=c.skill_key where c.employee_key=r.employee_key and c.status='active') last_poly_use
    from public.kpi_staff_registry r left join presence p on p.employee_key=r.employee_key left join billed b on b.employee_key=r.employee_key
  )
  select jsonb_build_object('month',to_char(v_start,'YYYY-MM'),'coverage',jsonb_build_object('presenceThrough',v_presence_through,'billedThrough',v_billed_through,'payrollImportedAt',v_payroll_at),'counts',jsonb_build_object('total',(select count(*) from rows),'active',(select count(*) from rows where active),'exited',(select count(*) from rows where not active),'polycompetent',(select count(*) from rows where jsonb_array_length(competencies)>0),'observedUnconfirmed',(select count(*) from rows where jsonb_array_length(observed_skills)>0),'missingEntryDate',(select count(*) from rows where active and entry_date is null),'missingPrimaryJob',(select count(*) from rows where active and primary_job_key is null)),'availableMonths',coalesce((select jsonb_agg(m order by m desc) from (select distinct to_char(date_trunc('month',d),'YYYY-MM') m from (select work_date d from public.kpi_sql_presence_facts where work_date is not null union all select coalesce(work_date,invoice_date) d from public.kpi_billed_time_facts where coalesce(work_date,invoice_date) is not null) z) q),'[]'::jsonb),'skills',coalesce((select jsonb_agg(jsonb_build_object('skillKey',skill_key,'label',label,'sectorKey',sector_key,'sectorLabel',sector_label) order by sector_label,label) from public.kpi_skill_catalog where active),'[]'::jsonb),'staff',coalesce((select jsonb_agg(jsonb_build_object('employeeKey',employee_key,'matricule',matricule,'firstName',first_name,'lastName',last_name,'fullName',full_name,'service',service,'teamCode',team_code,'jobTitle',job_title,'entryDate',entry_date,'exitDate',exit_date,'employmentStatus',employment_status,'active',active,'primaryPopulation',primary_population,'primaryJobKey',primary_job_key,'primarySectorKey',primary_sector_key,'primarySectorLabel',primary_sector_label,'boughtHours',bought,'soldHours',sold,'productivity',productivity,'productivityMode',productivity_mode,'jobs',coalesce(jobs,0),'competencies',competencies,'observedSkills',observed_skills,'lastPolyUse',last_poly_use,'sourceFilename',source_filename,'sourceImportedAt',source_imported_at) order by active desc,full_name) from rows),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

create or replace function public.kpi_rh_set_competency(p_session_hash text,p_employee_key text,p_skill_key text,p_status text default 'active',p_validated_at date default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record; v_actor uuid; r public.kpi_staff_registry%rowtype; s public.kpi_skill_catalog%rowtype; v_status text:=lower(coalesce(nullif(btrim(p_status),''),'active'));
begin
  select * into a from public.kpi_data_rh_access(p_session_hash) limit 1; if a is null then raise exception 'Droit Data RH requis.' using errcode='42501'; end if;
  select id into v_actor from public.crvo_auth_users where username=a.username limit 1;
  select * into r from public.kpi_staff_registry where employee_key=p_employee_key; if r.employee_key is null then raise exception 'Collaborateur introuvable.'; end if;
  select * into s from public.kpi_skill_catalog where skill_key=p_skill_key and active; if s.skill_key is null then raise exception 'Compétence inconnue.'; end if;
  if v_status not in ('active','training','inactive') then raise exception 'Statut de compétence invalide.'; end if;
  if v_status='active' and r.primary_job_key=s.skill_key then raise exception 'Le métier principal ne doit pas être enregistré comme polycompétence.'; end if;
  insert into public.kpi_staff_competencies(employee_key,skill_key,status,validated_at,valid_from,source,note,created_by,updated_by,metadata)
  values(r.employee_key,s.skill_key,v_status,case when v_status='active' then coalesce(p_validated_at,current_date) else p_validated_at end,case when v_status='active' then current_date else null end,'manual_rh',nullif(btrim(p_note),''),v_actor,v_actor,jsonb_build_object('updatedBy',a.display_name))
  on conflict(employee_key,skill_key) do update set status=excluded.status,validated_at=coalesce(excluded.validated_at,kpi_staff_competencies.validated_at),valid_from=case when excluded.status='active' then coalesce(kpi_staff_competencies.valid_from,current_date) else kpi_staff_competencies.valid_from end,valid_until=case when excluded.status='inactive' then current_date else null end,note=excluded.note,updated_by=excluded.updated_by,updated_at=now(),metadata=kpi_staff_competencies.metadata||excluded.metadata;
  insert into public.kpi_staff_competency_events(employee_key,skill_key,event_type,actor_id,payload) values(r.employee_key,s.skill_key,case when v_status='inactive' then 'disabled' when v_status='training' then 'training' else 'enabled' end,v_actor,jsonb_build_object('status',v_status,'validatedAt',p_validated_at,'note',nullif(btrim(p_note),''),'actor',a.display_name));
  return jsonb_build_object('ok',true,'employeeKey',r.employee_key,'skillKey',s.skill_key,'status',v_status);
end $$;

create or replace function public.kpi_polycompetence_suggestions(p_session_hash text,p_month date default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c record; v_start date:=date_trunc('month',coalesce(p_month,current_date))::date; v_end date:=(date_trunc('month',coalesce(p_month,current_date))+interval '1 month')::date; v_billed_through date; v_snapshot date; v_result jsonb;
begin
  select * into c from public.crvo_auth_context_v2(p_session_hash) where ok limit 1; if c is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if not (c.role='admin' or '*'=any(coalesce(c.page_permissions,array[]::text[])) or 'productivity'=any(coalesce(c.page_permissions,array[]::text[]))) then raise exception 'Droit Productivité requis.' using errcode='42501'; end if;
  select max(coalesce(work_date,invoice_date)) into v_billed_through from public.kpi_billed_time_facts where source_name='Direct Temps pointé facturé'; select max(snapshot_date) into v_snapshot from public.kpi_bottleneck_live_public;
  with presence as (
    select r.employee_key,sum(p.time_value) bought from public.kpi_staff_registry r join public.kpi_sql_presence_facts p on public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))=r.name_key join public.kpi_rh_presence_code_map m on m.time_code=p.time_code and m.counts_as_presence and not m.excluded where p.work_date>=v_start and p.work_date<v_end group by r.employee_key
  ), billed_resolved as (
    select b.labor_hours,r.employee_key from public.kpi_billed_time_facts b join lateral (
      select rr.employee_key from public.kpi_staff_registry rr where rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) or (nullif(btrim(b.matricule),'') is not null and rr.matricule=btrim(b.matricule) and (select count(*) from public.kpi_staff_registry rx where rx.matricule=btrim(b.matricule))=1) order by (rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))) desc,rr.active desc,rr.source_imported_at desc limit 1
    ) r on true where b.source_name='Direct Temps pointé facturé' and coalesce(b.work_date,b.invoice_date)>=v_start and coalesce(b.work_date,b.invoice_date)<v_end
  ), billed as (select employee_key,sum(labor_hours) sold from billed_resolved group by employee_key), backlog as (select * from public.kpi_bottleneck_live_public where snapshot_date=v_snapshot), candidates as (
    select r.employee_key,r.full_name,r.team_code,r.primary_job_key,r.primary_sector_key,r.primary_sector_label,r.primary_population,sc.skill_key,sc.label skill_label,sc.sector_key target_sector_key,sc.sector_label target_sector_label,b.vehicle_count,b.source_modified_at,u.last_used_date,coalesce(u.hours_90d,0) hours_90d,coalesce(u.jobs_90d,0) jobs_90d,p.bought,bd.sold,case when r.primary_population='productif' and p.bought>0 and bd.sold is not null then round(bd.sold/p.bought*100,1) else null end productivity,case when u.last_used_date>=current_date-90 then 'ready' when u.last_used_date>=current_date-180 then 'watch' else 'revalidate' end readiness,case when u.last_used_date>=current_date-90 then 3 when u.last_used_date>=current_date-180 then 2 when u.last_used_date is not null then 1 else 0 end recency_score
    from public.kpi_staff_competencies pc join public.kpi_staff_registry r on r.employee_key=pc.employee_key and r.active join public.kpi_skill_catalog sc on sc.skill_key=pc.skill_key and sc.active join backlog b on b.sector_key=sc.sector_key left join public.kpi_staff_skill_usage u on u.employee_key=r.employee_key and u.skill_key=sc.skill_key left join presence p on p.employee_key=r.employee_key left join billed bd on bd.employee_key=r.employee_key
    where pc.status='active' and r.primary_job_key is distinct from sc.skill_key and (c.role='admin' or '*'=any(coalesce(c.productivity_scopes,array[]::text[])) or sc.sector_key=any(coalesce(c.productivity_scopes,array[]::text[]))) and (c.access_profile<>'team_manager' or '*'=any(coalesce(c.team_scopes,array[]::text[])) or r.team_code=any(coalesce(c.team_scopes,array[]::text[])))
  )
  select jsonb_build_object('month',to_char(v_start,'YYYY-MM'),'coverage',jsonb_build_object('billedThrough',v_billed_through,'bottleneckSnapshot',v_snapshot),'suggestions',coalesce((select jsonb_agg(jsonb_build_object('employeeKey',employee_key,'fullName',full_name,'teamCode',team_code,'primaryJobKey',primary_job_key,'primarySectorKey',primary_sector_key,'primarySectorLabel',primary_sector_label,'skillKey',skill_key,'skillLabel',skill_label,'targetSectorKey',target_sector_key,'targetSectorLabel',target_sector_label,'vehicleCount',vehicle_count,'sourceModifiedAt',source_modified_at,'lastUsedDate',last_used_date,'hours90d',hours_90d,'jobs90d',jobs_90d,'productivity',productivity,'readiness',readiness) order by vehicle_count desc,recency_score desc,productivity desc nulls last,full_name) from (select * from candidates order by vehicle_count desc,recency_score desc,productivity desc nulls last,full_name limit 12) q),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

revoke all on function public.kpi_rh_staff_directory(text,date) from public,anon,authenticated;
revoke all on function public.kpi_rh_set_competency(text,text,text,text,date,text) from public,anon,authenticated;
revoke all on function public.kpi_polycompetence_suggestions(text,date) from public,anon,authenticated;
grant execute on function public.kpi_rh_staff_directory(text,date) to anon,authenticated;
grant execute on function public.kpi_rh_set_competency(text,text,text,text,date,text) to anon,authenticated;
grant execute on function public.kpi_polycompetence_suggestions(text,date) to anon,authenticated;
