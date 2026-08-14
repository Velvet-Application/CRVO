-- Applied to production Supabase on 2026-08-14.
-- Bodyshop bought hours = confirmed FIX + BOX + TOL presence only.
-- Fixline sold hours are assigned by team/supervisor, never as individual productivity.

create or replace view public.kpi_bodyshop_staff_effective as
with manual as (
  select
    ('manual:'||m.id::text) id,
    public.kpi_rh_base_name(m.mechanic_name) mechanic_name,
    public.kpi_normalize_person_name(public.kpi_rh_base_name(m.mechanic_name)) name_key,
    m.team_code,
    m.workcenter,
    null::text matricule,
    null::text service,
    'manual'::text mapping_source,
    m.active
  from public.kpi_bodyshop_staff_map m
  where m.active
),
auto_staff as (
  select distinct on (d.name_key)
    ('rh:'||d.employee_key) id,
    d.full_name mechanic_name,
    d.name_key,
    d.team_code,
    case upper(coalesce(d.service,''))
      when 'FIX' then 'mixed'
      when 'BOX' then 'box'
      when 'TOL' then 'heavy'
      else 'mixed'
    end workcenter,
    d.matricule,
    d.service,
    'rh_import'::text mapping_source,
    true active
  from public.kpi_rh_staff_dimension d
  where d.team_code in ('A','B','C')
    and (upper(coalesce(d.service,'')) in ('FIX','BOX','TOL') or coalesce(d.service,'') ~* '(carross|t[oô]ler|body|fixline)')
  order by d.name_key,d.source_updated_at desc
)
select * from manual
union all
select a.* from auto_staff a
where not exists(select 1 from manual m where m.name_key=a.name_key);

grant select on public.kpi_bodyshop_staff_effective to service_role;

create or replace view public.kpi_bodyshop_team_hours as
with sold_base as (
  select
    coalesce(b.invoice_date,b.work_date) work_date,
    coalesce(b.team_code,a.team_code,m.team_code) team_code,
    b.labor_hours,
    coalesce(nullif(trim(b.invoice_number),''),nullif(trim(b.work_order),'')) dossier
  from public.kpi_billed_time_facts b
  left join public.kpi_productivity_team_assignment a
    on a.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) and a.active
  left join public.kpi_bodyshop_staff_effective m
    on m.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))
  where coalesce(b.invoice_date,b.work_date) is not null
    and (a.scope='fixline' or b.sector_key='carrosserie' or m.name_key is not null)
),
sold as (
  select work_date,team_code,sum(coalesce(labor_hours,0)) sold_hours,count(distinct dossier)::integer dossiers
  from sold_base
  where team_code in ('A','B','C')
  group by work_date,team_code
),
bought as (
  select
    p.work_date,
    coalesce(public.kpi_rh_team_from_name(p.mechanic_name),a.team_code,m.team_code) team_code,
    sum(coalesce(p.time_value,0)) bought_hours
  from public.kpi_sql_presence_facts p
  join public.kpi_rh_presence_code_map c
    on c.time_code=p.time_code
   and c.sector_key='carrosserie'
   and c.counts_as_presence
   and not c.excluded
  left join public.kpi_productivity_team_assignment a
    on a.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name)) and a.active
  left join public.kpi_bodyshop_staff_effective m
    on m.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))
  where p.work_date is not null
  group by p.work_date,coalesce(public.kpi_rh_team_from_name(p.mechanic_name),a.team_code,m.team_code)
),
dates as (
  select work_date,team_code from sold
  union
  select work_date,team_code from bought
)
select
  d.work_date,
  d.team_code,
  coalesce(s.sold_hours,0)::numeric(12,2) sold_hours,
  coalesce(b.bought_hours,0)::numeric(12,2) bought_hours,
  coalesce(s.dossiers,0) dossiers,
  case when coalesce(b.bought_hours,0)>0 then round(coalesce(s.sold_hours,0)/b.bought_hours*100,1) else null end efficiency
from dates d
left join sold s using(work_date,team_code)
left join bought b using(work_date,team_code)
where d.team_code in ('A','B','C');

grant select on public.kpi_bodyshop_team_hours to service_role;

create or replace view public.kpi_bodyshop_client_time as
select
  coalesce(b.invoice_date,b.work_date) work_date,
  coalesce(b.team_code,a.team_code,m.team_code) team_code,
  coalesce(nullif(trim(f.client),''),'Client non renseigné') client,
  coalesce(nullif(trim(b.invoice_number),''),nullif(trim(b.work_order),'')) dossier,
  b.labor_hours
from public.kpi_billed_time_facts b
left join public.kpi_productivity_team_assignment a
  on a.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) and a.active
left join public.kpi_bodyshop_staff_effective m
  on m.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))
left join public.kpi_invoice_facts f
  on ((nullif(trim(b.invoice_number),'') is not null and f.invoice_number=b.invoice_number)
   or (nullif(trim(b.invoice_number),'') is null and nullif(trim(b.work_order),'') is not null and f.work_order=b.work_order))
where coalesce(b.invoice_date,b.work_date) is not null
  and (a.scope='fixline' or b.sector_key='carrosserie' or m.name_key is not null);

grant select on public.kpi_bodyshop_client_time to service_role;
