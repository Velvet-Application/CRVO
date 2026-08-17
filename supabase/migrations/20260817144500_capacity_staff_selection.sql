create table if not exists public.kpi_capacity_staff_selection (
  site_code text not null default 'lens',
  employee_key text not null,
  included boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (site_code, employee_key)
);
alter table public.kpi_capacity_staff_selection enable row level security;

create or replace function public.kpi_capacity_roster(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user record;
  v_today date := (timezone('Europe/Paris',now()))::date;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employeeKey',r.employee_key,
      'matricule',r.matricule,
      'fullName',r.full_name,
      'jobTitle',r.job_title,
      'sectorKey',r.primary_sector_key,
      'sectorLabel',r.primary_sector_label,
      'teamCode',r.team_code,
      'included',coalesce(s.included,true)
    ) order by r.primary_sector_key,r.full_name)
    from public.kpi_staff_registry r
    left join public.kpi_capacity_staff_selection s
      on s.site_code='lens' and s.employee_key=r.employee_key
    where r.active=true
      and (r.entry_date is null or r.entry_date<=v_today)
      and (r.exit_date is null or r.exit_date>v_today)
      and r.primary_sector_key in ('expertise','mecanique','dsp','carrosserie','preparation','qualite')
  ),'[]'::jsonb);
end
$$;

create or replace function public.kpi_capacity_staff_set(p_session_hash text,p_employee_key text,p_included boolean)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user record;
  v_exists boolean;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_user.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;

  select exists(select 1 from public.kpi_staff_registry r where r.employee_key=p_employee_key) into v_exists;
  if not v_exists then raise exception 'Collaborateur introuvable.' using errcode='22023'; end if;

  insert into public.kpi_capacity_staff_selection(site_code,employee_key,included,updated_at,updated_by)
  values('lens',p_employee_key,coalesce(p_included,true),now(),v_user.username)
  on conflict(site_code,employee_key) do update set
    included=excluded.included,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by;

  return jsonb_build_object('ok',true,'employeeKey',p_employee_key,'included',coalesce(p_included,true));
end
$$;

grant execute on function public.kpi_capacity_roster(text) to anon,authenticated,service_role;
grant execute on function public.kpi_capacity_staff_set(text,text,boolean) to anon,authenticated,service_role;
