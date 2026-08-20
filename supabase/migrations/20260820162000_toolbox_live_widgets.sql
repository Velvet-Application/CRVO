create table if not exists public.kpi_toolbox_widget_preferences (
  user_id uuid primary key references public.crvo_auth_users(id) on delete cascade,
  widget_keys text[] not null default array[]::text[],
  updated_at timestamptz not null default now()
);

alter table public.kpi_toolbox_widget_preferences enable row level security;
revoke all on public.kpi_toolbox_widget_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.kpi_toolbox_widget_preferences to service_role;

create or replace function public.kpi_toolbox_live_widgets(p_session_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_prod boolean := false;
  v_hr boolean := false;
  v_available text[] := array[]::text[];
  v_default text[] := array[]::text[];
  v_saved text[] := array[]::text[];
  v_selected text[] := array[]::text[];
  v_live record;
  v_target numeric;
  v_population integer := 0;
  v_absenteeism_people integer := 0;
  v_unplanned_people integer := 0;
  v_unplanned_hours numeric := 0;
  v_unplanned_etp numeric := 0;
  v_approved_leave integer := 0;
  v_hours_per_vop numeric;
  v_lost_vop numeric;
  v_loss_ref jsonb;
  v_factory_age numeric;
  v_park_age numeric;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  v_prod := v_user.role='admin'
    or '*'=any(coalesce(v_user.page_permissions,array[]::text[]))
    or coalesce(v_user.page_permissions,array[]::text[]) && array['reporting','book','cockpit','bodyshop','intelligence']::text[];
  v_hr := v_user.role='admin'
    or '*'=any(coalesce(v_user.page_permissions,array[]::text[]))
    or coalesce(v_user.page_permissions,array[]::text[]) && array['worktime','data_rh']::text[];

  if v_prod then
    v_available := v_available || array['factory_exits','entries','factory_stock','entry_exit_gap','ftp_freshness']::text[];
  end if;
  if v_hr then
    v_available := v_available || array['absence_rate','unplanned_absence_etp','approved_leave']::text[];
  end if;

  if v_prod and v_hr then
    v_default := array['factory_exits','entries','absence_rate','unplanned_absence_etp']::text[];
  elsif v_prod then
    v_default := array['factory_exits','entries','factory_stock','ftp_freshness']::text[];
  elsif v_hr then
    v_default := array['absence_rate','unplanned_absence_etp','approved_leave']::text[];
  end if;

  select p.widget_keys into v_saved from public.kpi_toolbox_widget_preferences p where p.user_id=v_user.id;
  if v_saved is not null then
    select coalesce(array_agg(x order by ord),array[]::text[]) into v_selected
    from unnest(v_saved) with ordinality as t(x,ord)
    where x=any(v_available);
  end if;
  if cardinality(v_selected)=0 then v_selected:=v_default; end if;

  if v_prod then
    select d.snapshot_at,d.source_name,d.metrics,d.source_modified_at,d.factory_modified_at,d.park_modified_at
      into v_live
    from public.kpi_ftp_live_dashboard d
    where d.snapshot_at=v_today
    order by d.source_modified_at desc nulls last
    limit 1;
    select o.target_value into v_target from public.kpi_daily_exit_objectives o where o.target_date=v_today limit 1;
    if v_live.factory_modified_at is not null then v_factory_age:=extract(epoch from (now()-v_live.factory_modified_at))/60.0; end if;
    if v_live.park_modified_at is not null then v_park_age:=extract(epoch from (now()-v_live.park_modified_at))/60.0; end if;
  end if;

  if v_hr then
    with pop as (
      select p.employee_key from public.kpi_worktime_population_for_date(v_today) p
    ), raw as (
      select r.employee_key,r.event_kind,r.reason_code,
             case when coalesce(r.duration_hours,0)>0 then least(r.duration_hours,7.5) else 7.5 end::numeric as hours
      from public.kpi_worktime_rh_event_source r
      join pop p on p.employee_key=r.employee_key
      where r.entity='CRVO' and r.status='open' and r.start_date<=v_today and r.end_date>=v_today
      union all
      select e.employee_key,e.event_kind,e.reason_code,7.5::numeric as hours
      from public.kpi_worktime_events e
      join pop p on p.employee_key=e.employee_key
      where e.entity='CRVO' and e.status='open' and e.start_date<=v_today and e.end_date>=v_today
    ), per_person as (
      select employee_key,
             max(hours) filter(where event_kind='absence' and reason_code=any(array['sick_received','sick_pending','work_accident','unjustified','pending_qualification']::text[])) as unplanned_hours,
             bool_or(event_kind='absence' and reason_code=any(array['sick_received','sick_pending','long_absence','work_accident','unjustified','pending_qualification']::text[])) as absenteeism
      from raw group by employee_key
    ), leave_people as (
      select distinct r.employee_key
      from raw r
      where r.event_kind='absence' and r.reason_code=any(array['paid_leave','rtt_recovery']::text[])
      union
      select distinct l.employee_key from public.kpi_worktime_leave_requests l
      join pop p on p.employee_key=l.employee_key
      where l.entity='CRVO' and l.status='approved' and l.start_date<=v_today and l.end_date>=v_today
    )
    select
      (select count(*) from pop),
      coalesce((select count(*) from per_person where absenteeism),0),
      coalesce((select count(*) from per_person where coalesce(unplanned_hours,0)>0),0),
      coalesce((select sum(unplanned_hours) from per_person),0),
      coalesce((select sum(unplanned_hours)/7.5 from per_person),0),
      coalesce((select count(*) from leave_people),0)
    into v_population,v_absenteeism_people,v_unplanned_people,v_unplanned_hours,v_unplanned_etp,v_approved_leave;

    begin
      v_loss_ref:=public.kpi_worktime_output_loss_reference(p_session_hash,'CRVO',v_today);
      v_hours_per_vop:=nullif(v_loss_ref->>'hoursPerSiteVop','')::numeric;
      if coalesce(v_hours_per_vop,0)>0 then v_lost_vop:=v_unplanned_hours/v_hours_per_vop; end if;
    exception when others then
      v_hours_per_vop:=null;v_lost_vop:=null;
    end;
  end if;

  return jsonb_build_object(
    'date',v_today,
    'generatedAt',now(),
    'profile',coalesce(v_user.access_profile,'custom'),
    'available',to_jsonb(v_available),
    'selected',to_jsonb(v_selected),
    'maxWidgets',6,
    'metrics',jsonb_build_object(
      'factoryExits',case when v_prod and v_live.metrics is not null then nullif(v_live.metrics->>'exits_vop','')::numeric else null end,
      'entries',case when v_prod and v_live.metrics is not null then nullif(v_live.metrics->>'entries_vop','')::numeric else null end,
      'factoryStock',case when v_prod and v_live.metrics is not null then nullif(v_live.metrics->>'factory_stock','')::numeric else null end,
      'exitObjective',case when v_prod then v_target else null end,
      'entryExitGap',case when v_prod and v_live.metrics is not null then coalesce(nullif(v_live.metrics->>'entries_vop','')::numeric,0)-coalesce(nullif(v_live.metrics->>'exits_vop','')::numeric,0) else null end,
      'absenceRate',case when v_hr and v_population>0 then round(v_absenteeism_people::numeric*100/v_population,1) else null end,
      'absencePeople',case when v_hr then v_absenteeism_people else null end,
      'population',case when v_hr then v_population else null end,
      'unplannedPeople',case when v_hr then v_unplanned_people else null end,
      'unplannedHours',case when v_hr then round(v_unplanned_hours,1) else null end,
      'unplannedEtp',case when v_hr then round(v_unplanned_etp,1) else null end,
      'unplannedLostVop',case when v_hr and v_lost_vop is not null then round(v_lost_vop,1) else null end,
      'hoursPerSiteVop',case when v_hr and v_hours_per_vop is not null then round(v_hours_per_vop,2) else null end,
      'approvedLeavePeople',case when v_hr then v_approved_leave else null end,
      'factoryAgeMin',case when v_prod and v_factory_age is not null then round(v_factory_age,0) else null end,
      'parkAgeMin',case when v_prod and v_park_age is not null then round(v_park_age,0) else null end,
      'sourceName',case when v_prod then v_live.source_name else null end,
      'sourceModifiedAt',case when v_prod then v_live.source_modified_at else null end,
      'factoryModifiedAt',case when v_prod then v_live.factory_modified_at else null end,
      'parkModifiedAt',case when v_prod then v_live.park_modified_at else null end
    )
  );
end;
$$;

create or replace function public.kpi_toolbox_widget_preferences_save(p_session_hash text,p_widget_keys text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_prod boolean := false;
  v_hr boolean := false;
  v_available text[] := array[]::text[];
  v_keys text[] := coalesce(p_widget_keys,array[]::text[]);
  v_distinct_count integer;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  v_prod := v_user.role='admin' or '*'=any(coalesce(v_user.page_permissions,array[]::text[])) or coalesce(v_user.page_permissions,array[]::text[]) && array['reporting','book','cockpit','bodyshop','intelligence']::text[];
  v_hr := v_user.role='admin' or '*'=any(coalesce(v_user.page_permissions,array[]::text[])) or coalesce(v_user.page_permissions,array[]::text[]) && array['worktime','data_rh']::text[];
  if v_prod then v_available:=v_available||array['factory_exits','entries','factory_stock','entry_exit_gap','ftp_freshness']::text[]; end if;
  if v_hr then v_available:=v_available||array['absence_rate','unplanned_absence_etp','approved_leave']::text[]; end if;

  if cardinality(v_keys)<1 or cardinality(v_keys)>6 then raise exception 'Sélectionne entre 1 et 6 widgets.'; end if;
  select count(distinct x) into v_distinct_count from unnest(v_keys) x;
  if v_distinct_count<>cardinality(v_keys) then raise exception 'Un widget ne peut être sélectionné qu’une fois.'; end if;
  if exists(select 1 from unnest(v_keys) x where not (x=any(v_available))) then raise exception 'Widget non autorisé pour ce profil.' using errcode='42501'; end if;

  insert into public.kpi_toolbox_widget_preferences(user_id,widget_keys,updated_at)
  values(v_user.id,v_keys,now())
  on conflict(user_id) do update set widget_keys=excluded.widget_keys,updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'selected',to_jsonb(v_keys),'updatedAt',now());
end;
$$;

revoke all on function public.kpi_toolbox_live_widgets(text) from public;
revoke all on function public.kpi_toolbox_widget_preferences_save(text,text[]) from public;
grant execute on function public.kpi_toolbox_live_widgets(text) to anon,authenticated,service_role;
grant execute on function public.kpi_toolbox_widget_preferences_save(text,text[]) to anon,authenticated,service_role;