create or replace function public.kpi_daily_animation_enrichment_admin(
  p_session_hash text,
  p_report_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
set statement_timeout to '15s'
as $$
declare
  v_user record;
  v_report_date date := coalesce(p_report_date, (timezone('Europe/Paris', now()))::date - 1);
  v_photos_day numeric := 0;
  v_latest_batch uuid := null;
  v_stock integer := 0;
  v_over15 integer := 0;
  v_over20 integer := 0;
  v_oldest jsonb := '[]'::jsonb;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  with latest_by_flow as (
    select distinct on (p.flow) p.flow,p.photos
    from public.kpi_ftp_factory_production p
    where p.production_date=v_report_date
    order by p.flow,p.source_modified_at desc nulls last,p.created_at desc,p.id desc
  )
  select coalesce(sum(coalesce(photos,0)),0) into v_photos_day
  from latest_by_flow where flow in ('VOP EFF','VOP EXT');

  select b.id into v_latest_batch
  from public.kpi_import_batches b
  join public.kpi_data_sources s on s.id=b.source_id
  where s.kind='ftp' and s.is_enabled and b.original_filename='EtatduParc.csv' and b.metadata->>'vehicle_state_status'='ready'
  order by coalesce((b.metadata->>'modified_at')::bigint,0) desc,b.imported_at desc
  limit 1;

  if v_latest_batch is not null then
    with ranked as (
      select v.*,row_number() over (
        partition by coalesce(nullif(trim(v.vin),''),nullif(trim(v.registration),''),nullif(trim(v.work_order),''),v.id::text)
        order by v.status_at desc nulls last,v.created_at desc,v.id desc
      ) rn
      from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_latest_batch
    ), active as (
      select * from ranked where rn=1
        and metadata->>'type' in ('VOP EFF','VOP EXT')
        and lower(coalesce(status,'')) <> all(array['transport à vide','en attente de transport aller','sortie usine','en attente de transport retour','transport retour planifié','transport retour effectué'])
    )
    select count(*)::integer,count(*) filter(where factory_age_days>15)::integer,count(*) filter(where factory_age_days>20)::integer
    into v_stock,v_over15,v_over20 from active;

    with ranked as (
      select v.*,row_number() over (
        partition by coalesce(nullif(trim(v.vin),''),nullif(trim(v.registration),''),nullif(trim(v.work_order),''),v.id::text)
        order by v.status_at desc nulls last,v.created_at desc,v.id desc
      ) rn
      from public.kpi_ftp_vehicle_state v where v.import_batch_id=v_latest_batch
    ), active as (
      select * from ranked where rn=1
        and metadata->>'type' in ('VOP EFF','VOP EXT')
        and lower(coalesce(status,'')) <> all(array['transport à vide','en attente de transport aller','sortie usine','en attente de transport retour','transport retour planifié','transport retour effectué'])
    ), oldest as (
      select registration,work_order,model,status,factory_age_days,urgency,alert
      from active where factory_age_days is not null
      order by factory_age_days desc,registration limit 10
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'registration',registration,'workOrder',work_order,'model',model,'status',status,
      'ageDays',round(factory_age_days,0),'urgency',urgency,'alert',alert
    ) order by factory_age_days desc,registration),'[]'::jsonb)
    into v_oldest from oldest;
  end if;

  return jsonb_build_object(
    'connected',true,
    'photosYesterday',round(v_photos_day,0),
    'currentAging',jsonb_build_object('stock',coalesce(v_stock,0),'over15',coalesce(v_over15,0),'over20',coalesce(v_over20,0)),
    'oldestToExit',coalesce(v_oldest,'[]'::jsonb),
    'source','Factory FTP + EtatduParc FTP'
  );
end
$$;

revoke all on function public.kpi_daily_animation_enrichment_admin(text,date) from public;
grant execute on function public.kpi_daily_animation_enrichment_admin(text,date) to anon,authenticated,service_role;
