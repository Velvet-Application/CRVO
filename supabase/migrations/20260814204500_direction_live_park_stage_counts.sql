create or replace view public.kpi_ftp_direction_live_flow as
with ftp_source as (
  select id
  from public.kpi_data_sources
  where kind='ftp' and is_enabled=true
  order by created_at
  limit 1
), latest_park_batch as (
  select b.id, b.snapshot_at
  from public.kpi_import_batches b
  join ftp_source s on s.id=b.source_id
  where b.original_filename='EtatduParc.csv'
    and b.metadata->>'vehicle_state_status'='ready'
  order by coalesce((b.metadata->>'modified_at')::bigint,0) desc, b.imported_at desc
  limit 1
), park_ranked as (
  select
    b.snapshot_at,
    v.source_modified_at,
    v.status,
    v.metadata,
    row_number() over (
      partition by coalesce(
        nullif(trim(v.vin),''),
        nullif(trim(v.registration),''),
        nullif(trim(v.work_order),''),
        v.id::text
      )
      order by v.status_at desc nulls last, v.created_at desc, v.id desc
    ) as rn
  from latest_park_batch b
  join public.kpi_ftp_vehicle_state v on v.import_batch_id=b.id
), base as (
  select *
  from park_ranked
  where rn=1
    and metadata->>'type' in ('VOP EFF','VOP EXT')
)
select
  snapshot_at,
  max(source_modified_at) as park_modified_at,
  count(*) filter (
    where lower(coalesce(status,'')) in (
      'en attente de préparation',
      'stocké sur parc d''attente (préparation)',
      'préparation en cours',
      'demande de convoyage vers préparation',
      'en attente de validation travaux préparation'
    )
  )::integer as preparation_remaining,
  count(*) filter (
    where lower(coalesce(status,'')) in (
      'en attente de contrôle qualité',
      'contrôle qualité en cours',
      'en attente de travaux suite controle qualité'
    )
  )::integer as quality_remaining,
  count(*) filter (
    where lower(coalesce(status,'')) in (
      'en attente de photo',
      'photo en cours'
    )
  )::integer as photo_remaining
from base
group by snapshot_at;

grant select on public.kpi_ftp_direction_live_flow to anon, authenticated;
