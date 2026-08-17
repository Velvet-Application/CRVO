create table if not exists public.kpi_daily_verified_metrics (
  metric_date date not null,
  metric_key text not null,
  metric_value numeric not null,
  source_label text not null,
  reason text,
  verified_by text,
  verified_at timestamptz not null default now(),
  primary key (metric_date, metric_key),
  constraint kpi_daily_verified_metrics_key_chk check (metric_key ~ '^[a-z0-9_]+$')
);

alter table public.kpi_daily_verified_metrics enable row level security;

comment on table public.kpi_daily_verified_metrics is 'Corrections de clôture explicitement vérifiées. Elles priment sur les flux automatiques pour éviter qu’une journée clôturée change après validation.';
comment on column public.kpi_daily_verified_metrics.source_label is 'Source de confiance ayant confirmé la valeur.';
comment on column public.kpi_daily_verified_metrics.reason is 'Motif auditable de la correction.';

insert into public.kpi_daily_verified_metrics(metric_date,metric_key,metric_value,source_label,reason,verified_by)
values
  (date '2026-08-14','exits_vop',83,'Direction CRVO Lens · clôture validée','Sorties usine de la journée du vendredi 14/08/2026 confirmées à 83 ; le flux Factory avait figé 62 avant clôture complète.','Direction CRVO Lens'),
  (date '2026-08-14','production_factory_exit',83,'Direction CRVO Lens · clôture validée','Sorties usine de la journée du vendredi 14/08/2026 confirmées à 83 ; le flux Factory avait figé 62 avant clôture complète.','Direction CRVO Lens')
on conflict(metric_date,metric_key) do update set
  metric_value=excluded.metric_value,
  source_label=excluded.source_label,
  reason=excluded.reason,
  verified_by=excluded.verified_by,
  verified_at=now();

create index if not exists kpi_daily_verified_metrics_date_idx on public.kpi_daily_verified_metrics(metric_date desc);
