create or replace function public.kpi_billed_operation_sector(p_time_code text, p_time_description text default null, p_existing_sector text default null)
returns text
language sql
immutable
as $$
  select case upper(btrim(coalesce(p_time_code,'')))
    when '01' then 'mecanique'
    when '02' then 'carrosserie'
    when '03' then 'qualite'
    when '06' then 'expertise'
    when '07' then 'preparation'
    when '10' then 'photo'
    when '11' then 'lavage'
    when '13' then 'carrosserie'
    when '14' then 'dsp'
    when '16' then 'jantes'
    else coalesce(nullif(btrim(p_existing_sector),''),case
      when lower(coalesce(p_time_description,'')) like '%expert%' then 'expertise'
      when lower(coalesce(p_time_description,'')) like '%deboss%' or lower(coalesce(p_time_description,'')) like '%déboss%' then 'dsp'
      when lower(coalesce(p_time_description,'')) like '%mécan%' or lower(coalesce(p_time_description,'')) like '%mecan%' then 'mecanique'
      when lower(coalesce(p_time_description,'')) like '%prépar%' or lower(coalesce(p_time_description,'')) like '%prepar%' then 'preparation'
      when lower(coalesce(p_time_description,'')) like '%qualit%' then 'qualite'
      when lower(coalesce(p_time_description,'')) like '%photo%' then 'photo'
      when lower(coalesce(p_time_description,'')) like '%jante%' then 'jantes'
      when lower(coalesce(p_time_description,'')) like '%lavage%' then 'lavage'
      when lower(coalesce(p_time_description,'')) like '%peinture%' or lower(coalesce(p_time_description,'')) like '%carros%' then 'carrosserie'
      else null end)
  end;
$$;

create or replace function public.kpi_productivity_month_unscoped(p_session_hash text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user record;
  v_start date;
  v_end date;
  v_today date:=(timezone('Europe/Paris',now()))::date;
  v_batch record;
  v_sold_hash text;
  v_period_start date;
  v_period_end date;
  v_period_valid boolean:=false;
  v_period_reason text;
  v_result jsonb;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  v_start:=date_trunc('month',coalesce(p_month,current_date))::date;
  v_end:=(v_start+interval '1 month')::date;

  select b.id,b.filename,b.file_sha256,b.min_date,b.max_date,b.completed_at,b.metadata
    into v_batch
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported'
    and b.min_date<v_end and b.max_date>=v_start
  order by b.completed_at desc nulls last,b.created_at desc
  limit 1;

  if v_batch.id is not null then
    v_sold_hash:=v_batch.file_sha256;
    v_period_start:=greatest(v_start,coalesce(v_batch.min_date,v_start));
    v_period_end:=least((v_end-1),coalesce(v_batch.max_date,v_end-1));
    if v_period_start=v_start and v_period_end>=v_period_start and v_period_end<=v_today then
      v_period_valid:=true;
      v_period_reason:='Heures vendues et heures achetées comparées sur le même intervalle, la même population RH active et le même métier vendu.';
    else
      v_period_reason:='La période exacte du fichier Temps pointé facturé n’est pas certifiée pour ce mois. La productivité est neutralisée.';
    end if;
  else
    v_period_reason:='Aucun lot Temps pointé facturé certifié n’est disponible pour ce mois. La productivité est neutralisée.';
  end if;

  with roster as materialized (
    select r.employee_key,r.matricule,r.full_name,r.name_key,r.team_code,r.primary_population,r.primary_job_key,
           coalesce(r.primary_job_label,r.primary_job_key,r.primary_sector_label) primary_job_label,
           r.primary_sector_key,r.primary_sector_label
    from public.kpi_staff_effective r
    where r.active and not r.neutralized
      and r.primary_population in ('productif','fixline')
      and public.kpi_is_productive_sector(r.primary_sector_key)
  ), presence_resolved as (
    select r.employee_key,p.time_value
    from public.kpi_sql_presence_facts p
    join public.kpi_rh_presence_code_map m on m.time_code=p.time_code and m.counts_as_presence and not m.excluded
    join lateral (
      select rr.employee_key
      from roster rr
      left join public.kpi_staff_authoritative_alias aa on aa.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))
      where rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))
         or (aa.matricule is not null and rr.matricule=aa.matricule)
      order by (rr.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name))) desc,rr.employee_key
      limit 1
    ) r on true
    where v_period_valid and p.source_name='Direct Data RH'
      and p.work_date>=v_period_start and p.work_date<=v_period_end
  ), presence as (
    select employee_key,sum(time_value)::numeric bought_hours from presence_resolved group by employee_key
  ), sold_resolved as (
    select r.employee_key,r.primary_sector_key,b.labor_hours,
           public.kpi_billed_operation_sector(b.time_code,b.time_description,b.sector_key) operation_sector_key
    from public.kpi_billed_time_facts b
    join lateral (
      select rr.employee_key,rr.primary_sector_key
      from roster rr
      left join public.kpi_staff_authoritative_alias aa on aa.name_key=b.person_name_key
      where (nullif(btrim(b.matricule),'') is not null and ltrim(coalesce(rr.matricule,''),'0')=ltrim(btrim(b.matricule),'0'))
         or rr.name_key=b.person_name_key
         or (aa.matricule is not null and ltrim(coalesce(rr.matricule,''),'0')=ltrim(aa.matricule,'0'))
      order by (rr.name_key=b.person_name_key) desc,
               (nullif(btrim(b.matricule),'') is not null and ltrim(coalesce(rr.matricule,''),'0')=ltrim(btrim(b.matricule),'0')) desc,
               rr.employee_key
      limit 1
    ) r on true
    where v_period_valid and b.source_name='Direct Temps pointé facturé' and b.source_file_sha256=v_sold_hash
  ), sold as (
    select employee_key,
           sum(labor_hours)::numeric raw_sold_hours,
           sum(labor_hours) filter(where operation_sector_key=primary_sector_key)::numeric matched_sold_hours,
           sum(labor_hours) filter(where operation_sector_key is distinct from primary_sector_key)::numeric cross_activity_sold_hours
    from sold_resolved group by employee_key
  ), detail as (
    select r.*,
           coalesce(p.bought_hours,0)::numeric bought_hours,
           coalesce(s.raw_sold_hours,0)::numeric raw_sold_hours,
           coalesce(s.matched_sold_hours,0)::numeric matched_sold_hours,
           coalesce(s.cross_activity_sold_hours,0)::numeric cross_activity_sold_hours,
           (r.primary_population<>'fixline' and coalesce(r.primary_job_key,'') not in ('fixline','fixline_productif')) as individual_available,
           (coalesce(p.bought_hours,0)>0) as has_bought
    from roster r left join presence p using(employee_key) left join sold s using(employee_key)
  ), sector_rollup as (
    select primary_sector_key sector_key,max(primary_sector_label) sector_label,
           coalesce(primary_job_key,primary_sector_key) workcenter_key,max(primary_job_label) workcenter_label,
           sum(bought_hours) bought_hours,
           sum(raw_sold_hours) raw_sold_hours,
           sum(cross_activity_sold_hours) cross_activity_sold_hours,
           sum(matched_sold_hours) filter(where individual_available and has_bought) comparable_sold_hours,
           sum(matched_sold_hours) filter(where individual_available and not has_bought) unmatched_sold_hours,
           count(*) filter(where individual_available and not has_bought and matched_sold_hours<>0) unmatched_people,
           bool_and(individual_available) comparable
    from detail
    group by primary_sector_key,coalesce(primary_job_key,primary_sector_key)
  ), team_rollup as (
    select primary_sector_key sector_key,max(primary_sector_label) sector_label,
           coalesce(primary_job_key,primary_sector_key) workcenter_key,max(primary_job_label) workcenter_label,
           coalesce(team_code,'NON_AFFECTEE') team_code,
           sum(bought_hours) bought_hours,
           sum(raw_sold_hours) raw_sold_hours,
           sum(cross_activity_sold_hours) cross_activity_sold_hours,
           sum(matched_sold_hours) filter(where individual_available and has_bought) comparable_sold_hours,
           sum(matched_sold_hours) filter(where individual_available and not has_bought) unmatched_sold_hours,
           count(*) filter(where individual_available and not has_bought and matched_sold_hours<>0) unmatched_people,
           bool_and(individual_available) comparable
    from detail
    group by primary_sector_key,coalesce(primary_job_key,primary_sector_key),coalesce(team_code,'NON_AFFECTEE')
  ), available_months as (
    select distinct month_key from (
      select to_char(date_trunc('month',work_date)::date,'YYYY-MM') month_key from public.kpi_sql_presence_facts where work_date is not null
      union all
      select to_char(date_trunc('month',min_date)::date,'YYYY-MM') from public.kpi_ops_import_batches where source_key='billed_time' and status='imported' and min_date is not null
    ) q
  )
  select jsonb_build_object(
    'month',to_char(v_start,'YYYY-MM'),
    'period',jsonb_build_object('valid',v_period_valid,'start',case when v_period_valid then to_char(v_period_start,'YYYY-MM-DD') end,'end',case when v_period_valid then to_char(v_period_end,'YYYY-MM-DD') end,'reason',v_period_reason,'billedFilename',v_batch.filename,'billedImportedAt',v_batch.completed_at),
    'sourceStatus',jsonb_build_object('presence',exists(select 1 from presence),'billedTime',exists(select 1 from sold_resolved),'comparable',v_period_valid,'authoritativeRoster',true,'samePopulation',true,'sameActivity',true),
    'availableMonths',coalesce((select jsonb_agg(month_key order by month_key desc) from available_months),'[]'::jsonb),
    'totals',jsonb_build_object(
      'boughtHours',round(coalesce((select sum(bought_hours) from detail where individual_available),0),2),
      'soldHours',round(coalesce((select sum(matched_sold_hours) from detail where individual_available and has_bought),0),2),
      'productivity',case when v_period_valid and coalesce((select sum(bought_hours) from detail where individual_available),0)>0 then round(coalesce((select sum(matched_sold_hours) from detail where individual_available and has_bought),0)/nullif((select sum(bought_hours) from detail where individual_available),0)*100,1) end
    ),
    'dataQuality',jsonb_build_object(
      'activeRoster',coalesce((select count(*) from detail),0),
      'unmatchedSoldHours',round(coalesce((select sum(matched_sold_hours) from detail where individual_available and not has_bought),0),2),
      'unmatchedSoldPeople',coalesce((select count(*) from detail where individual_available and not has_bought and matched_sold_hours<>0),0),
      'crossActivitySoldHours',round(coalesce((select sum(cross_activity_sold_hours) from detail where individual_available),0),2),
      'missingBoughtPeople',coalesce((select count(*) from detail where individual_available and bought_hours=0),0),
      'collectivePeople',coalesce((select count(*) from detail where not individual_available),0)
    ),
    'sectors',coalesce((select jsonb_agg(jsonb_build_object(
      'sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,
      'boughtHours',round(bought_hours,2),'soldHours',case when comparable then round(coalesce(comparable_sold_hours,0),2) end,
      'rawSoldHours',round(raw_sold_hours,2),'crossActivitySoldHours',round(coalesce(cross_activity_sold_hours,0),2),'unmatchedSoldHours',round(coalesce(unmatched_sold_hours,0),2),'unmatchedPeople',unmatched_people,
      'productivity',case when v_period_valid and comparable and bought_hours>0 then round(coalesce(comparable_sold_hours,0)/bought_hours*100,1) end,
      'comparable',comparable
    ) order by sector_label,workcenter_label) from sector_rollup),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_build_object(
      'sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,'teamCode',team_code,
      'boughtHours',round(bought_hours,2),'soldHours',case when comparable then round(coalesce(comparable_sold_hours,0),2) end,
      'rawSoldHours',round(raw_sold_hours,2),'crossActivitySoldHours',round(coalesce(cross_activity_sold_hours,0),2),'unmatchedSoldHours',round(coalesce(unmatched_sold_hours,0),2),'unmatchedPeople',unmatched_people,
      'productivity',case when v_period_valid and comparable and bought_hours>0 then round(coalesce(comparable_sold_hours,0)/bought_hours*100,1) end,
      'comparable',comparable
    ) order by sector_label,workcenter_label,team_code) from team_rollup),'[]'::jsonb),
    'collaborators',coalesce((select jsonb_agg(jsonb_build_object(
      'nameKey',name_key,'mechanicName',full_name,'teamCode',coalesce(team_code,'NON_AFFECTEE'),'sectorKey',primary_sector_key,'sectorLabel',primary_sector_label,
      'workcenterKey',coalesce(primary_job_key,primary_sector_key),'workcenterLabel',primary_job_label,
      'boughtHours',round(bought_hours,2),'soldHours',case when individual_available and has_bought then round(matched_sold_hours,2) end,
      'rawSoldHours',round(raw_sold_hours,2),'crossActivitySoldHours',round(cross_activity_sold_hours,2),'unmatchedSoldHours',case when individual_available and not has_bought then round(matched_sold_hours,2) else 0 end,
      'productivity',case when v_period_valid and individual_available and has_bought then round(matched_sold_hours/bought_hours*100,1) end,
      'individualAvailable',individual_available,'comparable',individual_available and has_bought
    ) order by primary_sector_label,primary_job_label,full_name) from detail),'[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;
