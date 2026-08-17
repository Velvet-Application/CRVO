create or replace function public.kpi_capacity_billing_ratios(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user record;
  v_batch record;
  v_period_start date;
  v_period_end date;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  select b.id,b.filename,b.file_sha256,b.completed_at
    into v_batch
  from public.kpi_ops_import_batches b
  where b.source_key='billed_time' and b.status='imported'
  order by b.completed_at desc nulls last,b.created_at desc
  limit 1;

  if v_batch.id is null then
    return jsonb_build_object('connected',false,'error','Aucun fichier Temps pointé facturé certifié.');
  end if;

  select min(nullif(f.metadata->>'period_start','')::date),
         max(nullif(f.metadata->>'period_end','')::date)
    into v_period_start,v_period_end
  from public.kpi_billed_time_facts f
  where f.source_name='Direct Temps pointé facturé'
    and f.source_file_sha256=v_batch.file_sha256;

  return jsonb_build_object(
    'connected',true,
    'period',jsonb_build_object(
      'start',case when v_period_start is not null then to_char(v_period_start,'YYYY-MM-DD') else null end,
      'end',case when v_period_end is not null then to_char(v_period_end,'YYYY-MM-DD') else null end,
      'filename',v_batch.filename,
      'importedAt',v_batch.completed_at
    ),
    'ratios',coalesce((
      with per_or as (
        select f.sector_key,
               f.work_order,
               sum(f.labor_hours)::numeric as sold_hours
        from public.kpi_billed_time_facts f
        where f.source_name='Direct Temps pointé facturé'
          and f.source_file_sha256=v_batch.file_sha256
          and f.sector_key in ('expertise','mecanique','dsp','carrosserie','preparation','qualite')
          and nullif(btrim(f.work_order),'') is not null
        group by f.sector_key,f.work_order
      ), sector as (
        select sector_key,
               count(*)::numeric as billed_vehicles,
               sum(sold_hours)::numeric as sold_hours,
               avg(sold_hours)::numeric as avg_hours_per_vehicle
        from per_or
        group by sector_key
      )
      select jsonb_agg(jsonb_build_object(
        'sectorKey',sector_key,
        'billedVehicles',round(billed_vehicles,0),
        'soldHours',round(sold_hours,2),
        'avgHoursPerVehicle',round(avg_hours_per_vehicle,3)
      ) order by sector_key)
      from sector
    ),'[]'::jsonb)
  );
end
$$;

grant execute on function public.kpi_capacity_billing_ratios(text) to anon,authenticated,service_role;

create index if not exists kpi_billed_source_sector_workorder_idx
  on public.kpi_billed_time_facts(source_file_sha256,sector_key,work_order)
  where source_name='Direct Temps pointé facturé';
