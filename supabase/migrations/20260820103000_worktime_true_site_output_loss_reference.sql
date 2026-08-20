create or replace function public.kpi_worktime_output_loss_reference(
  p_session_hash text,
  p_entity text default 'CRVO',
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_scope record;
  v_entity text:=upper(coalesce(p_entity,'CRVO'));
  v_date date:=coalesce(p_date,(now() at time zone 'Europe/Paris')::date);
  v_today date:=(now() at time zone 'Europe/Paris')::date;
  v_ref_end date;
  v_ref_start date;
  v_avg_exits numeric;
  v_avg_etp numeric;
  v_hours_per_exit numeric;
  v_people jsonb:='[]'::jsonb;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;

  select * into v_scope from public.kpi_worktime_scope_for_user(v_user.id,v_entity) limit 1;
  if v_scope is null then raise exception 'Accès Temps de travail requis.' using errcode='42501'; end if;

  if v_entity<>'CRVO' then
    return jsonb_build_object('connected',false,'entity',v_entity,'error','Référence de production site non disponible pour cette entité.','productivePeople','[]'::jsonb);
  end if;

  v_ref_end:=least(v_date-1,v_today-1);
  v_ref_start:=v_ref_end-9;

  with ranked as (
    select s.snapshot_at,s.metrics,
      row_number() over(
        partition by s.snapshot_at
        order by case when s.source_name ilike 'FTP CRVO%' then 0 else 1 end,
                 case when s.source_name ilike '%clôture%' then 0 else 1 end,
                 s.source_name
      ) rn
    from public.kpi_public_dashboard_snapshots s
    where s.snapshot_at between v_ref_start and v_ref_end
      and extract(isodow from s.snapshot_at) between 1 and 5
  )
  select avg(nullif(metrics->>'exits_vop','')::numeric)
  into v_avg_exits
  from ranked
  where rn=1 and nullif(metrics->>'exits_vop','') is not null;

  with daily as (
    select f.work_date,sum(f.time_value)::numeric/7.5 as available_etp
    from public.kpi_sql_presence_facts f
    join public.kpi_rh_presence_code_map m
      on m.time_code=f.time_code and m.counts_as_presence and not m.excluded
    where f.work_date between v_ref_start and v_ref_end
      and extract(isodow from f.work_date) between 1 and 5
      and m.sector_key in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo')
    group by f.work_date
  )
  select avg(available_etp) into v_avg_etp from daily where available_etp>0;

  if coalesce(v_avg_exits,0)>0 and coalesce(v_avg_etp,0)>0 then
    v_hours_per_exit:=v_avg_etp*7.5/v_avg_exits;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'employeeKey',e.employee_key,
    'sectorKey',case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end,
    'team',e.team_code
  ) order by e.full_name),'[]'::jsonb)
  into v_people
  from public.kpi_staff_effective e
  where e.team_code in ('A','B','C')
    and e.primary_population in ('productif','fixline')
    and not coalesce(e.neutralized,false)
    and (e.entry_date is null or e.entry_date<=v_date)
    and (e.exit_date is null or e.exit_date>v_date)
    and (case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end)
        in ('expertise','mecanique','dsp','jantes','carrosserie','preparation','qualite','photo')
    and (v_scope.all_access or '*'=any(v_scope.team_codes) or e.team_code=any(v_scope.team_codes))
    and (v_scope.all_access or '*'=any(v_scope.sector_keys) or (case when e.primary_sector_key='lavage' then 'preparation' else e.primary_sector_key end)=any(v_scope.sector_keys));

  return jsonb_build_object(
    'connected',v_hours_per_exit is not null,
    'entity',v_entity,
    'source','Débit réel CRVO · 10 jours glissants précédents',
    'period',jsonb_build_object('start',v_ref_start,'end',v_ref_end),
    'avgExitsPerDay',case when v_avg_exits is null then null else round(v_avg_exits,2) end,
    'avgAvailableEtp',case when v_avg_etp is null then null else round(v_avg_etp,2) end,
    'hoursPerSiteVop',case when v_hours_per_exit is null then null else round(v_hours_per_exit,3) end,
    'siteVopPerProductiveHour',case when v_hours_per_exit is null or v_hours_per_exit=0 then null else round(1/v_hours_per_exit,4) end,
    'productivePeople',v_people,
    'method','VO de production perdues estimées = heures productives réellement perdues / heures productives moyennes nécessaires à une Sortie Usine sur la référence récente. Les fonctions support et encadrement ne sont pas convertis en VO.'
  );
end
$$;

revoke all on function public.kpi_worktime_output_loss_reference(text,text,date) from public;
grant execute on function public.kpi_worktime_output_loss_reference(text,text,date) to anon,authenticated,service_role;
