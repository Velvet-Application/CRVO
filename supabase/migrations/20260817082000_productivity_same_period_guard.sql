create or replace function public.kpi_productivity_month_unscoped(p_session_hash text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user record;
  v_start date;
  v_end date;
  v_today date := (timezone('Europe/Paris',now()))::date;
  v_result jsonb;
  v_has_sold boolean:=false;
  v_batch record;
  v_sold_hash text:=null;
  v_period_start date:=null;
  v_period_end date:=null;
  v_period_valid boolean:=false;
  v_period_reason text:=null;
  v_presence_from date;
  v_presence_to date;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  v_start:=date_trunc('month',coalesce(p_month,current_date))::date;
  v_end:=(v_start+interval '1 month')::date;

  select b.id,b.filename,b.file_sha256,b.min_date,b.max_date,b.completed_at,b.metadata into v_batch
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported' and b.min_date<v_end and b.max_date>=v_start
  order by b.completed_at desc nulls last,b.created_at desc limit 1;

  if v_batch.id is not null then
    v_sold_hash:=v_batch.file_sha256;
    select min(nullif(f.metadata->>'period_start','')::date),max(nullif(f.metadata->>'period_end','')::date)
      into v_period_start,v_period_end
    from public.kpi_billed_time_facts f
    where f.source_name='Direct Temps pointé facturé' and f.source_file_sha256=v_sold_hash;

    if v_period_start is not null and v_period_end is not null
       and v_period_start>=v_start and v_period_end<v_end
       and v_period_start<=v_period_end and v_period_end<=v_today then
      v_period_valid:=true;
      v_period_reason:='Heures vendues et heures achetées comparées sur la période déclarée de l''extraction.';
    else
      v_period_reason:='La période exacte du fichier Temps pointé facturé n''est pas confirmée. La productivité est neutralisée pour éviter une comparaison de périodes différentes.';
    end if;
  else
    select f.source_file_sha256 into v_sold_hash
    from public.kpi_billed_time_facts f
    where f.source_name='Direct Temps pointé facturé'
      and coalesce(f.invoice_date,f.work_date)>=v_start and coalesce(f.invoice_date,f.work_date)<v_end
    order by f.imported_at desc nulls last limit 1;
    v_period_reason:='Aucun lot Temps pointé facturé avec période certifiée n''est disponible. La productivité est neutralisée.';
  end if;

  if v_sold_hash is not null then
    select exists(select 1 from public.kpi_billed_time_facts f where f.source_name='Direct Temps pointé facturé' and f.source_file_sha256=v_sold_hash) into v_has_sold;
  else
    v_has_sold:=false;
  end if;

  v_presence_from:=case when v_period_valid then v_period_start else v_start end;
  v_presence_to:=case when v_period_valid then v_period_end+1 else v_end end;

  with presence0 as (
    select p.work_date,
      public.kpi_rh_base_name(p.mechanic_name) mechanic_name,
      public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name)) name_key,
      coalesce(public.kpi_rh_team_from_name(p.mechanic_name),a.team_code) team_code,
      m.sector_key,m.sector_label,m.workcenter_key,m.workcenter_label,p.time_value bought_hours
    from public.kpi_sql_presence_facts p
    join public.kpi_rh_presence_code_map m on m.time_code=p.time_code and m.counts_as_presence and not m.excluded
    left join public.kpi_productivity_team_assignment a on a.name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name)) and a.active
    where p.work_date>=v_presence_from and p.work_date<v_presence_to
  ), presence as (
    select name_key,max(mechanic_name) mechanic_name,coalesce(team_code,'NON_AFFECTEE') team_code,sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,sum(bought_hours) bought_hours
    from presence0 group by name_key,coalesce(team_code,'NON_AFFECTEE'),sector_key,workcenter_key
  ), dominant as (
    select * from (
      select name_key,team_code,sector_key,sector_label,workcenter_key,workcenter_label,bought_hours,row_number() over(partition by name_key order by bought_hours desc) rn
      from presence
    ) q where rn=1
  ), billed_base as (
    select b.*,
      public.kpi_rh_base_name(b.mechanic_name) raw_resolved_name,
      public.kpi_normalize_person_name(public.kpi_rh_base_name(b.mechanic_name)) raw_resolved_key
    from public.kpi_billed_time_facts b
    where b.source_name='Direct Temps pointé facturé'
      and ((v_sold_hash is not null and b.source_file_sha256=v_sold_hash)
        or (v_sold_hash is null and coalesce(b.invoice_date,b.work_date)>=v_start and coalesce(b.invoice_date,b.work_date)<v_end))
  ), billed_resolved as (
    select b.*,coalesce(sd.full_name,b.raw_resolved_name) resolved_name,coalesce(sd.name_key,b.raw_resolved_key) resolved_key
    from billed_base b
    left join lateral (
      select d.full_name,d.name_key
      from public.kpi_rh_staff_dimension d
      where nullif(btrim(b.matricule),'') is not null and d.matricule=btrim(b.matricule)
      order by (d.name_key=b.raw_resolved_key) desc,d.active desc nulls last,d.source_updated_at desc nulls last,d.employee_key
      limit 1
    ) sd on true
  ), sold0 as (
    select coalesce(b.invoice_date,b.work_date) work_date,b.resolved_name mechanic_name,b.resolved_key name_key,
      coalesce(b.team_code,a.team_code,d.team_code,'NON_AFFECTEE') team_code,
      case when a.scope='fixline' then 'carrosserie' else coalesce(b.sector_key,d.sector_key,'non_classe') end sector_key,
      case when a.scope='fixline' then 'Carrosserie' else coalesce(b.sector_label,d.sector_label,'Non classé') end sector_label,
      case when a.scope='fixline' then 'fixline' else coalesce(b.workcenter_key,d.workcenter_key,b.sector_key,'non_classe') end workcenter_key,
      case when a.scope='fixline' then 'Fixline' else coalesce(d.workcenter_label,b.sector_label,'Non classé') end workcenter_label,
      b.labor_hours sold_hours
    from billed_resolved b
    left join public.kpi_productivity_team_assignment a on a.name_key=b.resolved_key and a.active
    left join dominant d on d.name_key=b.resolved_key
  ), sold as (
    select name_key,max(mechanic_name) mechanic_name,team_code,sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,sum(sold_hours) sold_hours
    from sold0 group by name_key,team_code,sector_key,workcenter_key
  ), dims as (
    select name_key,mechanic_name,team_code,sector_key,sector_label,workcenter_key,workcenter_label from presence
    union
    select name_key,mechanic_name,team_code,sector_key,sector_label,workcenter_key,workcenter_label from sold
  ), detail as (
    select d.name_key,max(d.mechanic_name) mechanic_name,d.team_code,d.sector_key,max(d.sector_label) sector_label,d.workcenter_key,max(d.workcenter_label) workcenter_label,
      coalesce(max(p.bought_hours),0) bought_hours,coalesce(max(s.sold_hours),0) sold_hours,(d.workcenter_key<>'fixline') individual_available
    from dims d
    left join presence p using(name_key,team_code,sector_key,workcenter_key)
    left join sold s using(name_key,team_code,sector_key,workcenter_key)
    group by d.name_key,d.team_code,d.sector_key,d.workcenter_key
  ), sectors as (
    select sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,sum(bought_hours) bought_hours,sum(sold_hours) sold_hours from detail group by sector_key,workcenter_key
  ), teams as (
    select sector_key,max(sector_label) sector_label,workcenter_key,max(workcenter_label) workcenter_label,team_code,sum(bought_hours) bought_hours,sum(sold_hours) sold_hours from detail group by sector_key,workcenter_key,team_code
  ), available_months as (
    select distinct month_key from (
      select to_char(date_trunc('month',work_date)::date,'YYYY-MM') month_key from public.kpi_sql_presence_facts where work_date is not null
      union all
      select to_char(date_trunc('month',min_date)::date,'YYYY-MM') month_key from public.kpi_ops_import_batches where source_key='billed_time' and status='imported' and min_date is not null
    ) x
  )
  select jsonb_build_object(
    'month',to_char(v_start,'YYYY-MM'),
    'period',jsonb_build_object('valid',v_period_valid,'start',case when v_period_valid then to_char(v_period_start,'YYYY-MM-DD') else null end,'end',case when v_period_valid then to_char(v_period_end,'YYYY-MM-DD') else null end,'reason',v_period_reason,'billedFilename',case when v_batch.id is not null then v_batch.filename else null end,'billedImportedAt',case when v_batch.id is not null then v_batch.completed_at else null end),
    'sourceStatus',jsonb_build_object('presence',exists(select 1 from presence),'billedTime',v_has_sold,'comparable',v_period_valid),
    'availableMonths',coalesce((select jsonb_agg(month_key order by month_key desc) from available_months),'[]'::jsonb),
    'totals',jsonb_build_object('boughtHours',round(coalesce((select sum(bought_hours) from detail),0),2),'soldHours',round(coalesce((select sum(sold_hours) from detail),0),2),'productivity',case when v_has_sold and v_period_valid and coalesce((select sum(bought_hours) from detail),0)>0 then round(coalesce((select sum(sold_hours) from detail),0)/nullif((select sum(bought_hours) from detail),0)*100,1) else null end),
    'sectors',coalesce((select jsonb_agg(jsonb_build_object('sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,'boughtHours',round(bought_hours,2),'soldHours',round(sold_hours,2),'productivity',case when v_has_sold and v_period_valid and bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end) order by sector_label,workcenter_label) from sectors),'[]'::jsonb),
    'teams',coalesce((select jsonb_agg(jsonb_build_object('sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,'teamCode',team_code,'boughtHours',round(bought_hours,2),'soldHours',round(sold_hours,2),'productivity',case when v_has_sold and v_period_valid and bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end) order by sector_label,workcenter_label,team_code) from teams),'[]'::jsonb),
    'collaborators',coalesce((select jsonb_agg(jsonb_build_object('nameKey',name_key,'mechanicName',mechanic_name,'teamCode',team_code,'sectorKey',sector_key,'sectorLabel',sector_label,'workcenterKey',workcenter_key,'workcenterLabel',workcenter_label,'boughtHours',round(bought_hours,2),'soldHours',case when individual_available then round(sold_hours,2) else null end,'productivity',case when v_has_sold and v_period_valid and individual_available and bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end,'individualAvailable',individual_available) order by sector_label,workcenter_label,mechanic_name) from detail),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.kpi_productivity_month(p_session_hash text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user record;
  v_scopes text[];
  v_all boolean;
  v_raw jsonb;
  v_sectors jsonb;
  v_teams jsonb;
  v_collabs jsonb;
  v_bought numeric:=0;
  v_sold numeric:=0;
  v_has_sold boolean:=false;
  v_comparable boolean:=false;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  select case when u.role='admin' then array['*']::text[] else coalesce(u.productivity_scopes,array[]::text[]) end into v_scopes from public.crvo_auth_users u where u.id=v_user.user_id;
  v_all:=v_user.role='admin' or '*'=any(coalesce(v_scopes,array[]::text[]));
  v_raw:=public.kpi_productivity_month_unscoped(p_session_hash,p_month);
  if v_all then return v_raw||jsonb_build_object('allowedSectors',jsonb_build_array('*')); end if;

  select coalesce(jsonb_agg(x.item order by x.item->>'sectorLabel',x.item->>'workcenterLabel'),'[]'::jsonb) into v_sectors from jsonb_array_elements(coalesce(v_raw->'sectors','[]'::jsonb)) x(item) where x.item->>'sectorKey'=any(coalesce(v_scopes,array[]::text[]));
  select coalesce(jsonb_agg(x.item order by x.item->>'sectorLabel',x.item->>'workcenterLabel',x.item->>'teamCode'),'[]'::jsonb) into v_teams from jsonb_array_elements(coalesce(v_raw->'teams','[]'::jsonb)) x(item) where x.item->>'sectorKey'=any(coalesce(v_scopes,array[]::text[]));
  select coalesce(jsonb_agg(x.item order by x.item->>'sectorLabel',x.item->>'workcenterLabel',x.item->>'mechanicName'),'[]'::jsonb) into v_collabs from jsonb_array_elements(coalesce(v_raw->'collaborators','[]'::jsonb)) x(item) where x.item->>'sectorKey'=any(coalesce(v_scopes,array[]::text[]));
  select coalesce(sum((x.item->>'boughtHours')::numeric),0),coalesce(sum((x.item->>'soldHours')::numeric),0) into v_bought,v_sold from jsonb_array_elements(v_sectors) x(item);
  v_has_sold:=coalesce((v_raw->'sourceStatus'->>'billedTime')::boolean,false);
  v_comparable:=coalesce((v_raw->'period'->>'valid')::boolean,false);

  return jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_raw,'{sectors}',v_sectors,true),'{teams}',v_teams,true),'{collaborators}',v_collabs,true),'{totals}',jsonb_build_object('boughtHours',round(v_bought,2),'soldHours',round(v_sold,2),'productivity',case when v_has_sold and v_comparable and v_bought>0 then round(v_sold/v_bought*100,1) else null end),true)||jsonb_build_object('allowedSectors',to_jsonb(coalesce(v_scopes,array[]::text[])));
end $$;

revoke all on function public.kpi_productivity_month_unscoped(text,date) from public;
grant execute on function public.kpi_productivity_month_unscoped(text,date) to anon,authenticated,service_role;
revoke all on function public.kpi_productivity_month(text,date) from public;
grant execute on function public.kpi_productivity_month(text,date) to anon,authenticated,service_role;
