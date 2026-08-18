delete from public.kpi_historical_productivity_hours
where site_code='lens'
  and sector_key not in ('expertise','mecanique','dsp','carrosserie','preparation','qualite');

comment on table public.kpi_historical_productivity_hours is
'Historique heures achetées / vendues extrait des DASHBOARD rendement Lens. Périmètre dédié au simulateur MINI : Expertise, Mécanique, DSP, Carrosserie (Fixline conservée mais exclue des calculs), Préparation, Qualité.';
