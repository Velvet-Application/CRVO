-- RH directory performance hardening.
-- Production symptom: kpi_rh_staff_directory could exceed the PostgREST statement timeout
-- because person-name normalization and skill-usage resolution were recomputed repeatedly.

alter table public.kpi_sql_presence_facts
  add column if not exists person_name_key text generated always as (
    public.kpi_normalize_person_name(public.kpi_rh_base_name(mechanic_name))
  ) stored;

alter table public.kpi_billed_time_facts
  add column if not exists person_name_key text generated always as (
    public.kpi_normalize_person_name(public.kpi_rh_base_name(mechanic_name))
  ) stored;

create index if not exists kpi_presence_person_date_code_idx
  on public.kpi_sql_presence_facts (person_name_key, work_date, time_code)
  include (time_value)
  where source_name='Direct Data RH';

create index if not exists kpi_billed_person_date_idx
  on public.kpi_billed_time_facts (person_name_key, (coalesce(work_date,invoice_date)))
  include (matricule,labor_hours,work_order)
  where source_name='Direct Temps pointé facturé';

create or replace view public.kpi_staff_skill_usage as
with staff_name_map as materialized (
  select distinct on (name_key) name_key,employee_key
  from public.kpi_staff_registry
  where nullif(name_key,'') is not null
  order by name_key,active desc,source_imported_at desc,employee_key
),
staff_matricule_map as materialized (
  select matricule,min(employee_key) employee_key
  from public.kpi_staff_registry
  where nullif(matricule,'') is not null
  group by matricule
  having count(*)=1
),
resolved as (
  select b.id,b.work_date,b.invoice_date,b.invoice_number,b.work_order,b.mechanic_name,b.time_code,b.time_description,
         b.labor_hours,b.source_file_sha256,b.source_row_number,b.metadata,b.imported_at,b.source_name,b.sector_key,b.sector_label,
         b.workcenter_key,b.team_code,b.matricule,b.intervention,
         coalesce(n.employee_key,m.employee_key) employee_key
  from public.kpi_billed_time_facts b
  left join staff_name_map n on n.name_key=b.person_name_key
  left join staff_matricule_map m on m.matricule=nullif(btrim(b.matricule),'')
  where b.source_name='Direct Temps pointé facturé'
    and coalesce(n.employee_key,m.employee_key) is not null
),
mapped as (
  select r.employee_key,c.skill_key,coalesce(r.work_date,r.invoice_date) usage_date,r.labor_hours,r.work_order
  from resolved r
  join public.kpi_skill_catalog c on c.active and (r.workcenter_key=any(c.workcenter_keys))
  where coalesce(r.work_date,r.invoice_date) is not null
)
select employee_key,skill_key,max(usage_date) last_used_date,
       round(sum(labor_hours),2) total_hours,
       round(sum(labor_hours) filter(where usage_date>=current_date-90),2) hours_90d,
       count(distinct work_order) filter(where usage_date>=current_date-90) jobs_90d,
       count(distinct usage_date) filter(where usage_date>=current_date-90) days_90d
from mapped
group by employee_key,skill_key;

create or replace function public.kpi_rh_staff_directory(p_session_hash text, p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  a record;
  v_start date:=date_trunc('month',coalesce(p_month,current_date))::date;
  v_end date:=(date_trunc('month',coalesce(p_month,current_date))+interval '1 month')::date;
  v_scope_start date:=least(date_trunc('month',coalesce(p_month,current_date))::date,current_date-89);
  v_presence_through date;
  v_billed_through date;
  v_payroll_at timestamptz;
  v_result jsonb;
begin
  select * into a from public.kpi_data_rh_access(p_session_hash) limit 1;
  if a is null then raise exception 'Droit Data RH requis.' using errcode='42501'; end if;

  select max(work_date) into v_presence_through
  from public.kpi_sql_presence_facts where source_name='Direct Data RH';
  select max(coalesce(work_date,invoice_date)) into v_billed_through
  from public.kpi_billed_time_facts where source_name='Direct Temps pointé facturé';
  select max(source_imported_at) into v_payroll_at
  from public.kpi_staff_registry where metadata->>'source'='payroll_import';

  with staff_base as materialized (
    select * from public.kpi_staff_effective
  ),
  staff_name_map as materialized (
    select distinct on (name_key) name_key,employee_key
    from staff_base
    where nullif(name_key,'') is not null
    order by name_key,active desc,source_imported_at desc,employee_key
  ),
  staff_matricule_map as materialized (
    select matricule,min(employee_key) employee_key
    from staff_base
    where nullif(matricule,'') is not null
    group by matricule
    having count(*)=1
  ),
  presence_resolved as materialized (
    select n.employee_key,p.work_date,p.time_code,p.time_value
    from public.kpi_sql_presence_facts p
    join staff_name_map n on n.name_key=p.person_name_key
    where p.source_name='Direct Data RH'
      and p.work_date>=v_scope_start
      and p.work_date<greatest(v_end,current_date+1)
  ),
  presence as (
    select pr.employee_key,sum(pr.time_value) bought
    from presence_resolved pr
    join public.kpi_rh_presence_code_map m
      on m.time_code=pr.time_code and m.counts_as_presence and not m.excluded
    where pr.work_date>=v_start and pr.work_date<v_end
    group by pr.employee_key
  ),
  billed_resolved as materialized (
    select b.labor_hours,b.work_order,coalesce(b.work_date,b.invoice_date) work_date,
           coalesce(n.employee_key,mu.employee_key) employee_key
    from public.kpi_billed_time_facts b
    left join staff_name_map n on n.name_key=b.person_name_key
    left join staff_matricule_map mu on mu.matricule=nullif(btrim(b.matricule),'')
    where b.source_name='Direct Temps pointé facturé'
      and coalesce(b.work_date,b.invoice_date)>=v_start
      and coalesce(b.work_date,b.invoice_date)<v_end
      and coalesce(n.employee_key,mu.employee_key) is not null
  ),
  billed as (
    select employee_key,sum(labor_hours) sold,count(distinct work_order) jobs
    from billed_resolved group by employee_key
  ),
  skill_bought_90 as materialized (
    select pr.employee_key,sc.skill_key,sum(pr.time_value)::numeric bought_hours_90d
    from presence_resolved pr
    join public.kpi_rh_presence_code_map m
      on m.time_code=pr.time_code and m.counts_as_presence and not m.excluded
    join public.kpi_skill_catalog sc
      on sc.active and sc.productive and sc.sector_key=m.sector_key
      and (coalesce(cardinality(sc.workcenter_keys),0)=0 or m.workcenter_key=any(sc.workcenter_keys))
    where pr.work_date between current_date-89 and current_date
    group by pr.employee_key,sc.skill_key
  ),
  skill_usage as materialized (
    select * from public.kpi_staff_skill_usage
  ),
  competencies_agg as materialized (
    select c.employee_key,
           jsonb_agg(jsonb_build_object(
             'skillKey',c.skill_key,'label',sc.label,'sectorKey',sc.sector_key,'sectorLabel',sc.sector_label,'status',c.status,
             'validatedAt',c.validated_at,'validFrom',c.valid_from,'validUntil',c.valid_until,'note',c.note,
             'lastUsedDate',u.last_used_date,'hours90d',coalesce(u.hours_90d,0),'jobs90d',coalesce(u.jobs_90d,0),'days90d',coalesce(u.days_90d,0),
             'soldHours90d',coalesce(u.hours_90d,0),'boughtHours90d',sb.bought_hours_90d,
             'productivity90d',case when sb.bought_hours_90d>0 and u.hours_90d is not null then round(u.hours_90d/sb.bought_hours_90d*100,1) else null end
           ) order by sc.label) competencies,
           max(u.last_used_date) filter(where c.status='active') last_poly_use
    from public.kpi_staff_competencies c
    join public.kpi_skill_catalog sc on sc.skill_key=c.skill_key
    left join skill_usage u on u.employee_key=c.employee_key and u.skill_key=c.skill_key
    left join skill_bought_90 sb on sb.employee_key=c.employee_key and sb.skill_key=c.skill_key
    where c.status<>'inactive'
    group by c.employee_key
  ),
  observed_agg as materialized (
    select u.employee_key,
           jsonb_agg(jsonb_build_object(
             'skillKey',sc.skill_key,'label',sc.label,'sectorKey',sc.sector_key,'sectorLabel',sc.sector_label,
             'lastUsedDate',u.last_used_date,'hours90d',coalesce(u.hours_90d,0),'jobs90d',coalesce(u.jobs_90d,0),'days90d',coalesce(u.days_90d,0),
             'soldHours90d',coalesce(u.hours_90d,0),'boughtHours90d',sb.bought_hours_90d,
             'productivity90d',case when sb.bought_hours_90d>0 and u.hours_90d is not null then round(u.hours_90d/sb.bought_hours_90d*100,1) else null end
           ) order by u.last_used_date desc,sc.label) observed_skills
    from skill_usage u
    join public.kpi_skill_catalog sc on sc.skill_key=u.skill_key
    join staff_base r on r.employee_key=u.employee_key
    left join skill_bought_90 sb on sb.employee_key=u.employee_key and sb.skill_key=u.skill_key
    where u.skill_key is distinct from r.primary_job_key
      and not exists(select 1 from public.kpi_staff_competencies c where c.employee_key=u.employee_key and c.skill_key=u.skill_key and c.status<>'inactive')
    group by u.employee_key
  ),
  rows as materialized (
    select r.*,p.bought,b.sold,b.jobs,
           case when r.primary_population='productif' and p.bought>0 and b.sold is not null then round(b.sold/p.bought*100,1) else null end productivity,
           case when r.primary_population='productif' then 'individual'
                when r.primary_population='fixline' then 'team_only'
                else 'not_applicable' end productivity_mode,
           coalesce(ca.competencies,'[]'::jsonb) competencies,
           coalesce(oa.observed_skills,'[]'::jsonb) observed_skills,
           ca.last_poly_use
    from staff_base r
    left join presence p on p.employee_key=r.employee_key
    left join billed b on b.employee_key=r.employee_key
    left join competencies_agg ca on ca.employee_key=r.employee_key
    left join observed_agg oa on oa.employee_key=r.employee_key
  )
  select jsonb_build_object(
    'month',to_char(v_start,'YYYY-MM'),
    'coverage',jsonb_build_object('presenceThrough',v_presence_through,'billedThrough',v_billed_through,'payrollImportedAt',v_payroll_at),
    'counts',jsonb_build_object(
      'total',(select count(*) from rows),
      'active',(select count(*) from rows where active),
      'exited',(select count(*) from rows where not active),
      'neutralized',(select count(*) from rows where active and neutralized),
      'polycompetent',(select count(*) from rows where jsonb_array_length(competencies)>0),
      'observedUnconfirmed',(select count(*) from rows where jsonb_array_length(observed_skills)>0),
      'missingEntryDate',(select count(*) from rows where active and entry_date is null),
      'missingPrimaryJob',(select count(*) from rows where active and primary_job_key is null)
    ),
    'availableMonths',coalesce((
      select jsonb_agg(m order by m desc)
      from (
        select distinct to_char(date_trunc('month',d),'YYYY-MM') m
        from (
          select work_date d from public.kpi_sql_presence_facts
          where source_name='Direct Data RH' and work_date is not null
          union all
          select coalesce(work_date,invoice_date) d from public.kpi_billed_time_facts
          where source_name='Direct Temps pointé facturé' and coalesce(work_date,invoice_date) is not null
        ) z
      ) q
    ),'[]'::jsonb),
    'skills',coalesce((
      select jsonb_agg(jsonb_build_object('skillKey',skill_key,'label',label,'sectorKey',sector_key,'sectorLabel',sector_label) order by sector_label,label)
      from public.kpi_skill_catalog where active
    ),'[]'::jsonb),
    'staff',coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeKey',employee_key,'matricule',matricule,'firstName',first_name,'lastName',last_name,'fullName',full_name,
        'service',service,'teamCode',team_code,'jobTitle',job_title,'entryDate',entry_date,'exitDate',exit_date,'employmentStatus',employment_status,'active',active,
        'primaryPopulation',primary_population,'primaryJobKey',primary_job_key,'primaryJobLabel',primary_job_label,'primarySectorKey',primary_sector_key,'primarySectorLabel',primary_sector_label,
        'boughtHours',bought,'soldHours',sold,'productivity',productivity,'productivityMode',productivity_mode,'jobs',coalesce(jobs,0),
        'neutralized',neutralized,'neutralizedReason',neutralized_reason,'operationalUpdatedAt',operational_updated_at,'operationalOverride',operational_override,
        'competencies',competencies,'observedSkills',observed_skills,'lastPolyUse',last_poly_use,'sourceFilename',source_filename,'sourceImportedAt',source_imported_at
      ) order by active desc,full_name)
      from rows
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end $function$;
