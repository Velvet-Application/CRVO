-- Applied to production Supabase on 2026-08-14.
-- Monthly productivity by sector, team and collaborator.
-- Fixline deliberately has no individual productivity.

create or replace function public.kpi_productivity_month(p_session_hash text,p_month date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user record; v_start date; v_end date; v_result jsonb;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  v_start:=date_trunc('month',coalesce(p_month,current_date))::date;
  v_end:=(v_start+interval '1 month')::date;

  with presence0 as (
    select
      p.work_date,
      public.kpi_rh_base_name(p.mechanic_name) mechanic_name,
      public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name)) name_key,
      coalesce(public.kpi_rh_team_from_name(p.mechanic_name),a.team_code) team_code,
      m.sector_key,m.sector_label,m.workcenter_key,m.workcenter_label,
      p.time_value bought_hours
    from public.kpi_sql_presence_facts p
    join public.kpi_rh_presence_code_map m
      on m.time_code=p.time_code and m.counts_as_presence and not m.excluded
    left join public.kpi_productivity_team_assignment a
      on a.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name)) and a.active
    where p.work_date>=v_start and p.work_date<v_end
  ),
  presence as (
    select
      name_key,max(mechanic_name) mechanic_name,coalesce(team_code,'NON_AFFECTEE') team_code,
      sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,
      sum(bought_hours) bought_hours
    from presence0
    group by name_key,coalesce(team_code,'NON_AFFECTEE'),sector_key,workcenter_key
  ),
  dominant as (
    select * from (
      select name_key,team_code,sector_key,sector_label,workcenter_key,workcenter_label,bought_hours,
        row_number() over(partition by name_key order by bought_hours desc) rn
      from presence
    ) q where rn=1
  ),
  sold0 as (
    select
      coalesce(b.invoice_date,b.work_date) work_date,
      public.kpi_rh_base_name(b.mechanic_name) mechanic_name,
      public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) name_key,
      coalesce(b.team_code,a.team_code,d.team_code,'NON_AFFECTEE') team_code,
      case when a.scope='fixline' then 'carrosserie' else coalesce(b.sector_key,d.sector_key,'non_classe') end sector_key,
      case when a.scope='fixline' then 'Carrosserie' else coalesce(b.sector_label,d.sector_label,'Non classé') end sector_label,
      case when a.scope='fixline' then 'fixline' else coalesce(b.workcenter_key,d.workcenter_key,b.sector_key,'non_classe') end workcenter_key,
      case when a.scope='fixline' then 'Fixline' else coalesce(d.workcenter_label,b.sector_label,'Non classé') end workcenter_label,
      b.labor_hours sold_hours
    from public.kpi_billed_time_facts b
    left join public.kpi_productivity_team_assignment a
      on a.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) and a.active
    left join dominant d
      on d.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name))
    where coalesce(b.invoice_date,b.work_date)>=v_start
      and coalesce(b.invoice_date,b.work_date)<v_end
      and b.source_name='Direct Temps pointé facturé'
  ),
  sold as (
    select name_key,max(mechanic_name) mechanic_name,team_code,sector_key,max(sector_label) sector_label,
      workcenter_key,max(workcenter_label) workcenter_label,sum(sold_hours) sold_hours
    from sold0
    group by name_key,team_code,sector_key,workcenter_key
  ),
  dims as (
    select name_key,mechanic_name,team_code,sector_key,sector_label,workcenter_key,workcenter_label from presence
    union
    select name_key,mechanic_name,team_code,sector_key,sector_label,workcenter_key,workcenter_label from sold
  ),
  detail as (
    select
      d.name_key,max(d.mechanic_name) mechanic_name,d.team_code,d.sector_key,max(d.sector_label) sector_label,
      d.workcenter_key,max(d.workcenter_label) workcenter_label,
      coalesce(max(p.bought_hours),0) bought_hours,
      coalesce(max(s.sold_hours),0) sold_hours,
      (d.workcenter_key<>'fixline') individual_available
    from dims d
    left join presence p using(name_key,team_code,sector_key,workcenter_key)
    left join sold s using(name_key,team_code,sector_key,workcenter_key)
    group by d.name_key,d.team_code,d.sector_key,d.workcenter_key
  ),
  sectors as (
    select sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,
      sum(bought_hours) bought_hours,sum(sold_hours) sold_hours
    from detail group by sector_key,workcenter_key
  ),
  teams as (
    select sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,team_code,
      sum(bought_hours) bought_hours,sum(sold_hours) sold_hours
    from detail group by sector_key,workcenter_key,team_code
  ),
  available_months as (
    select distinct to_char(date_trunc('month',d)::date,'YYYY-MM') as month_key from (
      select work_date d from public.kpi_sql_presence_facts where work_date is not null
      union all
      select coalesce(invoice_date,work_date) d from public.kpi_billed_time_facts where coalesce(invoice_date,work_date) is not null
    ) x
  )
  select jsonb_build_object(
    'month',to_char(v_start,'YYYY-MM'),
    'availableMonths',coalesce((select jsonb_agg(month_key order by month_key desc) from available_months),'[]'::jsonb),
    'totals',jsonb_build_object(
      'boughtHours',round(coalesce((select sum(bought_hours) from detail),0),2),
      'soldHours',round(coalesce((select sum(sold_hours) from detail),0),2),
      'productivity',case
        when coalesce((select sum(bought_hours) from detail),0)>0
          then round(coalesce((select sum(sold_hours) from detail),0)/nullif((select sum(bought_hours) from detail),0)*100,1)
        else null end
    ),
    'sectors',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,
        'boughtHours',round(bought_hours,2),'soldHours',round(sold_hours,2),
        'productivity',case when bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end
      ) order by sector_label,workcenter_label) from sectors
    ),'[]'::jsonb),
    'teams',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,
        'teamCode',team_code,'boughtHours',round(bought_hours,2),'soldHours',round(sold_hours,2),
        'productivity',case when bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end
      ) order by sector_label,workcenter_label,team_code) from teams
    ),'[]'::jsonb),
    'collaborators',coalesce((
      select jsonb_agg(jsonb_build_object(
        'nameKey',name_key,'mechanicName',mechanic_name,'teamCode',team_code,
        'sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,
        'boughtHours',round(bought_hours,2),
        'soldHours',case when individual_available then round(sold_hours,2) else null end,
        'productivity',case when individual_available and bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end,
        'individualAvailable',individual_available
      ) order by sector_label,workcenter_label,mechanic_name) from detail
    ),'[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

revoke all on function public.kpi_productivity_month(text,date) from public;
grant execute on function public.kpi_productivity_month(text,date) to anon,authenticated,service_role;
