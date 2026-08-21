-- Focus magasin / MPR : ne conserver que les dossiers avec pièce commandée ou en back order.
create or replace function public.kpi_animation_export(p_session_hash text, p_position_key text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user public.crvo_auth_users%rowtype;
  v_own text;
  v_pos public.kpi_worktime_org_positions%rowtype;
  v_positions jsonb;
  v_sectors text[];
  v_teams text[];
  v_all boolean:=false;
  v_vehicles jsonb;
  v_sector_summary jsonb;
  v_store jsonb;
  v_source timestamptz;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash
    and s.revoked_at is null
    and s.expires_at>now()
    and u.is_active
  limit 1;

  if v_user.id is null then
    raise exception 'Session requise.' using errcode='42501';
  end if;

  select up.position_key into v_own
  from public.kpi_worktime_user_position up
  where up.user_id=v_user.id
  limit 1;

  if coalesce(p_position_key,'')='' then
    if v_user.role='admin' then
      v_all:=true;
      v_sectors:=array['*'];
      v_teams:=array['*'];
    elsif v_own is not null then
      select * into v_pos
      from public.kpi_worktime_org_positions
      where position_key=v_own and active;
      v_all:=v_pos.all_access;
      v_sectors:=v_pos.sector_keys;
      v_teams:=v_pos.team_codes;
    else
      raise exception 'Périmètre organigramme requis.' using errcode='42501';
    end if;
  else
    if v_user.role<>'admin' and p_position_key<>v_own then
      raise exception 'Périmètre interdit.' using errcode='42501';
    end if;
    select * into v_pos
    from public.kpi_worktime_org_positions
    where position_key=p_position_key and active and entity='CRVO';
    if v_pos.position_key is null then
      raise exception 'Poste introuvable.' using errcode='22023';
    end if;
    v_all:=v_pos.all_access;
    v_sectors:=v_pos.sector_keys;
    v_teams:=v_pos.team_codes;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'positionKey',position_key,
    'name',person_name,
    'title',title,
    'level',level_code,
    'teams',team_codes,
    'sectors',sector_keys,
    'allAccess',all_access
  ) order by sort_order),'[]'::jsonb)
  into v_positions
  from public.kpi_worktime_org_positions
  where active and entity='CRVO'
    and level_code in ('industrial_manager','supervisor','team_leader');

  with all_vehicles as materialized (
    select
      current_sector_key,
      registration,
      work_order,
      model,
      status,
      effective_factory_age_days,
      factory_age_days,
      urgency,
      alert,
      part_available,
      part_ordered_days,
      blocking_cause,
      latest_source_modified_at
    from public.kpi_intelligence_vehicle_public
  ),
  scoped as materialized (
    select *
    from all_vehicles v
    where v_all or '*'=any(v_sectors) or v.current_sector_key=any(v_sectors)
  ),
  store_scope as materialized (
    select *
    from all_vehicles
    where part_available in ('PIECE COMMANDEE','BACK ORDER')
  ),
  ranked as (
    select s.*,
      row_number() over(
        partition by current_sector_key
        order by coalesce(effective_factory_age_days,factory_age_days,0) desc,registration
      ) rn
    from scoped s
  ),
  oldest_vehicles as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sector',current_sector_key,
      'registration',registration,
      'workOrder',work_order,
      'model',model,
      'status',status,
      'ageDays',coalesce(effective_factory_age_days,factory_age_days,0),
      'urgency',urgency,
      'alert',alert,
      'partOrderedDays',part_ordered_days,
      'blockingCause',blocking_cause
    ) order by current_sector_key,rn),'[]'::jsonb) value
    from ranked
    where rn<=10
  ),
  sector_summary as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sector',current_sector_key,
      'stock',cnt,
      'over15',over15,
      'over20',over20,
      'avgAge',avg_age,
      'oldestAge',oldest_age,
      'urgents',urgents
    ) order by cnt desc),'[]'::jsonb) value
    from (
      select current_sector_key,
        count(*) cnt,
        count(*) filter(where coalesce(effective_factory_age_days,factory_age_days,0)>15) over15,
        count(*) filter(where coalesce(effective_factory_age_days,factory_age_days,0)>20) over20,
        round(avg(coalesce(effective_factory_age_days,factory_age_days,0))::numeric,1) avg_age,
        max(coalesce(effective_factory_age_days,factory_age_days,0)) oldest_age,
        count(*) filter(where coalesce(urgency,'')<>'') urgents
      from scoped
      group by current_sector_key
    ) x
  ),
  store_oldest as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'registration',registration,
      'workOrder',work_order,
      'model',model,
      'status',status,
      'partOrderedDays',part_ordered_days,
      'ageDays',coalesce(effective_factory_age_days,factory_age_days,0)
    ) order by part_ordered_days desc nulls last, coalesce(effective_factory_age_days,factory_age_days,0) desc, registration),'[]'::jsonb) value
    from (
      select *
      from store_scope
      order by part_ordered_days desc nulls last, coalesce(effective_factory_age_days,factory_age_days,0) desc, registration
      limit 10
    ) q
  ),
  store_stats as (
    select
      round(avg(part_ordered_days)::numeric,1) avg_order_lead_days,
      count(*) filter(where part_ordered_days>3) folders_over_3_days,
      count(*) folders_with_parts_order,
      max(part_ordered_days) oldest_order_days,
      (select max(latest_source_modified_at) from all_vehicles) source_modified_at
    from store_scope
  )
  select
    st.source_modified_at,
    ov.value,
    ss.value,
    jsonb_build_object(
      'avgOrderLeadDays',st.avg_order_lead_days,
      'foldersOver3Days',st.folders_over_3_days,
      'foldersWithPartsOrder',st.folders_with_parts_order,
      'oldestOrderDays',st.oldest_order_days,
      'oldest',so.value
    )
  into v_source,v_vehicles,v_sector_summary,v_store
  from store_stats st
  cross join oldest_vehicles ov
  cross join sector_summary ss
  cross join store_oldest so;

  return jsonb_build_object(
    'connected',true,
    'generatedAt',now(),
    'sourceModifiedAt',v_source,
    'selected',case when v_pos.position_key is null then
      jsonb_build_object('positionKey',null,'name','Vue globale','title','CRVO Lens','teams',v_teams,'sectors',v_sectors,'allAccess',v_all)
    else
      jsonb_build_object('positionKey',v_pos.position_key,'name',v_pos.person_name,'title',v_pos.title,'teams',v_teams,'sectors',v_sectors,'allAccess',v_all)
    end,
    'positions',v_positions,
    'sectorSummary',v_sector_summary,
    'oldestVehicles',v_vehicles,
    'store',v_store
  );
end
$function$;
