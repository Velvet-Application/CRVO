create or replace function public.kpi_toolbox_widget_detail(p_session_hash text, p_widget_key text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_metrics jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_stats jsonb := '[]'::jsonb;
  v_title text;
  v_note text;
  v_source text;
begin
  v_base := public.kpi_toolbox_live_widgets(p_session_hash);
  if not exists(select 1 from jsonb_array_elements_text(coalesce(v_base->'available','[]'::jsonb)) x where x=p_widget_key) then
    raise exception 'Widget non autorisé pour ce profil.' using errcode='42501';
  end if;
  v_metrics := coalesce(v_base->'metrics','{}'::jsonb);

  if p_widget_key in ('factory_exits','entries','entry_exit_gap') then
    with d as (
      select h.snapshot_at,
             nullif(h.metrics->>'entries_vop','')::numeric entries,
             nullif(h.metrics->>'exits_vop','')::numeric exits
      from public.kpi_ftp_daily_history h
      where h.snapshot_at between v_today-9 and v_today
      order by h.snapshot_at
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'date',snapshot_at,
      'value',case when p_widget_key='factory_exits' then exits when p_widget_key='entries' then entries else coalesce(entries,0)-coalesce(exits,0) end,
      'entries',entries,'exits',exits
    ) order by snapshot_at),'[]'::jsonb) into v_trend from d;

    if p_widget_key='factory_exits' then
      v_title:='Sorties Usine';
      v_stats:=jsonb_build_array(
        jsonb_build_object('label','Sorties à ce stade','value',coalesce(v_metrics->>'factoryExits','—')||' VO'),
        jsonb_build_object('label','Objectif du jour','value',coalesce(v_metrics->>'exitObjective','—')||' VO'),
        jsonb_build_object('label','Solde du flux','value',case when coalesce((v_metrics->>'entryExitGap')::numeric,0)>=0 then '+' else '' end||coalesce(v_metrics->>'entryExitGap','—')||' VO')
      );
      v_note:='Historique glissant des sorties Factory. La journée en cours reste évolutive jusqu’à la clôture.';
    elsif p_widget_key='entries' then
      v_title:='Entrées CRVO';
      v_stats:=jsonb_build_array(
        jsonb_build_object('label','Entrées aujourd’hui','value',coalesce(v_metrics->>'entries','—')||' VO'),
        jsonb_build_object('label','Sorties aujourd’hui','value',coalesce(v_metrics->>'factoryExits','—')||' VO'),
        jsonb_build_object('label','Solde','value',case when coalesce((v_metrics->>'entryExitGap')::numeric,0)>=0 then '+' else '' end||coalesce(v_metrics->>'entryExitGap','—')||' VO')
      );
      v_note:='Lecture glissante des entrées, avec comparaison directe aux sorties du même jour.';
    else
      v_title:='Équilibre du flux';
      v_stats:=jsonb_build_array(
        jsonb_build_object('label','Entrées','value',coalesce(v_metrics->>'entries','—')||' VO'),
        jsonb_build_object('label','Sorties','value',coalesce(v_metrics->>'factoryExits','—')||' VO'),
        jsonb_build_object('label','Solde actuel','value',case when coalesce((v_metrics->>'entryExitGap')::numeric,0)>=0 then '+' else '' end||coalesce(v_metrics->>'entryExitGap','—')||' VO')
      );
      v_note:='Un solde positif augmente l’encours ; un solde négatif signifie que les sorties absorbent davantage que les entrées.';
    end if;
    v_source:=coalesce(v_metrics->>'sourceName','Factory / État du Parc');

  elsif p_widget_key='factory_stock' then
    with ranked as (
      select s.snapshot_at,s.source_name,
             nullif(s.metrics->>'factory_stock','')::numeric stock,
             nullif(s.metrics->>'stock_over_15d','')::numeric over15,
             nullif(s.metrics->>'stock_over_20d','')::numeric over20,
             row_number() over(partition by s.snapshot_at order by
               (coalesce(nullif(s.metrics->>'factory_stock','')::numeric,0)>0) desc,
               (s.source_name ilike '%live%' or s.source_name ilike '%clôture%') desc,
               (s.source_name ilike 'Import manuel%') desc) rn
      from public.kpi_public_dashboard_snapshots s
      where s.snapshot_at between v_today-9 and v_today
    ), d as (
      select * from ranked where rn=1 and stock is not null and stock>0 order by snapshot_at
    )
    select coalesce(jsonb_agg(jsonb_build_object('date',snapshot_at,'value',stock,'over15',over15,'over20',over20) order by snapshot_at),'[]'::jsonb)
      into v_trend from d;

    select jsonb_build_array(
      jsonb_build_object('label','Encours actuel','value',coalesce(v_metrics->>'factoryStock','—')||' VO'),
      jsonb_build_object('label','> 15 jours','value',coalesce(h.metrics->>'stock_over_15d','—')||' VO'),
      jsonb_build_object('label','> 20 jours','value',coalesce(h.metrics->>'stock_over_20d','—')||' VO')
    ), h.source_name
    into v_stats,v_source
    from public.kpi_ftp_daily_history h where h.snapshot_at=v_today limit 1;
    if v_stats is null then v_stats:=jsonb_build_array(jsonb_build_object('label','Encours actuel','value',coalesce(v_metrics->>'factoryStock','—')||' VO')); end if;
    v_title:='Encours Factory';
    v_note:='Évolution de l’encours sur les jours disposant d’un stock Factory fiable. Les anciens snapshots sans valeur de stock sont volontairement exclus.';

  elsif p_widget_key in ('unplanned_absence_etp','absence_rate') then
    with pop as (select * from public.kpi_worktime_population_for_date(v_today)), raw as (
      select r.employee_key,r.employee_name,r.team_code,r.service,r.sector_key,r.reason_code,r.start_date,r.end_date,
             case when coalesce(r.duration_hours,0)>0 then least(r.duration_hours,7.5) else 7.5 end::numeric hours
      from public.kpi_worktime_rh_event_source r join pop p on p.employee_key=r.employee_key
      where r.entity='CRVO' and r.status='open' and r.event_kind='absence' and r.start_date<=v_today and r.end_date>=v_today
      union all
      select e.employee_key,e.employee_name,e.team_code,e.service,p.sector_key,e.reason_code,e.start_date,e.end_date,7.5::numeric
      from public.kpi_worktime_events e join pop p on p.employee_key=e.employee_key
      where e.entity='CRVO' and e.status='open' and e.event_kind='absence' and e.start_date<=v_today and e.end_date>=v_today
    ), scoped as (
      select * from raw where reason_code=any(case when p_widget_key='unplanned_absence_etp'
        then array['sick_received','sick_pending','work_accident','unjustified','pending_qualification']::text[]
        else array['sick_received','sick_pending','long_absence','work_accident','unjustified','pending_qualification']::text[] end)
    ), per_person as (
      select employee_key,max(employee_name) employee_name,max(team_code) team_code,max(service) service,max(sector_key) sector_key,
             max(hours) hours,min(start_date) start_date,max(end_date) end_date,
             string_agg(distinct case reason_code
               when 'sick_received' then 'Maladie' when 'sick_pending' then 'Maladie en attente' when 'long_absence' then 'Absence longue'
               when 'work_accident' then 'Accident du travail' when 'unjustified' then 'Absence non justifiée'
               when 'pending_qualification' then 'À qualifier' else reason_code end, ', ' order by case reason_code
               when 'sick_received' then 'Maladie' when 'sick_pending' then 'Maladie en attente' when 'long_absence' then 'Absence longue'
               when 'work_accident' then 'Accident du travail' when 'unjustified' then 'Absence non justifiée'
               when 'pending_qualification' then 'À qualifier' else reason_code end) reason
      from scoped group by employee_key
    )
    select coalesce(jsonb_agg(jsonb_build_object('name',employee_name,'team',team_code,'service',coalesce(service,sector_key),'reason',reason,'hours',round(hours,1),'start',start_date,'end',end_date) order by coalesce(team_code,''),employee_name),'[]'::jsonb)
    into v_rows from per_person;

    with pop as (select * from public.kpi_worktime_population_for_date(v_today)), raw as (
      select distinct r.employee_key,r.reason_code from public.kpi_worktime_rh_event_source r join pop p on p.employee_key=r.employee_key
      where r.entity='CRVO' and r.status='open' and r.event_kind='absence' and r.start_date<=v_today and r.end_date>=v_today
      union
      select distinct e.employee_key,e.reason_code from public.kpi_worktime_events e join pop p on p.employee_key=e.employee_key
      where e.entity='CRVO' and e.status='open' and e.event_kind='absence' and e.start_date<=v_today and e.end_date>=v_today
    ), scoped as (
      select * from raw where reason_code=any(case when p_widget_key='unplanned_absence_etp'
        then array['sick_received','sick_pending','work_accident','unjustified','pending_qualification']::text[]
        else array['sick_received','sick_pending','long_absence','work_accident','unjustified','pending_qualification']::text[] end)
    )
    select coalesce(jsonb_agg(jsonb_build_object('label',label,'value',cnt) order by cnt desc,label),'[]'::jsonb) into v_breakdown
    from (
      select case reason_code when 'sick_received' then 'Maladie' when 'sick_pending' then 'Maladie en attente' when 'long_absence' then 'Absence longue' when 'work_accident' then 'Accident du travail' when 'unjustified' then 'Non justifiée' when 'pending_qualification' then 'À qualifier' else reason_code end label,
             count(distinct employee_key)::int cnt
      from scoped group by reason_code
    ) q;

    if p_widget_key='unplanned_absence_etp' then
      v_title:='ETP absents non planifiés';
      v_stats:=jsonb_build_array(
        jsonb_build_object('label','ETP perdus','value',coalesce(v_metrics->>'unplannedEtp','—')||' ETP'),
        jsonb_build_object('label','Personnes','value',coalesce(v_metrics->>'unplannedPeople','—')),
        jsonb_build_object('label','Heures perdues','value',coalesce(v_metrics->>'unplannedHours','—')||' h'),
        jsonb_build_object('label','Impact estimé','value',case when v_metrics->>'unplannedLostVop' is null then '—' else '≈ -'||(v_metrics->>'unplannedLostVop')||' VO' end)
      );
      v_note:='Liste des absences non planifiées actuellement intégrées au calcul de capacité.';
    else
      v_title:='Absentéisme du site';
      v_stats:=jsonb_build_array(
        jsonb_build_object('label','Taux du site','value',coalesce(v_metrics->>'absenceRate','—')||' %'),
        jsonb_build_object('label','Personnes absentes','value',coalesce(v_metrics->>'absencePeople','—')),
        jsonb_build_object('label','Population','value',coalesce(v_metrics->>'population','—'))
      );
      v_note:='Détail des absences santé, accidents du travail, absences longues et non justifiées actives aujourd’hui.';
    end if;
    v_source:='Data RH + saisies ToolBox';

  elsif p_widget_key='approved_leave' then
    with pop as (select * from public.kpi_worktime_population_for_date(v_today)), raw as (
      select r.employee_key,r.employee_name,r.team_code,r.service,r.sector_key,r.reason_code,r.start_date,r.end_date
      from public.kpi_worktime_rh_event_source r join pop p on p.employee_key=r.employee_key
      where r.entity='CRVO' and r.status='open' and r.event_kind='absence' and r.reason_code=any(array['paid_leave','rtt_recovery']::text[]) and r.start_date<=v_today and r.end_date>=v_today
      union all
      select l.employee_key,l.employee_name,l.team_code,l.service,l.sector_key,'paid_leave',l.start_date,l.end_date
      from public.kpi_worktime_leave_requests l join pop p on p.employee_key=l.employee_key
      where l.entity='CRVO' and l.status='approved' and l.start_date<=v_today and l.end_date>=v_today
    ), per_person as (
      select employee_key,max(employee_name) employee_name,max(team_code) team_code,max(service) service,max(sector_key) sector_key,
             string_agg(distinct case reason_code when 'rtt_recovery' then 'RTT / récupération' else 'Congé payé' end, ', ') reason,
             min(start_date) start_date,max(end_date) end_date
      from raw group by employee_key
    )
    select coalesce(jsonb_agg(jsonb_build_object('name',employee_name,'team',team_code,'service',coalesce(service,sector_key),'reason',reason,'start',start_date,'end',end_date) order by coalesce(team_code,''),employee_name),'[]'::jsonb)
      into v_rows from per_person;
    v_title:='CP / RTT aujourd’hui';
    v_stats:=jsonb_build_array(jsonb_build_object('label','Absences planifiées','value',coalesce(v_metrics->>'approvedLeavePeople','—')||' pers.'));
    v_note:='Ces absences sont déjà intégrées au calcul de capacité du site.';
    v_source:='Data RH + demandes validées ToolBox';

  else
    v_title:='Fraîcheur des sources FTP';
    v_stats:=jsonb_build_array(
      jsonb_build_object('label','Factory','value',coalesce(v_metrics->>'factoryAgeMin','—')||' min'),
      jsonb_build_object('label','État du Parc','value',coalesce(v_metrics->>'parkAgeMin','—')||' min'),
      jsonb_build_object('label','Dernière source','value',coalesce(v_metrics->>'sourceName','—'))
    );
    v_rows:=jsonb_build_array(
      jsonb_build_object('name','Factory','reason','Dernière donnée reçue','date',v_metrics->>'factoryModifiedAt'),
      jsonb_build_object('name','État du Parc','reason','Dernière donnée reçue','date',v_metrics->>'parkModifiedAt')
    );
    v_note:='Contrôle de fraîcheur des deux sources qui alimentent les indicateurs Live.';
    v_source:=coalesce(v_metrics->>'sourceName','FTP CRVO');
  end if;

  return jsonb_build_object(
    'key',p_widget_key,'title',v_title,'date',v_today,'generatedAt',now(),
    'stats',coalesce(v_stats,'[]'::jsonb),'trend',coalesce(v_trend,'[]'::jsonb),
    'rows',coalesce(v_rows,'[]'::jsonb),'breakdown',coalesce(v_breakdown,'[]'::jsonb),
    'note',v_note,'source',v_source
  );
end;
$function$;

grant execute on function public.kpi_toolbox_widget_detail(text,text) to anon, authenticated, service_role;
