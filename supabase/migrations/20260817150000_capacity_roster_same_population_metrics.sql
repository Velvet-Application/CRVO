create or replace function public.kpi_capacity_roster(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user record;
  v_today date := (timezone('Europe/Paris',now()))::date;
  v_batch record;
  v_period_start date;
  v_period_end date;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  select b.file_sha256 into v_batch
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported'
  order by b.completed_at desc nulls last,b.created_at desc
  limit 1;

  if v_batch.file_sha256 is not null then
    select min(nullif(f.metadata->>'period_start','')::date),max(nullif(f.metadata->>'period_end','')::date)
      into v_period_start,v_period_end
    from public.kpi_billed_time_facts f
    where f.source_name='Direct Temps pointé facturé'
      and f.source_file_sha256=v_batch.file_sha256;
  end if;

  return coalesce((
    with staff as (
      select r.employee_key,r.matricule,r.full_name,r.job_title,r.primary_sector_key,r.primary_sector_label,r.team_code,r.name_key,
        coalesce(s.included,true) included
      from public.kpi_staff_registry r
      left join public.kpi_capacity_staff_selection s
        on s.site_code='lens' and s.employee_key=r.employee_key
      where r.active=true
        and (r.entry_date is null or r.entry_date<=v_today)
        and (r.exit_date is null or r.exit_date>v_today)
        and r.primary_sector_key in ('expertise','mecanique','dsp','carrosserie','preparation','qualite')
    ), bought as (
      select st.employee_key,sum(p.time_value)::numeric bought_hours
      from staff st
      join public.kpi_sql_presence_facts p
        on public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))=st.name_key
      join public.kpi_rh_presence_code_map m
        on m.time_code=p.time_code and m.counts_as_presence and not m.excluded
      where v_period_start is not null and v_period_end is not null
        and p.work_date between v_period_start and v_period_end
      group by st.employee_key
    ), sold as (
      select st.employee_key,sum(f.labor_hours)::numeric sold_hours
      from staff st
      join public.kpi_billed_time_facts f
        on (
          (nullif(btrim(f.matricule),'') is not null and f.matricule=st.matricule)
          or
          (nullif(btrim(f.matricule),'') is null and public.kpi_normalize_person_name(public.kpi_rh_base_name(f.mechanic_name))=st.name_key)
        )
      where v_batch.file_sha256 is not null
        and f.source_name='Direct Temps pointé facturé'
        and f.source_file_sha256=v_batch.file_sha256
      group by st.employee_key
    )
    select jsonb_agg(jsonb_build_object(
      'employeeKey',st.employee_key,
      'matricule',st.matricule,
      'fullName',st.full_name,
      'jobTitle',st.job_title,
      'sectorKey',st.primary_sector_key,
      'sectorLabel',st.primary_sector_label,
      'teamCode',st.team_code,
      'included',st.included,
      'boughtHours',round(coalesce(b.bought_hours,0),2),
      'soldHours',round(coalesce(so.sold_hours,0),2),
      'comparable',coalesce(b.bought_hours,0)>0,
      'productivity',case when coalesce(b.bought_hours,0)>0 then round(coalesce(so.sold_hours,0)/b.bought_hours*100,1) else null end
    ) order by st.primary_sector_key,st.full_name)
    from staff st
    left join bought b using(employee_key)
    left join sold so using(employee_key)
  ),'[]'::jsonb);
end
$$;

grant execute on function public.kpi_capacity_roster(text) to anon,authenticated,service_role;