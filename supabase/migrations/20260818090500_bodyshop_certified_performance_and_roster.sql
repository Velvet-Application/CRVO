create or replace function public.kpi_capacity_bodyshop_reference(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_months jsonb := '[]'::jsonb;
  v_avg_month numeric := 0;
  v_avg_day numeric := 0;
  v_avg_fixline numeric := 0;
  v_avg_box numeric := 0;
  v_count integer := 0;
  v_backlog numeric := 200;
  v_prod jsonb := '{}'::jsonb;
  v_box_prod numeric;
  v_prod_end text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_session_hash) limit 1;
  if v_auth.ok is distinct from true then raise exception 'unauthorized' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'forbidden' using errcode='42501'; end if;

  select count(*),coalesce(avg(treated_total),0),
         case when sum(observed_days)>0 then sum(treated_total)/sum(observed_days) else 0 end,
         coalesce(avg(fixline_total),0),coalesce(avg(box_total),0),
         coalesce(jsonb_agg(jsonb_build_object(
           'month',to_char(month,'YYYY-MM'),'fixline',fixline_total,'box',box_total,
           'weekendExtra',weekend_extra,'treated',treated_total,'observedDays',observed_days,'note',note
         ) order by month),'[]'::jsonb)
  into v_count,v_avg_month,v_avg_day,v_avg_fixline,v_avg_box,v_months
  from public.kpi_capacity_bodyshop_history
  where is_full_month;

  select average_backlog into v_backlog from public.kpi_capacity_bodyshop_settings where id=1;

  begin
    v_prod:=public.kpi_productivity_month(p_session_hash,date_trunc('month',(timezone('Europe/Paris',now()))::date)::date);
    select nullif(x->>'productivity','')::numeric into v_box_prod
    from jsonb_array_elements(coalesce(v_prod->'sectors','[]'::jsonb)) x
    where x->>'sectorKey'='carrosserie' and x->>'workcenterKey'='box'
    limit 1;
    v_prod_end:=v_prod->'period'->>'end';
  exception when others then
    v_box_prod:=null;v_prod_end:=null;
  end;

  return jsonb_build_object(
    'source','suivi carrosserie.xlsx','fullMonthCount',v_count,
    'averageMonthlyTreated',round(v_avg_month,1),'averageDailyTreated',round(v_avg_day,2),
    'averageFixlineMonthly',round(v_avg_fixline,1),'averageBoxMonthly',round(v_avg_box,1),
    'averageBacklog',coalesce(v_backlog,200),
    'boxCurrentProductivity',case when v_box_prod is null then null else round(v_box_prod,1) end,
    'fixlineCurrentProductivity',null,'fixlineComparable',false,'productivityPeriodEnd',v_prod_end,
    'productivityNote','Box = heures vendues comparables / heures achetées. Fixline = mesure collective, aucun pourcentage individuel n’est inventé.',
    'months',v_months
  );
end $$;

create or replace function public.kpi_capacity_roster(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path=public
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

  select b.file_sha256,b.min_date,b.max_date into v_batch
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported'
  order by b.completed_at desc nulls last,b.created_at desc
  limit 1;
  if v_batch.file_sha256 is not null then
    v_period_start:=v_batch.min_date;
    v_period_end:=least(coalesce(v_batch.max_date,v_today),v_today);
  end if;

  return coalesce((
    with staff as materialized (
      select r.employee_key,r.matricule,r.full_name,r.job_title,r.primary_sector_key,r.primary_sector_label,r.team_code,r.name_key,
             r.primary_population,r.primary_job_key,r.primary_job_label,coalesce(s.included,true) included
      from public.kpi_staff_effective r
      left join public.kpi_capacity_staff_selection s on s.site_code='lens' and s.employee_key=r.employee_key
      where r.active=true and not r.neutralized
        and (r.entry_date is null or r.entry_date<=v_today)
        and (r.exit_date is null or r.exit_date>v_today)
        and r.primary_sector_key in ('expertise','mecanique','dsp','carrosserie','preparation','qualite')
    ), alias_map as materialized (
      select employee_key,name_key from staff
      union
      select st.employee_key,aa.name_key from staff st join public.kpi_staff_authoritative_alias aa on aa.matricule=st.matricule
    ), bought as materialized (
      select am.employee_key,sum(p.time_value)::numeric bought_hours
      from public.kpi_sql_presence_facts p
      join public.kpi_rh_presence_code_map m on m.time_code=p.time_code and m.counts_as_presence and not m.excluded
      join alias_map am on am.name_key=p.person_name_key
      where v_period_start is not null and v_period_end is not null
        and p.source_name='Direct Data RH' and p.work_date between v_period_start and v_period_end
      group by am.employee_key
    ), sold as materialized (
      select x.employee_key,
             sum(x.labor_hours) filter(where x.operation_sector_key=x.primary_sector_key)::numeric sold_hours,
             sum(x.labor_hours)::numeric raw_sold_hours
      from (
        select coalesce(am.employee_key,sm.employee_key) employee_key,
               coalesce(sn.primary_sector_key,sm.primary_sector_key) primary_sector_key,
               f.labor_hours,public.kpi_billed_operation_sector(f.time_code,f.time_description,f.sector_key) operation_sector_key
        from public.kpi_billed_time_facts f
        left join alias_map am on am.name_key=f.person_name_key
        left join staff sn on sn.employee_key=am.employee_key
        left join staff sm on nullif(btrim(f.matricule),'') is not null
                          and ltrim(coalesce(sm.matricule,''),'0')=ltrim(btrim(f.matricule),'0')
        where v_batch.file_sha256 is not null and f.source_name='Direct Temps pointé facturé'
          and f.source_file_sha256=v_batch.file_sha256 and coalesce(am.employee_key,sm.employee_key) is not null
      ) x group by x.employee_key
    )
    select jsonb_agg(jsonb_build_object(
      'employeeKey',st.employee_key,'matricule',st.matricule,'fullName',st.full_name,'jobTitle',st.job_title,
      'sectorKey',st.primary_sector_key,'sectorLabel',st.primary_sector_label,
      'workcenterKey',st.primary_job_key,'workcenterLabel',st.primary_job_label,'teamCode',st.team_code,'included',st.included,
      'boughtHours',round(coalesce(b.bought_hours,0),2),'soldHours',round(coalesce(so.sold_hours,0),2),'rawSoldHours',round(coalesce(so.raw_sold_hours,0),2),
      'comparable',(coalesce(b.bought_hours,0)>0 and st.primary_population<>'fixline' and coalesce(st.primary_job_key,'') not in ('fixline','fixline_productif')),
      'productivity',case when coalesce(b.bought_hours,0)>0 and st.primary_population<>'fixline' and coalesce(st.primary_job_key,'') not in ('fixline','fixline_productif') then round(coalesce(so.sold_hours,0)/b.bought_hours*100,1) else null end
    ) order by st.primary_sector_key,st.primary_job_key,st.full_name)
    from staff st left join bought b using(employee_key) left join sold so using(employee_key)
  ),'[]'::jsonb);
end $$;