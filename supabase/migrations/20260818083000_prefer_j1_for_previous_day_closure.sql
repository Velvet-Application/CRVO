create or replace view public.kpi_ftp_daily_history as
with today_ctx as (
  select (now() at time zone 'Europe/Paris')::date as today
),
factory_ranked as (
  select p.*, b.original_filename,
    case
      when p.production_date = t.today and b.original_filename in ('Factory-j_1.csv','Factory-j+1.csv') then 500
      when p.production_date = t.today and b.original_filename = 'Factory-Mois.csv' then 250
      when p.production_date = t.today and b.original_filename = 'Factory-j-1.csv' then 100
      when p.production_date = t.today - 1 and b.original_filename = 'Factory-j-1.csv' then 500
      when p.production_date = t.today - 1 and b.original_filename = 'Factory-Mois.csv' then 400
      when p.production_date = t.today - 1 and b.original_filename in ('Factory-j_1.csv','Factory-j+1.csv') then 100
      when p.production_date < t.today - 1 and b.original_filename = 'Factory-Mois.csv' then 500
      when p.production_date < t.today - 1 and b.original_filename = 'Factory-j-1.csv' then 300
      when p.production_date < t.today - 1 and b.original_filename in ('Factory-j_1.csv','Factory-j+1.csv') then 100
      else 0
    end as source_priority,
    row_number() over (
      partition by p.production_date,p.flow
      order by
        case
          when p.production_date = t.today and b.original_filename in ('Factory-j_1.csv','Factory-j+1.csv') then 500
          when p.production_date = t.today and b.original_filename = 'Factory-Mois.csv' then 250
          when p.production_date = t.today and b.original_filename = 'Factory-j-1.csv' then 100
          when p.production_date = t.today - 1 and b.original_filename = 'Factory-j-1.csv' then 500
          when p.production_date = t.today - 1 and b.original_filename = 'Factory-Mois.csv' then 400
          when p.production_date = t.today - 1 and b.original_filename in ('Factory-j_1.csv','Factory-j+1.csv') then 100
          when p.production_date < t.today - 1 and b.original_filename = 'Factory-Mois.csv' then 500
          when p.production_date < t.today - 1 and b.original_filename = 'Factory-j-1.csv' then 300
          when p.production_date < t.today - 1 and b.original_filename in ('Factory-j_1.csv','Factory-j+1.csv') then 100
          else 0
        end desc,
        p.source_modified_at desc nulls last,
        p.created_at desc,
        p.id desc
    ) as rn
  from public.kpi_ftp_factory_production p
  join public.kpi_import_batches b on b.id=p.import_batch_id
  cross join today_ctx t
  where p.production_date<=t.today
    and b.original_filename in ('Factory-Mois.csv','Factory-j-1.csv','Factory-j_1.csv','Factory-j+1.csv')
    and coalesce(b.metadata->>'factory_production_status','')='ready'
),
factory as (
  select production_date as snapshot_at,
    max(original_filename) filter(where rn=1 and flow in ('VOP EFF','VOP EXT')) as selected_factory_source,
    sum(received) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as entries_vop,
    sum(expertise) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_expertise,
    sum(mechanics) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_mechanics,
    sum(dsp) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_dsp,
    sum(bodywork+fixline_1+fixline_2+fixline_3) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_bodywork,
    sum(preparation) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_preparation,
    sum(quality) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_quality,
    sum(available) filter(where rn=1 and flow in ('VOP EFF','VOP EXT'))::numeric as production_factory_exit
  from factory_ranked
  group by production_date
),
ftp_source as (
  select id from public.kpi_data_sources where kind='ftp' and is_enabled order by created_at limit 1
),
park_batches as (
  select q.id,q.snapshot_at
  from (
    select b.id,b.snapshot_at,
      row_number() over(partition by b.snapshot_at order by coalesce(nullif(b.metadata->>'modified_at','')::bigint,0) desc,b.imported_at desc) as rn
    from public.kpi_import_batches b
    join ftp_source s on s.id=b.source_id
    where b.original_filename='EtatduParc.csv' and b.metadata->>'vehicle_state_status'='ready'
  ) q where q.rn=1
),
park_ranked as (
  select b.snapshot_at,v.status,v.factory_age_days,v.metadata,
    row_number() over(
      partition by b.snapshot_at,coalesce(nullif(trim(v.vin),''),nullif(trim(v.registration),''),nullif(trim(v.work_order),''),v.id::text)
      order by v.status_at desc nulls last,v.created_at desc,v.id desc
    ) as rn
  from park_batches b join public.kpi_ftp_vehicle_state v on v.import_batch_id=b.id
),
park as (
  select snapshot_at,
    count(*) filter(where rn=1 and metadata->>'type' in ('VOP EFF','VOP EXT') and lower(coalesce(status,'')) not in ('transport à vide','en attente de transport aller','sortie usine','en attente de transport retour','transport retour planifié','transport retour effectué'))::numeric as factory_stock,
    count(*) filter(where rn=1 and metadata->>'type' in ('VOP EFF','VOP EXT') and lower(coalesce(status,'')) not in ('transport à vide','en attente de transport aller','sortie usine','en attente de transport retour','transport retour planifié','transport retour effectué') and factory_age_days>15)::numeric as stock_over_15d,
    count(*) filter(where rn=1 and metadata->>'type' in ('VOP EFF','VOP EXT') and lower(coalesce(status,'')) not in ('transport à vide','en attente de transport aller','sortie usine','en attente de transport retour','transport retour planifié','transport retour effectué') and factory_age_days>20)::numeric as stock_over_20d
  from park_ranked group by snapshot_at
)
select f.snapshot_at,
  case
    when f.selected_factory_source='Factory-Mois.csv' then 'FTP CRVO · Factory-Mois (clôture) + EtatduParc'
    when f.selected_factory_source='Factory-j-1.csv' then 'FTP CRVO · Factory-j-1 (clôture) + EtatduParc'
    else 'FTP CRVO · Factory live + EtatduParc'
  end as source_name,
  jsonb_build_object(
    'entries_vop',coalesce(f.entries_vop,0),
    'exits_vop',coalesce(f.production_factory_exit,0),
    'factory_stock',coalesce(p.factory_stock,0),
    'stock_over_15d',coalesce(p.stock_over_15d,0),
    'stock_over_20d',coalesce(p.stock_over_20d,0),
    'production_expertise',coalesce(f.production_expertise,0),
    'production_mechanics',coalesce(f.production_mechanics,0),
    'production_dsp',coalesce(f.production_dsp,0),
    'production_bodywork',coalesce(f.production_bodywork,0),
    'production_preparation',coalesce(f.production_preparation,0),
    'production_quality',coalesce(f.production_quality,0),
    'production_factory_exit',coalesce(f.production_factory_exit,0)
  ) as metrics
from factory f left join park p using(snapshot_at);
