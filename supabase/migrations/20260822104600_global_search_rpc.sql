create or replace function public.kpi_global_search(
  p_query text,
  p_limit integer default 28
)
returns table (
  kind text,
  source_id text,
  payload jsonb,
  score integer
)
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select
    lower(trim(coalesce(p_query, ''))) as needle,
    regexp_replace(lower(trim(coalesce(p_query, ''))), '[^a-z0-9]', '', 'g') as compact,
    greatest(1, least(coalesce(p_limit, 28), 50)) as max_rows
),
vehicle_hits as (
  select
    'vehicle'::text as kind,
    coalesce(nullif(v.vin,''), nullif(v.work_order,''), nullif(v.registration,''), md5(to_jsonb(v)::text))::text as source_id,
    to_jsonb(v) as payload,
    case
      when p.compact <> '' and regexp_replace(lower(coalesce(v.registration,'')), '[^a-z0-9]', '', 'g') = p.compact then 120
      when p.compact <> '' and regexp_replace(lower(coalesce(v.vin,'')), '[^a-z0-9]', '', 'g') = p.compact then 118
      when p.compact <> '' and regexp_replace(lower(coalesce(v.work_order,'')), '[^a-z0-9]', '', 'g') = p.compact then 116
      when p.compact <> '' and strpos(regexp_replace(lower(coalesce(v.registration,'')), '[^a-z0-9]', '', 'g'), p.compact) = 1 then 105
      when p.compact <> '' and strpos(regexp_replace(lower(coalesce(v.vin,'')), '[^a-z0-9]', '', 'g'), p.compact) = 1 then 103
      when p.compact <> '' and strpos(regexp_replace(lower(coalesce(v.work_order,'')), '[^a-z0-9]', '', 'g'), p.compact) = 1 then 101
      when strpos(lower(coalesce(v.client,'')), p.needle) > 0 then 70
      when strpos(lower(coalesce(v.model,'')), p.needle) > 0 then 60
      else 80
    end::integer as score
  from public.kpi_client_vehicle_public v
  cross join params p
  where length(p.needle) >= 2
    and (
      strpos(lower(coalesce(v.client,'')), p.needle) > 0
      or strpos(lower(coalesce(v.model,'')), p.needle) > 0
      or (p.compact <> '' and strpos(regexp_replace(lower(coalesce(v.registration,'')), '[^a-z0-9]', '', 'g'), p.compact) > 0)
      or (p.compact <> '' and strpos(regexp_replace(lower(coalesce(v.vin,'')), '[^a-z0-9]', '', 'g'), p.compact) > 0)
      or (p.compact <> '' and strpos(regexp_replace(lower(coalesce(v.work_order,'')), '[^a-z0-9]', '', 'g'), p.compact) > 0)
    )
  order by score desc, v.factory_age_days desc nulls last
  limit 10
),
claim_hits as (
  select
    'claim'::text as kind,
    c.id::text as source_id,
    to_jsonb(c) as payload,
    case
      when lower(coalesce(c.claim_number,'')) = p.needle then 115
      when p.compact <> '' and regexp_replace(lower(coalesce(c.registration,'')), '[^a-z0-9]', '', 'g') = p.compact then 112
      when p.compact <> '' and regexp_replace(lower(coalesce(c.vin,'')), '[^a-z0-9]', '', 'g') = p.compact then 110
      when p.compact <> '' and regexp_replace(lower(coalesce(c.work_order,'')), '[^a-z0-9]', '', 'g') = p.compact then 108
      when strpos(lower(coalesce(c.claim_number,'')), p.needle) = 1 then 100
      when strpos(lower(coalesce(c.responsible_employee_name,'')), p.needle) > 0 then 75
      else 82
    end::integer as score
  from public.kpi_quality_claims c
  cross join params p
  where length(p.needle) >= 2
    and (
      strpos(lower(coalesce(c.claim_number,'')), p.needle) > 0
      or strpos(lower(coalesce(c.client_name,'')), p.needle) > 0
      or strpos(lower(coalesce(c.responsible_employee_name,'')), p.needle) > 0
      or strpos(lower(coalesce(c.quality_employee_name,'')), p.needle) > 0
      or (p.compact <> '' and strpos(regexp_replace(lower(coalesce(c.registration,'')), '[^a-z0-9]', '', 'g'), p.compact) > 0)
      or (p.compact <> '' and strpos(regexp_replace(lower(coalesce(c.vin,'')), '[^a-z0-9]', '', 'g'), p.compact) > 0)
      or (p.compact <> '' and strpos(regexp_replace(lower(coalesce(c.work_order,'')), '[^a-z0-9]', '', 'g'), p.compact) > 0)
    )
  order by score desc, c.updated_at desc nulls last
  limit 10
),
person_hits as (
  select
    'person'::text as kind,
    coalesce(nullif(s.employee_key,''), nullif(s.matricule,''), nullif(s.full_name,''), md5(to_jsonb(s)::text))::text as source_id,
    to_jsonb(s) as payload,
    case
      when lower(coalesce(s.full_name,'')) = p.needle then 114
      when lower(coalesce(s.matricule,'')) = p.needle then 113
      when strpos(lower(coalesce(s.full_name,'')), p.needle) = 1 then 102
      when strpos(lower(coalesce(s.last_name,'')), p.needle) = 1 then 100
      when strpos(lower(coalesce(s.first_name,'')), p.needle) = 1 then 98
      else 76
    end::integer as score
  from public.kpi_staff_effective s
  cross join params p
  where length(p.needle) >= 2
    and s.active is true
    and (
      strpos(lower(coalesce(s.full_name,'')), p.needle) > 0
      or strpos(lower(coalesce(s.first_name,'')), p.needle) > 0
      or strpos(lower(coalesce(s.last_name,'')), p.needle) > 0
      or strpos(lower(coalesce(s.matricule,'')), p.needle) > 0
      or strpos(lower(coalesce(s.employee_key,'')), p.needle) > 0
      or strpos(lower(coalesce(s.service,'')), p.needle) > 0
      or strpos(lower(coalesce(s.team_code,'')), p.needle) > 0
      or strpos(lower(coalesce(s.job_title,'')), p.needle) > 0
      or strpos(lower(coalesce(s.primary_sector_label,'')), p.needle) > 0
    )
  order by score desc, s.full_name asc
  limit 12
),
client_hits as (
  select
    'client'::text as kind,
    cs.client::text as source_id,
    to_jsonb(cs) as payload,
    case
      when lower(coalesce(cs.client,'')) = p.needle then 108
      when strpos(lower(coalesce(cs.client,'')), p.needle) = 1 then 95
      else 72
    end::integer as score
  from public.kpi_client_summary_public cs
  cross join params p
  where length(p.needle) >= 2
    and strpos(lower(coalesce(cs.client,'')), p.needle) > 0
  order by score desc, cs.vehicle_count desc nulls last
  limit 10
),
combined as (
  select * from vehicle_hits
  union all
  select * from claim_hits
  union all
  select * from person_hits
  union all
  select * from client_hits
)
select c.kind, c.source_id, c.payload, c.score
from combined c
cross join params p
order by c.score desc, c.kind, c.source_id
limit (select max_rows from params);
$$;

revoke all on function public.kpi_global_search(text, integer) from public;
grant execute on function public.kpi_global_search(text, integer) to service_role;
