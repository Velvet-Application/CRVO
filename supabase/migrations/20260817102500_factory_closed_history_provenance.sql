update public.kpi_daily_verified_metrics
set source_label='FTP CRVO · Factory-Mois.csv · clôture automatique',
    reason='Clôture Factory-Mois confirmée automatiquement : VOP EFF 74 + VOP EXT 9 = 83 sorties usine.',
    verified_by='Système CRVO',
    verified_at=now()
where metric_date=date '2026-08-14'
  and metric_key in ('exits_vop','production_factory_exit')
  and metric_value=83;

create or replace view public.kpi_public_dashboard_snapshots as
with raw as (
  select s.snapshot_at,s.source_name,s.metrics
  from public.kpi_dashboard_snapshots s
  where s.source_name <> 'FTP CRVO · Factory-j+1 + EtatduParc'
  union all
  select h.snapshot_at,replace(h.source_name,'Factory-j+1','Factory') as source_name,h.metrics
  from public.kpi_ftp_daily_history h
), verified as (
  select metric_date,
         jsonb_object_agg(metric_key,to_jsonb(metric_value)) as metrics,
         max(verified_at) as verified_at
  from public.kpi_daily_verified_metrics
  group by metric_date
)
select r.snapshot_at,
       case when v.metric_date is not null then r.source_name || ' · clôture vérifiée' else r.source_name end as source_name,
       r.metrics || coalesce(v.metrics,'{}'::jsonb) as metrics
from raw r
left join verified v on v.metric_date=r.snapshot_at;
