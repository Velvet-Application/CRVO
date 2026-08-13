create or replace view public.kpi_ftp_live_dashboard as
with latest_factory_batch as (
  select id, imported_at, metadata
  from public.kpi_import_batches
  where source_id = 'dfbb57cc-8771-4e53-b52b-38defa389b64'::uuid
    and original_filename in ('Factory-j_1.csv','Factory-j+1.csv')
    and metadata->>'factory_production_status' = 'ready'
  order by coalesce((metadata->>'modified_at')::bigint,0) desc, imported_at desc
  limit 1
),
factory_date as (
  select max(p.production_date) as production_date
  from public.kpi_ftp_factory_production p
  join latest_factory_batch b on b.id = p.import_batch_id
  where p.production_date <= (now() at time zone 'Europe/Paris')::date
),
factory as (
  select
    d.production_date as snapshot_at,
    max(p.source_modified_at) as factory_modified_at,
    sum(p.received) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as entries_vop,
    sum(p.expertise) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_expertise,
    sum(p.mechanics) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_mechanics,
    sum(p.dsp) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_dsp,
    sum(p.bodywork + p.fixline_1 + p.fixline_2 + p.fixline_3) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_bodywork,
    sum(p.preparation) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_preparation,
    sum(p.quality) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_quality,
    sum(p.available) filter (where p.flow in ('VOP EFF','VOP EXT'))::numeric as production_factory_exit
  from factory_date d
  join latest_factory_batch b on true
  join public.kpi_ftp_factory_production p on p.import_batch_id = b.id and p.production_date = d.production_date
  group by d.production_date
),
latest_park_batch as (
  select id, snapshot_at, imported_at, metadata
  from public.kpi_import_batches
  where source_id = 'dfbb57cc-8771-4e53-b52b-38defa389b64'::uuid
    and original_filename = 'EtatduParc.csv'
    and metadata->>'vehicle_state_status' = 'ready'
  order by coalesce((metadata->>'modified_at')::bigint,0) desc, imported_at desc
  limit 1
),
park as (
  select
    b.snapshot_at,
    max(s.source_modified_at) as park_modified_at,
    count(*) filter (
      where s.metadata->>'type' in ('VOP EFF','VOP EXT')
        and coalesce(s.status,'') not in ('Transport à vide','En attente de transport aller')
    )::numeric as factory_stock,
    count(*) filter (
      where s.metadata->>'type' in ('VOP EFF','VOP EXT')
        and coalesce(s.status,'') not in ('Transport à vide','En attente de transport aller')
        and s.factory_age_days > 15
    )::numeric as stock_over_15d,
    count(*) filter (
      where s.metadata->>'type' in ('VOP EFF','VOP EXT')
        and coalesce(s.status,'') not in ('Transport à vide','En attente de transport aller')
        and s.factory_age_days > 20
    )::numeric as stock_over_20d
  from latest_park_batch b
  join public.kpi_ftp_vehicle_state s on s.import_batch_id = b.id
  group by b.snapshot_at
)
select
  f.snapshot_at,
  'FTP CRVO · Factory-j+1 + EtatduParc'::text as source_name,
  jsonb_build_object(
    'entries_vop', coalesce(f.entries_vop,0),
    'exits_vop', coalesce(f.production_factory_exit,0),
    'factory_stock', coalesce(p.factory_stock,0),
    'stock_over_15d', coalesce(p.stock_over_15d,0),
    'stock_over_20d', coalesce(p.stock_over_20d,0),
    'production_expertise', coalesce(f.production_expertise,0),
    'production_mechanics', coalesce(f.production_mechanics,0),
    'production_dsp', coalesce(f.production_dsp,0),
    'production_bodywork', coalesce(f.production_bodywork,0),
    'production_preparation', coalesce(f.production_preparation,0),
    'production_quality', coalesce(f.production_quality,0),
    'production_factory_exit', coalesce(f.production_factory_exit,0)
  ) as metrics,
  greatest(f.factory_modified_at, p.park_modified_at) as source_modified_at,
  f.factory_modified_at,
  p.park_modified_at
from factory f
left join park p on true;
