create or replace function public.kpi_is_productive_sector(p_sector_key text)
returns boolean
language sql
immutable
set search_path='public'
as $$
  select coalesce(p_sector_key,'') = any(array[
    'expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo'
  ]::text[])
$$;

create or replace function public.kpi_productivity_month(p_session_hash text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user record; v_scopes text[]; v_all boolean; v_raw jsonb;
  v_sectors jsonb; v_teams jsonb; v_collabs jsonb;
  v_bought numeric:=0; v_sold numeric:=0; v_has_sold boolean:=false; v_comparable boolean:=false;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  select case when u.role='admin' then array['*']::text[] else coalesce(u.productivity_scopes,array[]::text[]) end into v_scopes
  from public.crvo_auth_users u where u.id=v_user.user_id;
  v_all := v_user.role='admin' or '*'=any(coalesce(v_scopes,array[]::text[]));
  v_raw := public.kpi_productivity_month_unscoped(p_session_hash,p_month);

  select coalesce(jsonb_agg(x.item order by x.item->>'sectorLabel',x.item->>'workcenterLabel'),'[]'::jsonb) into v_sectors
  from jsonb_array_elements(coalesce(v_raw->'sectors','[]'::jsonb)) x(item)
  where public.kpi_is_productive_sector(x.item->>'sectorKey') and (v_all or x.item->>'sectorKey'=any(coalesce(v_scopes,array[]::text[])));
  select coalesce(jsonb_agg(x.item order by x.item->>'sectorLabel',x.item->>'workcenterLabel',x.item->>'teamCode'),'[]'::jsonb) into v_teams
  from jsonb_array_elements(coalesce(v_raw->'teams','[]'::jsonb)) x(item)
  where public.kpi_is_productive_sector(x.item->>'sectorKey') and (v_all or x.item->>'sectorKey'=any(coalesce(v_scopes,array[]::text[])));
  select coalesce(jsonb_agg(x.item order by x.item->>'sectorLabel',x.item->>'workcenterLabel',x.item->>'mechanicName'),'[]'::jsonb) into v_collabs
  from jsonb_array_elements(coalesce(v_raw->'collaborators','[]'::jsonb)) x(item)
  where public.kpi_is_productive_sector(x.item->>'sectorKey') and (v_all or x.item->>'sectorKey'=any(coalesce(v_scopes,array[]::text[])));
  select coalesce(sum((x.item->>'boughtHours')::numeric),0),coalesce(sum((x.item->>'soldHours')::numeric),0) into v_bought,v_sold
  from jsonb_array_elements(v_sectors) x(item);
  v_has_sold:=coalesce((v_raw->'sourceStatus'->>'billedTime')::boolean,false);
  v_comparable:=coalesce((v_raw->'period'->>'valid')::boolean,false);
  return jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_raw,'{sectors}',v_sectors,true),'{teams}',v_teams,true),'{collaborators}',v_collabs,true),'{totals}',jsonb_build_object(
    'boughtHours',round(v_bought,2),'soldHours',round(v_sold,2),
    'productivity',case when v_has_sold and v_comparable and v_bought>0 then round(v_sold/v_bought*100,1) else null end
  ),true) || jsonb_build_object('allowedSectors',case when v_all then jsonb_build_array('*') else to_jsonb(coalesce(v_scopes,array[]::text[])) end,'productiveOnly',true);
end
$$;

create or replace function public.kpi_capacity_simple(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user record; v_batch record; v_period_start date; v_period_end date;
  v_today date := (timezone('Europe/Paris',now()))::date; v_result jsonb;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select b.id,b.filename,b.file_sha256,b.completed_at into v_batch
  from public.kpi_ops_import_batches b where b.source_key='billed_time' and b.status='imported'
  order by b.completed_at desc nulls last,b.created_at desc limit 1;
  if v_batch.id is null then return jsonb_build_object('connected',false,'error','Aucun fichier Temps pointé facturé certifié.'); end if;
  select min(nullif(f.metadata->>'period_start','')::date),max(nullif(f.metadata->>'period_end','')::date) into v_period_start,v_period_end
  from public.kpi_billed_time_facts f where f.source_name='Direct Temps pointé facturé' and f.source_file_sha256=v_batch.file_sha256;
  if v_period_start is null or v_period_end is null or v_period_start>v_period_end or v_period_end>v_today then
    return jsonb_build_object('connected',false,'error','La période du fichier Temps pointé facturé n''est pas certifiée.','period',jsonb_build_object('start',v_period_start,'end',v_period_end,'valid',false));
  end if;

  with sector_defs(sector_key,sector_label,mini_standard_hours) as (
    values ('expertise','Expertise',null::numeric),('mecanique','Mécanique',1.17::numeric),('dsp','DSP',null::numeric),('jantes','Jantes',null::numeric),
      ('carrosserie','Carrosserie',7.92::numeric),('preparation','Préparation',null::numeric),('qualite','Qualité',null::numeric),('photo','Photo',null::numeric)
  ), presence_base as (
    select p.work_date,m.sector_key,public.kpi_normalize_person_name(public.kpi_rh_base_name(p.mechanic_name)) name_key,p.time_value::numeric hours
    from public.kpi_sql_presence_facts p join public.kpi_rh_presence_code_map m on m.time_code=p.time_code and m.counts_as_presence and not m.excluded
    join sector_defs d on d.sector_key=m.sector_key where p.work_date between v_period_start and v_period_end
  ), presence_sector as (
    select sector_key,sum(hours)::numeric bought_hours,count(distinct name_key)::numeric people from presence_base group by sector_key
  ), presence_days as (
    select count(distinct work_date)::numeric days from presence_base where extract(isodow from work_date)<7
  ), sold_sector as (
    select f.sector_key,sum(f.labor_hours)::numeric sold_hours from public.kpi_billed_time_facts f join sector_defs d on d.sector_key=f.sector_key
    where f.source_name='Direct Temps pointé facturé' and f.source_file_sha256=v_batch.file_sha256 group by f.sector_key
  ), core_source as (
    select s.snapshot_at,s.metrics,case when extract(isodow from s.snapshot_at)=6 then s.snapshot_at-1 else s.snapshot_at end effective_date
    from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_period_start and v_period_end and extract(isodow from s.snapshot_at) between 1 and 6
  ), core_daily as (
    select effective_date,sum(coalesce((metrics->>'entries_vop')::numeric,0))::numeric entries,
      sum(coalesce((metrics->>'production_expertise')::numeric,0))::numeric expertise,sum(coalesce((metrics->>'production_mechanics')::numeric,0))::numeric mecanique,
      sum(coalesce((metrics->>'production_dsp')::numeric,0))::numeric dsp,sum(coalesce((metrics->>'production_bodywork')::numeric,0))::numeric carrosserie,
      sum(coalesce((metrics->>'production_preparation')::numeric,0))::numeric preparation,sum(coalesce((metrics->>'production_quality')::numeric,0))::numeric qualite
    from core_source group by effective_date
  ), core_stats as (
    select count(*)::numeric days,coalesce(sum(entries),0)::numeric entries,coalesce(sum(expertise),0)::numeric expertise,coalesce(sum(mecanique),0)::numeric mecanique,
      coalesce(sum(dsp),0)::numeric dsp,coalesce(sum(carrosserie),0)::numeric carrosserie,coalesce(sum(preparation),0)::numeric preparation,coalesce(sum(qualite),0)::numeric qualite from core_daily
  ), factory_ranked as (
    select f.*,row_number() over(partition by f.production_date,f.flow order by f.source_modified_at desc nulls last,f.created_at desc) rn
    from public.kpi_ftp_factory_production f where f.production_date between v_period_start and v_period_end and extract(isodow from f.production_date) between 1 and 6
  ), factory_daily as (
    select case when extract(isodow from production_date)=6 then production_date-1 else production_date end effective_date,sum(wheels)::numeric wheels,sum(photos)::numeric photos
    from factory_ranked where rn=1 group by 1
  ), factory_stats as (
    select count(*)::numeric days,coalesce(sum(wheels),0)::numeric wheels,coalesce(sum(photos),0)::numeric photos from factory_daily
  ), prod as (
    select 'expertise'::text sector_key,c.expertise volume,c.days from core_stats c union all select 'mecanique',c.mecanique,c.days from core_stats c
    union all select 'dsp',c.dsp,c.days from core_stats c union all select 'carrosserie',c.carrosserie,c.days from core_stats c
    union all select 'preparation',c.preparation,c.days from core_stats c union all select 'qualite',c.qualite,c.days from core_stats c
    union all select 'jantes',f.wheels,f.days from factory_stats f union all select 'photo',f.photos,f.days from factory_stats f
  ), combined as (
    select d.sector_key,d.sector_label,d.mini_standard_hours,coalesce(ps.bought_hours,0)::numeric bought_hours,coalesce(ss.sold_hours,0)::numeric sold_hours,
      coalesce(ps.people,0)::numeric people,coalesce(pd.volume,0)::numeric observed_volume,coalesce(pd.days,0)::numeric production_days,
      coalesce((select days from presence_days),0)::numeric presence_days,case when coalesce(pd.days,0)>0 then pd.volume/pd.days else 0 end::numeric vehicles_per_day,
      case when coalesce((select days from presence_days),0)>0 then coalesce(ps.bought_hours,0)/(select days from presence_days) else 0 end::numeric bought_hours_per_day,
      case when coalesce((select days from presence_days),0)>0 then coalesce(ss.sold_hours,0)/(select days from presence_days) else 0 end::numeric sold_hours_per_day,
      case when coalesce((select days from presence_days),0)>0 then (select c.entries/nullif(c.days,0) from core_stats c) else 0 end::numeric entries_per_day
    from sector_defs d left join presence_sector ps using(sector_key) left join sold_sector ss using(sector_key) left join prod pd using(sector_key)
  ) select jsonb_build_object(
    'connected',true,'period',jsonb_build_object('valid',true,'start',to_char(v_period_start,'YYYY-MM-DD'),'end',to_char(v_period_end,'YYYY-MM-DD'),'billedFilename',v_batch.filename,'billedImportedAt',v_batch.completed_at,'presenceDays',coalesce((select days from presence_days),0),'productionDays',coalesce((select days from core_stats),0)),
    'inputVehiclesPerDay',round(coalesce((select entries/nullif(days,0) from core_stats),0),2),
    'sectors',coalesce((select jsonb_agg(jsonb_build_object('sectorKey',c.sector_key,'sectorLabel',c.sector_label,'etp',round(case when c.presence_days>0 then c.bought_hours/(c.presence_days*7.5) else 0 end,2),'people',c.people,'boughtHours',round(c.bought_hours,2),'soldHours',round(c.sold_hours,2),'boughtHoursPerDay',round(c.bought_hours_per_day,2),'soldHoursPerDay',round(c.sold_hours_per_day,2),'productivity',case when c.bought_hours>0 then round(c.sold_hours/c.bought_hours*100,1) else null end,'observedVehicles',round(c.observed_volume,0),'productionDays',c.production_days,'vehiclesPerDay',round(c.vehicles_per_day,2),'hoursPerProcessedVehicle',case when c.vehicles_per_day>0 then round(c.sold_hours_per_day/c.vehicles_per_day,2) else null end,'miniHoursPerVehicle',case when c.mini_standard_hours is not null then c.mini_standard_hours when c.entries_per_day>0 then round(c.sold_hours_per_day/c.entries_per_day,3) else null end,'miniHourSource',case when c.mini_standard_hours is not null then 'standard_mini_lens' else 'ratio_lens_actuel' end) order by case c.sector_key when 'expertise' then 1 when 'mecanique' then 2 when 'dsp' then 3 when 'jantes' then 4 when 'carrosserie' then 5 when 'preparation' then 6 when 'qualite' then 7 when 'photo' then 8 else 99 end) from combined c),'[]'::jsonb),
    'miniStandard',jsonb_build_object('sampleVehicles',569,'bodyHours',4.61,'paintHours',3.31,'bodyshopHours',7.92,'mechanicsHours',1.17,'damageCount',9.9)
  ) into v_result;
  return v_result;
end
$$;

grant execute on function public.kpi_is_productive_sector(text) to anon,authenticated,service_role;
grant execute on function public.kpi_productivity_month(text,date) to anon,authenticated,service_role;
grant execute on function public.kpi_capacity_simple(text) to anon,authenticated,service_role;
create index if not exists kpi_presence_workdate_timecode_idx on public.kpi_sql_presence_facts(work_date,time_code);
create index if not exists kpi_billed_sourcehash_sector_idx on public.kpi_billed_time_facts(source_file_sha256,sector_key);
create index if not exists kpi_factory_prod_date_flow_idx on public.kpi_ftp_factory_production(production_date,flow,source_modified_at desc);
