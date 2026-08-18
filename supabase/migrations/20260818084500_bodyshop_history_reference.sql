create table if not exists public.kpi_capacity_bodyshop_history (
  month date primary key,
  fixline_total numeric not null default 0,
  box_total numeric not null default 0,
  weekend_extra numeric not null default 0,
  treated_total numeric not null default 0,
  observed_days integer not null default 0,
  is_full_month boolean not null default false,
  source_filename text not null,
  note text,
  imported_at timestamptz not null default now()
);

alter table public.kpi_capacity_bodyshop_history enable row level security;
revoke all on public.kpi_capacity_bodyshop_history from public, anon, authenticated;

create table if not exists public.kpi_capacity_bodyshop_settings (
  id smallint primary key check (id = 1),
  average_backlog numeric not null default 200,
  source_note text,
  updated_at timestamptz not null default now()
);

alter table public.kpi_capacity_bodyshop_settings enable row level security;
revoke all on public.kpi_capacity_bodyshop_settings from public, anon, authenticated;

insert into public.kpi_capacity_bodyshop_history(month,fixline_total,box_total,weekend_extra,treated_total,observed_days,is_full_month,source_filename,note)
values
(date '2026-02-01',554,184,0,738,20,true,'suivi carrosserie.xlsx',null),
(date '2026-03-01',755,271,0,1026,22,true,'suivi carrosserie.xlsx',null),
(date '2026-04-01',759,207,12,978,21,true,'suivi carrosserie.xlsx','+12 voitures samedi 25'),
(date '2026-05-01',716,150,0,866,21,true,'suivi carrosserie.xlsx',null),
(date '2026-06-01',846,186,8,1040,22,true,'suivi carrosserie.xlsx','+8 samedi équipe A'),
(date '2026-07-01',904,189,15,1108,22,true,'suivi carrosserie.xlsx','samedi : 11 Fixline + 4 tôlerie'),
(date '2026-08-01',407,75,0,482,11,false,'suivi carrosserie.xlsx','mois en cours, exclu de la moyenne')
on conflict(month) do update set
  fixline_total=excluded.fixline_total,
  box_total=excluded.box_total,
  weekend_extra=excluded.weekend_extra,
  treated_total=excluded.treated_total,
  observed_days=excluded.observed_days,
  is_full_month=excluded.is_full_month,
  source_filename=excluded.source_filename,
  note=excluded.note,
  imported_at=now();

insert into public.kpi_capacity_bodyshop_settings(id,average_backlog,source_note)
values(1,200,'Encours moyen communiqué : 200 VOP en attente carrosserie')
on conflict(id) do update set average_backlog=excluded.average_backlog,source_note=excluded.source_note,updated_at=now();

create or replace function public.kpi_capacity_bodyshop_reference(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_auth record;
  v_months jsonb := '[]'::jsonb;
  v_avg_month numeric := 0;
  v_avg_day numeric := 0;
  v_count integer := 0;
  v_backlog numeric := 200;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_session_hash) limit 1;
  if v_auth.ok is distinct from true then raise exception 'unauthorized' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'forbidden' using errcode='42501'; end if;

  select count(*),coalesce(avg(treated_total),0),
         case when sum(observed_days)>0 then sum(treated_total)/sum(observed_days) else 0 end,
         coalesce(jsonb_agg(jsonb_build_object(
           'month',to_char(month,'YYYY-MM'),
           'fixline',fixline_total,
           'box',box_total,
           'weekendExtra',weekend_extra,
           'treated',treated_total,
           'observedDays',observed_days,
           'note',note
         ) order by month),'[]'::jsonb)
  into v_count,v_avg_month,v_avg_day,v_months
  from public.kpi_capacity_bodyshop_history
  where is_full_month;

  select average_backlog into v_backlog from public.kpi_capacity_bodyshop_settings where id=1;

  return jsonb_build_object(
    'source','suivi carrosserie.xlsx',
    'fullMonthCount',v_count,
    'averageMonthlyTreated',round(v_avg_month,1),
    'averageDailyTreated',round(v_avg_day,2),
    'averageBacklog',coalesce(v_backlog,200),
    'months',v_months
  );
end $$;

revoke all on function public.kpi_capacity_bodyshop_reference(text) from public;
grant execute on function public.kpi_capacity_bodyshop_reference(text) to anon,authenticated,service_role;
