create table if not exists public.kpi_capacity_productivity_reference (
  site_code text not null default 'lens',
  sector_key text not null,
  period_start date not null,
  period_end date not null,
  bought_hours numeric(14,2) not null,
  sold_hours numeric(14,2) not null,
  fixline_excluded boolean not null default true,
  source_sheet text not null default 'DASHBOARD',
  source_files jsonb not null default '[]'::jsonb,
  calculation_method text not null,
  updated_at timestamptz not null default now(),
  primary key (site_code, sector_key)
);

alter table public.kpi_capacity_productivity_reference enable row level security;
revoke all on table public.kpi_capacity_productivity_reference from anon, authenticated;
grant select on table public.kpi_capacity_productivity_reference to service_role;

insert into public.kpi_capacity_productivity_reference
(site_code,sector_key,period_start,period_end,bought_hours,sold_hours,fixline_excluded,source_sheet,source_files,calculation_method)
values
('lens','expertise','2026-03-01','2026-06-30',11078.00,12493.35,true,'DASHBOARD','[{"file":"Outil calcul rendement CRVO Lens MARS 2026 v4.xlsm","sha256":"ec2a1fb2a508d5dfe28245fc64a1ed001faa72558e9e23fc6f90f1287f6d8006"},{"file":"Outil calcul rendement CRVO Lens AVRIL 2026 v4.1.xlsm","sha256":"5ddcac9ea41416a9dfa4af0d04a84e59b388958c9a83a69b73ba9044aeadfd1a"},{"file":"Outil calcul rendement CRVO Lens MAI 2026 v4.2.xlsm","sha256":"f287f6263780b1528b9537bd884cc8bb0ee1028f876753bf1c1b340285dc961a"},{"file":"Outil calcul rendement CRVO Lens JUIN 2026 v4.2.xlsm","sha256":"c5c5c744396f044dc4c4f60d70cfcddb2206d5ccd1e071b1ef2c3069fcacb24c"}]'::jsonb,'Somme heures vendues / somme heures achetées, mars à juin 2026, équipes A/B/C. Fixline exclue.'),
('lens','mecanique','2026-03-01','2026-06-30',14221.75,17106.62,true,'DASHBOARD','[{"file":"Outil calcul rendement CRVO Lens MARS 2026 v4.xlsm","sha256":"ec2a1fb2a508d5dfe28245fc64a1ed001faa72558e9e23fc6f90f1287f6d8006"},{"file":"Outil calcul rendement CRVO Lens AVRIL 2026 v4.1.xlsm","sha256":"5ddcac9ea41416a9dfa4af0d04a84e59b388958c9a83a69b73ba9044aeadfd1a"},{"file":"Outil calcul rendement CRVO Lens MAI 2026 v4.2.xlsm","sha256":"f287f6263780b1528b9537bd884cc8bb0ee1028f876753bf1c1b340285dc961a"},{"file":"Outil calcul rendement CRVO Lens JUIN 2026 v4.2.xlsm","sha256":"c5c5c744396f044dc4c4f60d70cfcddb2206d5ccd1e071b1ef2c3069fcacb24c"}]'::jsonb,'Somme heures vendues / somme heures achetées, mars à juin 2026, équipes A/B/C. Fixline exclue.'),
('lens','dsp','2026-03-01','2026-06-30',1880.00,4109.87,true,'DASHBOARD','[{"file":"Outil calcul rendement CRVO Lens MARS 2026 v4.xlsm","sha256":"ec2a1fb2a508d5dfe28245fc64a1ed001faa72558e9e23fc6f90f1287f6d8006"},{"file":"Outil calcul rendement CRVO Lens AVRIL 2026 v4.1.xlsm","sha256":"5ddcac9ea41416a9dfa4af0d04a84e59b388958c9a83a69b73ba9044aeadfd1a"},{"file":"Outil calcul rendement CRVO Lens MAI 2026 v4.2.xlsm","sha256":"f287f6263780b1528b9537bd884cc8bb0ee1028f876753bf1c1b340285dc961a"},{"file":"Outil calcul rendement CRVO Lens JUIN 2026 v4.2.xlsm","sha256":"c5c5c744396f044dc4c4f60d70cfcddb2206d5ccd1e071b1ef2c3069fcacb24c"}]'::jsonb,'Somme heures vendues / somme heures achetées, mars à juin 2026, équipes A/B/C. Fixline exclue.'),
('lens','carrosserie','2026-03-01','2026-06-30',8692.88,4675.02,true,'DASHBOARD','[{"file":"Outil calcul rendement CRVO Lens MARS 2026 v4.xlsm","sha256":"ec2a1fb2a508d5dfe28245fc64a1ed001faa72558e9e23fc6f90f1287f6d8006"},{"file":"Outil calcul rendement CRVO Lens AVRIL 2026 v4.1.xlsm","sha256":"5ddcac9ea41416a9dfa4af0d04a84e59b388958c9a83a69b73ba9044aeadfd1a"},{"file":"Outil calcul rendement CRVO Lens MAI 2026 v4.2.xlsm","sha256":"f287f6263780b1528b9537bd884cc8bb0ee1028f876753bf1c1b340285dc961a"},{"file":"Outil calcul rendement CRVO Lens JUIN 2026 v4.2.xlsm","sha256":"c5c5c744396f044dc4c4f60d70cfcddb2206d5ccd1e071b1ef2c3069fcacb24c"}]'::jsonb,'Somme heures vendues / somme heures achetées sur Tôlerie + Labo + Box, mars à juin 2026. Fixline explicitement exclue.'),
('lens','preparation','2026-03-01','2026-06-30',26108.45,24650.69,true,'DASHBOARD','[{"file":"Outil calcul rendement CRVO Lens MARS 2026 v4.xlsm","sha256":"ec2a1fb2a508d5dfe28245fc64a1ed001faa72558e9e23fc6f90f1287f6d8006"},{"file":"Outil calcul rendement CRVO Lens AVRIL 2026 v4.1.xlsm","sha256":"5ddcac9ea41416a9dfa4af0d04a84e59b388958c9a83a69b73ba9044aeadfd1a"},{"file":"Outil calcul rendement CRVO Lens MAI 2026 v4.2.xlsm","sha256":"f287f6263780b1528b9537bd884cc8bb0ee1028f876753bf1c1b340285dc961a"},{"file":"Outil calcul rendement CRVO Lens JUIN 2026 v4.2.xlsm","sha256":"c5c5c744396f044dc4c4f60d70cfcddb2206d5ccd1e071b1ef2c3069fcacb24c"}]'::jsonb,'Somme heures vendues / somme heures achetées, mars à juin 2026, équipes A/B/C. Fixline exclue.'),
('lens','qualite','2026-03-01','2026-06-30',7332.00,6794.21,true,'DASHBOARD','[{"file":"Outil calcul rendement CRVO Lens MARS 2026 v4.xlsm","sha256":"ec2a1fb2a508d5dfe28245fc64a1ed001faa72558e9e23fc6f90f1287f6d8006"},{"file":"Outil calcul rendement CRVO Lens AVRIL 2026 v4.1.xlsm","sha256":"5ddcac9ea41416a9dfa4af0d04a84e59b388958c9a83a69b73ba9044aeadfd1a"},{"file":"Outil calcul rendement CRVO Lens MAI 2026 v4.2.xlsm","sha256":"f287f6263780b1528b9537bd884cc8bb0ee1028f876753bf1c1b340285dc961a"},{"file":"Outil calcul rendement CRVO Lens JUIN 2026 v4.2.xlsm","sha256":"c5c5c744396f044dc4c4f60d70cfcddb2206d5ccd1e071b1ef2c3069fcacb24c"}]'::jsonb,'Somme heures vendues / somme heures achetées, mars à juin 2026, équipes A/B/C. Fixline exclue.')
on conflict (site_code,sector_key) do update set
  period_start=excluded.period_start,
  period_end=excluded.period_end,
  bought_hours=excluded.bought_hours,
  sold_hours=excluded.sold_hours,
  fixline_excluded=excluded.fixline_excluded,
  source_sheet=excluded.source_sheet,
  source_files=excluded.source_files,
  calculation_method=excluded.calculation_method,
  updated_at=now();

create or replace function public.kpi_capacity_historical_productivity(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user record;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  return jsonb_build_object(
    'connected',exists(select 1 from public.kpi_capacity_productivity_reference where site_code='lens'),
    'source','Outils calcul rendement CRVO Lens · DASHBOARD',
    'sourceSheet','DASHBOARD',
    'method','Productivité historique pondérée = somme heures vendues / somme heures achetées sur mars à juin 2026. Fixline exclue du simulateur MINI.',
    'period',jsonb_build_object(
      'start',to_char((select min(period_start) from public.kpi_capacity_productivity_reference where site_code='lens'),'YYYY-MM-DD'),
      'end',to_char((select max(period_end) from public.kpi_capacity_productivity_reference where site_code='lens'),'YYYY-MM-DD'),
      'months',4
    ),
    'sectors',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sectorKey',sector_key,
        'boughtHours',bought_hours,
        'soldHours',sold_hours,
        'productivity',case when bought_hours>0 then round(sold_hours/bought_hours*100,1) else null end,
        'monthCount',4,
        'fixlineExcluded',fixline_excluded
      ) order by case sector_key
        when 'expertise' then 1 when 'mecanique' then 2 when 'dsp' then 3
        when 'carrosserie' then 4 when 'preparation' then 5 when 'qualite' then 6 else 99 end)
      from public.kpi_capacity_productivity_reference
      where site_code='lens'
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.kpi_capacity_historical_productivity(text) from public;
grant execute on function public.kpi_capacity_historical_productivity(text) to anon, authenticated, service_role;
