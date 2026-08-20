create or replace function public.kpi_worktime_leave_day_risk(
  p_session_hash text,
  p_date date,
  p_team text default null,
  p_sector text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_scope record;
  v_day date:=coalesce(p_date,(now() at time zone 'Europe/Paris')::date);
  v_team text:=nullif(trim(coalesce(p_team,'')),'');
  v_sector text:=nullif(trim(coalesce(p_sector,'')),'');
  v_known text[]:=array['expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo'];
  v_effective_sector text;
  v_sector_count integer:=0;
  v_total integer:=0;
  v_unavailable integer:=0;
  v_pending integer:=0;
  v_remaining integer:=0;
  v_global_total integer:=0;
  v_global_sector_total integer:=0;
  v_target numeric;
  v_required numeric;
  v_ref_hours numeric;
  v_avg_exits numeric;
  v_avg_etp numeric;
  v_capacity numeric;
  v_load numeric;
  v_risk numeric;
  v_billed_hash text;
begin
  if v_team='*' then v_team:=null; end if;
  if v_sector='*' then v_sector:=null; end if;

  select u.* into v_user
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,'CRVO') limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;

  if v_sector is not null and not(v_sector=any(v_known)) then
    return jsonb_build_object('enabled',false,'riskPct',null,'loadPct',null,'requiredVolume',null,'capacityVehicles',null,'targetSource','Aucun objectif volume configuré pour ce secteur');
  end if;

  if v_sector=any(v_known) then
    v_effective_sector:=v_sector;
  else
    select count(distinct s.sector_key),min(s.sector_key) into v_sector_count,v_effective_sector
    from (
      select e.team_code,
        case when e.primary_population='fixline' then 'carrosserie' when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end sector_key
      from public.kpi_staff_effective e
      where e.team_code in ('A','B','C') and e.primary_population in ('productif','fixline') and not coalesce(e.neutralized,false)
        and coalesce(e.entry_date,date '1900-01-01')<=v_day and (e.exit_date is null or e.exit_date>=v_day)
        and (v_day<(now() at time zone 'Europe/Paris')::date or e.active)
    ) s
    where s.sector_key=any(v_known)
      and (v_scope.all_access or '*'=any(v_scope.team_codes) or s.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or s.sector_key=any(v_scope.sector_keys))
      and (v_team is null or s.team_code=v_team);
    if v_sector_count<>1 then v_effective_sector:=null; end if;
  end if;

  with population as (
    select e.employee_key,e.matricule,e.team_code,
      case when e.primary_population='fixline' then 'carrosserie' when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end sector_key
    from public.kpi_staff_effective e
    where e.team_code in ('A','B','C') and e.primary_population in ('productif','fixline') and not coalesce(e.neutralized,false)
      and coalesce(e.entry_date,date '1900-01-01')<=v_day and (e.exit_date is null or e.exit_date>=v_day)
      and (v_day<(now() at time zone 'Europe/Paris')::date or e.active)
  ), selected as (
    select p.* from population p
    where p.sector_key=any(v_known)
      and (v_scope.all_access or '*'=any(v_scope.team_codes) or p.team_code=any(v_scope.team_codes))
      and (v_scope.all_access or '*'=any(v_scope.sector_keys) or p.sector_key=any(v_scope.sector_keys))
      and (v_team is null or p.team_code=v_team) and (v_sector is null or p.sector_key=v_sector)
  ), flagged as (
    select p.*,
      (
        exists(select 1 from public.kpi_worktime_rh_event_source r where r.entity='CRVO' and r.event_kind='absence' and v_day between r.start_date and r.end_date and (r.employee_key=p.employee_key or (r.employee_key like 'matricule:%' and substring(r.employee_key from 11)=p.matricule)))
        or exists(select 1 from public.kpi_worktime_events e where e.entity='CRVO' and e.event_kind='absence' and e.status<>'cancelled' and v_day between e.start_date and e.end_date and (e.employee_key=p.employee_key or (e.employee_key like 'matricule:%' and substring(e.employee_key from 11)=p.matricule)))
        or exists(select 1 from public.kpi_worktime_leave_requests l where l.entity='CRVO' and l.status='approved' and v_day between l.start_date and l.end_date and (l.employee_key=p.employee_key or (l.employee_key like 'matricule:%' and substring(l.employee_key from 11)=p.matricule)))
      ) as unavailable,
      exists(select 1 from public.kpi_worktime_leave_requests l where l.entity='CRVO' and l.status='pending' and v_day between l.start_date and l.end_date and (l.employee_key=p.employee_key or (l.employee_key like 'matricule:%' and substring(l.employee_key from 11)=p.matricule))) as pending
    from selected p
  )
  select count(*)::int,count(*) filter(where unavailable)::int,count(*) filter(where pending and not unavailable)::int
  into v_total,v_unavailable,v_pending from flagged;

  v_remaining:=greatest(v_total-v_unavailable-v_pending,0);

  select count(*)::int,count(*) filter(where v_effective_sector is not null and s.sector_key=v_effective_sector)::int
  into v_global_total,v_global_sector_total
  from (
    select case when e.primary_population='fixline' then 'carrosserie' when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end sector_key
    from public.kpi_staff_effective e
    where e.team_code in ('A','B','C') and e.primary_population in ('productif','fixline') and not coalesce(e.neutralized,false)
      and coalesce(e.entry_date,date '1900-01-01')<=v_day and (e.exit_date is null or e.exit_date>=v_day)
      and (v_day<(now() at time zone 'Europe/Paris')::date or e.active)
  ) s where s.sector_key=any(v_known);

  if v_effective_sector is not null then
    select o.daily_target into v_target from public.kpi_monthly_objectives o where o.month=date_trunc('month',v_day)::date and o.sector_key=v_effective_sector limit 1;
    v_required:=case when coalesce(v_target,0)<=0 or v_global_sector_total<=0 then 0 else v_target*v_total::numeric/v_global_sector_total end;

    select b.file_sha256 into v_billed_hash from public.kpi_ops_import_batches b where b.source_key='billed_time' and b.status='imported' order by b.completed_at desc nulls last,b.created_at desc limit 1;
    select sum(f.labor_hours)::numeric/nullif(count(distinct f.work_order),0) into v_ref_hours
    from public.kpi_billed_time_facts f
    where f.sector_key=v_effective_sector and (v_billed_hash is null or f.source_file_sha256=v_billed_hash) and nullif(trim(f.work_order),'') is not null
      and exists(select 1 from public.kpi_invoice_facts i where i.work_order=f.work_order and i.invoice_date between v_day-10 and v_day-1);
    if coalesce(v_ref_hours,0)>0 then v_capacity:=v_remaining*7.5/v_ref_hours; end if;
  else
    select x.target_value into v_target from public.kpi_daily_exit_objectives x where x.target_date=v_day limit 1;
    if v_target is null then select o.daily_target into v_target from public.kpi_monthly_objectives o where o.month=date_trunc('month',v_day)::date and o.sector_key='sortie_usine' limit 1; end if;
    v_required:=case when coalesce(v_target,0)<=0 or v_global_total<=0 then 0 else v_target*v_total::numeric/v_global_total end;

    with ranked as (
      select distinct on (s.snapshot_at) s.snapshot_at,s.metrics
      from public.kpi_public_dashboard_snapshots s
      where s.snapshot_at between v_day-10 and v_day-1 and extract(isodow from s.snapshot_at) between 1 and 5
      order by s.snapshot_at,case when s.source_name ilike 'FTP CRVO%' then 0 else 1 end,case when s.source_name ilike '%clôture%' then 0 else 1 end,s.source_name
    ) select avg(nullif(metrics->>'exits_vop','')::numeric) into v_avg_exits from ranked where nullif(metrics->>'exits_vop','') is not null;

    with presence_daily as (
      select f.work_date,sum(f.time_value)::numeric/7.5 available_etp
      from public.kpi_sql_presence_facts f join public.kpi_rh_presence_code_map m on m.time_code=f.time_code and m.counts_as_presence and not m.excluded
      where f.work_date between v_day-10 and v_day-1 and extract(isodow from f.work_date) between 1 and 5 and m.sector_key=any(v_known)
      group by f.work_date
    ) select avg(available_etp) into v_avg_etp from presence_daily where available_etp>0;
    if coalesce(v_avg_etp,0)>0 and v_avg_exits is not null then v_capacity:=v_remaining*v_avg_exits/v_avg_etp; end if;
  end if;

  if coalesce(v_required,0)<=0 then v_load:=0;v_risk:=0;
  elsif coalesce(v_capacity,0)<=0 then v_load:=null;v_risk:=100;
  else v_load:=round(100*v_required/v_capacity,1);v_risk:=least(100,round(v_load,0)); end if;

  return jsonb_build_object(
    'enabled',true,'productiveTotal',v_total,'productiveRemainingIfAccepted',v_remaining,
    'requiredVolume',round(coalesce(v_required,0),1),'capacityVehicles',case when v_capacity is null then null else round(v_capacity,1) end,
    'capacityReferenceHours',case when v_ref_hours is null then null else round(v_ref_hours,3) end,
    'loadPct',v_load,'riskPct',v_risk,'risk',case when v_risk>=90 then 'critical' when v_risk>=70 then 'warning' else 'ok' end,
    'riskBasis',case when v_effective_sector is null then 'site' else 'activity' end,
    'targetSource',case when v_effective_sector is null then 'Objectif Sortie usine journalier réparti au prorata des productifs directs/Fixline du filtre' else 'Objectif métier mensuel réparti au prorata des productifs directs/Fixline du filtre' end,
    'method','Risque capacitaire = volume théorique à traiter / capacité disponible. Il s’agit d’un indice de tension, pas d’une probabilité statistique.'
  );
end
$$;

create or replace function public.kpi_worktime_leave_day_detail_v2(p_session_hash text,p_date date,p_team text default null,p_sector text default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_detail jsonb;
  v_risk jsonb;
begin
  v_detail:=public.kpi_worktime_leave_day_detail(p_session_hash,p_date,p_team,p_sector);
  v_risk:=public.kpi_worktime_leave_day_risk(p_session_hash,p_date,p_team,p_sector);
  return jsonb_set(v_detail,'{risk}',v_risk,true);
end
$$;

revoke all on function public.kpi_worktime_leave_day_risk(text,date,text,text) from public;
revoke all on function public.kpi_worktime_leave_day_detail_v2(text,date,text,text) from public;
grant execute on function public.kpi_worktime_leave_day_risk(text,date,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_worktime_leave_day_detail_v2(text,date,text,text) to anon,authenticated,service_role;
