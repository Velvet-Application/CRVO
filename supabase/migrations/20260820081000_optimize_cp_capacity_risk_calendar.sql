create or replace function public.kpi_worktime_leave_dashboard_v3(
  p_session_hash text,
  p_from date,
  p_to date,
  p_team text default null,
  p_sector text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_base jsonb;
  v_user public.crvo_auth_users%rowtype;
  v_scope record;
  v_from date:=coalesce(p_from,(now() at time zone 'Europe/Paris')::date);
  v_to date:=coalesce(p_to,v_from);
  v_today date:=(now() at time zone 'Europe/Paris')::date;
  v_ref_end date;
  v_ref_start date;
  v_team text:=nullif(trim(coalesce(p_team,'')),'');
  v_sector text:=nullif(trim(coalesce(p_sector,'')),'');
  v_effective_sector text;
  v_people jsonb:='[]'::jsonb;
  v_calendar jsonb:='[]'::jsonb;
  v_productive_sectors text[]:=array['expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo'];
begin
  if v_to<v_from or v_to-v_from>62 then raise exception 'Période invalide (63 jours maximum).' using errcode='22023'; end if;
  if v_team='*' then v_team:=null; end if;
  if v_sector='*' then v_sector:=null; end if;
  v_ref_end:=least(v_to,v_today)-1;
  v_ref_start:=v_ref_end-9;

  v_base:=public.kpi_worktime_leave_dashboard(p_session_hash,v_from,v_to,v_team,v_sector);

  select u.* into v_user
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;

  if v_sector is not null and v_sector=any(v_productive_sectors) then
    v_effective_sector:=v_sector;
  else
    with scope_sectors as (
      select distinct case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end sector_key
      from public.kpi_staff_effective e
      where e.active and e.team_code in ('A','B','C') and e.primary_population in ('productif','fixline')
        and not coalesce(e.neutralized,false)
        and (v_scope.all_access or '*'=any(v_scope.team_codes) or e.team_code=any(v_scope.team_codes))
        and (v_scope.all_access or '*'=any(v_scope.sector_keys) or (case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end)=any(v_scope.sector_keys))
        and (v_team is null or e.team_code=v_team)
    ), prod as (select sector_key from scope_sectors where sector_key=any(v_productive_sectors))
    select case when count(*)=1 then min(sector_key) else null end into v_effective_sector from prod;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeKey',p.employee_key,'name',p.employee_name,'matricule',p.matricule,
    'team',p.team_code,'service',p.service,'sector',p.sector_key,'jobTitle',null
  ) order by p.employee_name),'[]'::jsonb)
  into v_people
  from public.kpi_worktime_population_for_date(greatest(v_from,v_today)) p
  where (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
    and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
    and (v_team is null or p.team_code=v_team)
    and (v_sector is null or p.sector_key=v_sector);

  with
  dates as (select gs::date work_date from generate_series(v_from,v_to,interval '1 day') gs),
  roster as materialized (
    select e.employee_key,e.full_name,e.name_key,e.team_code,
      case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end sector_key
    from public.kpi_staff_effective e
    where e.active and e.team_code in ('A','B','C') and e.primary_population in ('productif','fixline')
      and not coalesce(e.neutralized,false)
      and (case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end)=any(v_productive_sectors)
  ),
  selected_roster as materialized (
    select r.* from roster r
    where (v_scope.all_access or '*'=any(v_scope.team_codes) or r.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or r.sector_key=any(v_scope.sector_keys))
      and (v_team is null or r.team_code=v_team)
      and (v_sector is null or r.sector_key=v_sector)
  ),
  absence_sources as materialized (
    select r.employee_key,public.kpi_normalize_person_name(r.employee_name) name_key,r.start_date,r.end_date
    from public.kpi_worktime_rh_event_source r
    where r.entity='CRVO' and r.event_kind='absence' and r.start_date<=v_to and r.end_date>=v_from
    union all
    select e.employee_key,public.kpi_normalize_person_name(e.employee_name),e.start_date,e.end_date
    from public.kpi_worktime_events e
    where e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and e.start_date<=v_to and e.end_date>=v_from
    union all
    select l.employee_key,public.kpi_normalize_person_name(l.employee_name),l.start_date,l.end_date
    from public.kpi_worktime_leave_requests l
    where l.entity='CRVO' and l.status='approved' and l.start_date<=v_to and l.end_date>=v_from
  ),
  pending_sources as materialized (
    select l.employee_key,public.kpi_normalize_person_name(l.employee_name) name_key,l.start_date,l.end_date
    from public.kpi_worktime_leave_requests l
    where l.entity='CRVO' and l.status='pending' and l.start_date<=v_to and l.end_date>=v_from
  ),
  selected_absent as materialized (
    select distinct d.work_date,r.employee_key
    from dates d cross join selected_roster r
    join absence_sources a on d.work_date between a.start_date and a.end_date
      and (a.employee_key=r.employee_key or (a.name_key is not null and a.name_key=r.name_key))
  ),
  selected_pending as materialized (
    select distinct d.work_date,r.employee_key
    from dates d cross join selected_roster r
    join pending_sources l on d.work_date between l.start_date and l.end_date
      and (l.employee_key=r.employee_key or (l.name_key is not null and l.name_key=r.name_key))
    where not exists(select 1 from selected_absent a where a.work_date=d.work_date and a.employee_key=r.employee_key)
  ),
  productive_counts as (
    select d.work_date,
      (select count(*) from selected_roster)::int productive_total,
      ((select count(*) from selected_roster)-count(distinct a.employee_key))::int productive_present,
      count(distinct p.employee_key)::int productive_pending,
      (select count(*) from roster)::int global_productive_total,
      (select count(*) from roster r2 where v_effective_sector is not null and r2.sector_key=v_effective_sector)::int global_sector_total
    from dates d
    left join selected_absent a on a.work_date=d.work_date
    left join selected_pending p on p.work_date=d.work_date
    group by d.work_date
  ),
  objectives as (
    select d.work_date,
      coalesce(
        case when v_effective_sector is not null then (select o.daily_target from public.kpi_monthly_objectives o where o.month=date_trunc('month',d.work_date)::date and o.sector_key=v_effective_sector limit 1) end,
        (select x.target_value from public.kpi_daily_exit_objectives x where x.target_date=d.work_date limit 1),
        (select o.daily_target from public.kpi_monthly_objectives o where o.month=date_trunc('month',d.work_date)::date and o.sector_key='sortie_usine' limit 1)
      )::numeric base_target
    from dates d
  ),
  latest_billed as (
    select b.file_sha256 from public.kpi_ops_import_batches b
    where b.source_key='billed_time' and b.status='imported'
    order by b.completed_at desc nulls last,b.created_at desc limit 1
  ),
  invoice_orders as materialized (
    select i.work_order,min(i.invoice_date)::date invoice_date
    from public.kpi_invoice_facts i
    where i.invoice_date between v_ref_start and v_ref_end and nullif(trim(i.work_order),'') is not null
    group by i.work_order
  ),
  sector_ref as (
    select case when v_effective_sector is null then null else sum(f.labor_hours)::numeric/nullif(count(distinct f.work_order),0) end avg_hours_per_vehicle
    from public.kpi_billed_time_facts f
    join invoice_orders i on i.work_order=f.work_order
    where v_effective_sector is not null and f.sector_key=v_effective_sector
      and ((select file_sha256 from latest_billed) is null or f.source_file_sha256=(select file_sha256 from latest_billed))
      and nullif(trim(f.work_order),'') is not null
  ),
  ranked_snapshots as materialized (
    select s.snapshot_at,s.metrics,
      row_number() over(partition by s.snapshot_at order by case when s.source_name ilike 'FTP CRVO%' then 0 else 1 end,case when s.source_name ilike '%clôture%' then 0 else 1 end,s.source_name) rn
    from public.kpi_public_dashboard_snapshots s
    where s.snapshot_at between v_ref_start and v_ref_end
  ),
  site_ref as (
    select
      (select avg(nullif(r.metrics->>'exits_vop','')::numeric) from ranked_snapshots r where r.rn=1 and extract(isodow from r.snapshot_at) between 1 and 5 and nullif(r.metrics->>'exits_vop','') is not null) avg_exits,
      (select avg(x.available_etp) from (
        select f.work_date,sum(f.time_value)::numeric/7.5 available_etp
        from public.kpi_sql_presence_facts f
        join public.kpi_rh_presence_code_map m on m.time_code=f.time_code and m.counts_as_presence and not m.excluded
        where f.work_date between v_ref_start and v_ref_end and extract(isodow from f.work_date) between 1 and 5
          and m.sector_key in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo')
        group by f.work_date
      ) x where x.available_etp>0) avg_available_etp
  ),
  risk_rows as (
    select c.work_date,c.productive_total,
      greatest(c.productive_present-c.productive_pending,0)::int productive_remaining,
      case when coalesce(o.base_target,0)<=0 then 0::numeric
           when v_effective_sector is not null then o.base_target*c.productive_total::numeric/nullif(c.global_sector_total,0)
           else o.base_target*c.productive_total::numeric/nullif(c.global_productive_total,0) end required_volume,
      case when v_effective_sector is not null and sr.avg_hours_per_vehicle>0 then greatest(c.productive_present-c.productive_pending,0)*7.5/sr.avg_hours_per_vehicle
           when v_effective_sector is null and site.avg_available_etp>0 and site.avg_exits is not null then greatest(c.productive_present-c.productive_pending,0)*site.avg_exits/site.avg_available_etp
           else null end capacity_vehicles,
      sr.avg_hours_per_vehicle
    from productive_counts c cross join sector_ref sr cross join site_ref site join objectives o using(work_date)
  ),
  risk_json as (
    select r.*,
      case when coalesce(r.required_volume,0)<=0 then 0::numeric
           when coalesce(r.capacity_vehicles,0)<=0 then 100::numeric
           else least(100,round(100*r.required_volume/r.capacity_vehicles,0)) end risk_pct
    from risk_rows r
  )
  select coalesce(jsonb_agg(
    b.item || jsonb_build_object(
      'productiveTotal',r.productive_total,
      'productiveRemainingIfAccepted',r.productive_remaining,
      'requiredVolume',round(r.required_volume,1),
      'capacityVehicles',case when r.capacity_vehicles is null then null else round(r.capacity_vehicles,1) end,
      'loadPct',case when coalesce(r.required_volume,0)<=0 or coalesce(r.capacity_vehicles,0)<=0 then null else round(100*r.required_volume/r.capacity_vehicles,1) end,
      'riskPct',r.risk_pct,
      'risk',case when r.risk_pct>=90 then 'critical' when r.risk_pct>=70 then 'warning' else 'ok' end,
      'riskBasis',case when v_effective_sector is not null then 'activity' else 'site' end,
      'targetSource',case when v_effective_sector is not null then 'Objectif métier mensuel réparti au prorata des productifs directs/Fixline du filtre' else 'Objectif Sortie usine journalier réparti au prorata des productifs directs/Fixline du filtre' end,
      'capacityReferenceHours',case when r.avg_hours_per_vehicle is null then null else round(r.avg_hours_per_vehicle,3) end
    ) order by (b.item->>'date')::date
  ),'[]'::jsonb)
  into v_calendar
  from jsonb_array_elements(coalesce(v_base->'calendar','[]'::jsonb)) b(item)
  join risk_json r on r.work_date=(b.item->>'date')::date;

  v_base:=jsonb_set(v_base,'{people}',v_people,true);
  v_base:=jsonb_set(v_base,'{calendar}',v_calendar,true);
  v_base:=jsonb_set(v_base,'{volumeRisk}',jsonb_build_object(
    'enabled',true,'effectiveSector',v_effective_sector,'referenceStart',v_ref_start,'referenceEnd',v_ref_end,
    'method','Indice de tension = volume théorique à traiter / capacité disponible. 70 % = à surveiller, 90 % = critique. Ce n’est pas une probabilité statistique.'
  ),true);
  return v_base;
end
$$;

grant execute on function public.kpi_worktime_leave_dashboard_v3(text,date,date,text,text) to anon,authenticated,service_role;
