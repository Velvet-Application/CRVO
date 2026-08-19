create or replace function public.kpi_worktime_capacity_reference(p_session_hash text,p_entity text default 'CRVO')
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_entity text:=upper(coalesce(p_entity,'CRVO'));
  v_batch record;
  v_start date;
  v_end date;
  v_rows jsonb;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  if not exists(select 1 from public.kpi_worktime_scope_for_user(v_user.id,v_entity)) then
    raise exception 'Accès Temps de travail requis.' using errcode='42501';
  end if;
  if v_entity='TRANSPHERE' then
    return jsonb_build_object('connected',true,'entity',v_entity,'source','non_disponible','period',null,'sectors','[]'::jsonb);
  end if;

  select b.filename,b.file_sha256,b.completed_at into v_batch
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported'
  order by b.completed_at desc nulls last,b.created_at desc
  limit 1;
  if v_batch.file_sha256 is null then
    return jsonb_build_object('connected',false,'entity',v_entity,'error','Aucune référence Temps Facturés disponible.','sectors','[]'::jsonb);
  end if;

  select min(nullif(f.metadata->>'period_start','')::date),max(nullif(f.metadata->>'period_end','')::date)
    into v_start,v_end
  from public.kpi_billed_time_facts f
  where f.source_name='Direct Temps pointé facturé' and f.source_file_sha256=v_batch.file_sha256;

  with sold as (
    select f.sector_key,sum(f.labor_hours)::numeric sold_hours
    from public.kpi_billed_time_facts f
    where f.source_name='Direct Temps pointé facturé' and f.source_file_sha256=v_batch.file_sha256
    group by f.sector_key
  ), prod as (
    select 'expertise'::text sector_key,sum(coalesce((s.metrics->>'production_expertise')::numeric,0))::numeric volume from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_start and v_end and extract(isodow from s.snapshot_at) between 1 and 6
    union all select 'mecanique',sum(coalesce((s.metrics->>'production_mechanics')::numeric,0)) from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_start and v_end and extract(isodow from s.snapshot_at) between 1 and 6
    union all select 'dsp',sum(coalesce((s.metrics->>'production_dsp')::numeric,0)) from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_start and v_end and extract(isodow from s.snapshot_at) between 1 and 6
    union all select 'carrosserie',sum(coalesce((s.metrics->>'production_bodywork')::numeric,0)) from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_start and v_end and extract(isodow from s.snapshot_at) between 1 and 6
    union all select 'preparation',sum(coalesce((s.metrics->>'production_preparation')::numeric,0)) from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_start and v_end and extract(isodow from s.snapshot_at) between 1 and 6
    union all select 'qualite',sum(coalesce((s.metrics->>'production_quality')::numeric,0)) from public.kpi_public_dashboard_snapshots s where s.snapshot_at between v_start and v_end and extract(isodow from s.snapshot_at) between 1 and 6
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sectorKey',p.sector_key,
    'soldHours',round(coalesce(s.sold_hours,0),2),
    'observedVehicles',round(coalesce(p.volume,0),0),
    'avgHoursPerVop',case when coalesce(p.volume,0)>0 then round(coalesce(s.sold_hours,0)/p.volume,3) else null end
  ) order by p.sector_key),'[]'::jsonb)
  into v_rows
  from prod p left join sold s using(sector_key);

  return jsonb_build_object(
    'connected',true,'entity',v_entity,
    'source',v_batch.filename,
    'period',jsonb_build_object('start',v_start,'end',v_end,'importedAt',v_batch.completed_at),
    'sectors',v_rows
  );
end $$;

revoke all on function public.kpi_worktime_capacity_reference(text,text) from public;
grant execute on function public.kpi_worktime_capacity_reference(text,text) to anon,authenticated,service_role;
