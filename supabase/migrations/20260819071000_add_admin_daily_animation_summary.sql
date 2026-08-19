create or replace function public.kpi_daily_animation_admin(
  p_session_hash text,
  p_report_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
set statement_timeout to '30s'
as $function$
declare
  v_user record;
  v_today date := (timezone('Europe/Paris', now()))::date;
  v_report_date date;
  v_month_start date;
  v_month_end date;
  v_report_metrics jsonb := '{}'::jsonb;
  v_report_source text := null;
  v_entries_day numeric := 0;
  v_exits_day numeric := 0;
  v_stock_day numeric := 0;
  v_over15_day numeric := 0;
  v_over20_day numeric := 0;
  v_entries_mtd numeric := 0;
  v_exits_mtd numeric := 0;
  v_exit_target_day numeric := null;
  v_exit_target_mtd numeric := null;
  v_revenue_day numeric := 0;
  v_revenue_mtd numeric := 0;
  v_invoices_day integer := 0;
  v_invoices_mtd integer := 0;
  v_labor_hours_day numeric := 0;
  v_labor_hours_mtd numeric := 0;
  v_labor_revenue_mtd numeric := 0;
  v_finance_as_of date := null;
  v_budget numeric := null;
  v_business_days integer := 1;
  v_elapsed_business_days integer := 0;
  v_revenue_day_target numeric := null;
  v_revenue_target_at_date numeric := null;
  v_bottleneck_key text := null;
  v_bottleneck_label text := null;
  v_bottleneck_actual integer := null;
  v_bottleneck_max numeric := null;
  v_bottleneck_over numeric := null;
  v_urgents integer := 0;
  v_quality_alerts integer := 0;
  v_live_stock numeric := null;
  v_live_over20 numeric := null;
  v_latest_batch uuid := null;
  v_production jsonb := '[]'::jsonb;
  v_tone text := 'watch';
begin
  select * into v_user
  from public.crvo_auth_validate(p_session_hash)
  where ok
  limit 1;

  if v_user is null then
    raise exception 'Session CRVO requise.' using errcode='42501';
  end if;
  if v_user.role <> 'admin' then
    raise exception 'Accès administrateur requis.' using errcode='42501';
  end if;

  if p_report_date is not null then
    v_report_date := p_report_date;
  else
    select max(snapshot_at) into v_report_date
    from public.kpi_public_dashboard_snapshots
    where snapshot_at < v_today;

    if v_report_date is null then
      select max(snapshot_at) into v_report_date
      from public.kpi_public_dashboard_snapshots
      where snapshot_at <= v_today;
    end if;
  end if;

  if v_report_date is null then
    return jsonb_build_object('connected',false,'error','Aucune journée clôturée disponible.');
  end if;

  v_month_start := date_trunc('month', v_report_date)::date;
  v_month_end := (v_month_start + interval '1 month')::date;

  with ranked as (
    select s.*,
      row_number() over (
        partition by s.snapshot_at
        order by case
          when lower(s.source_name) like '%ftp%' or lower(s.source_name) like '%sftp%' then 30
          when lower(s.source_name) like '%manuel%' or lower(s.source_name) like '%book%' or lower(s.source_name) like '%excel%' then 20
          else 10
        end desc,
        s.source_name desc
      ) rn
    from public.kpi_public_dashboard_snapshots s
    where s.snapshot_at = v_report_date
  )
  select coalesce(metrics,'{}'::jsonb), source_name
    into v_report_metrics, v_report_source
  from ranked
  where rn=1
  limit 1;

  if v_report_source is null then
    return jsonb_build_object('connected',false,'error','Aucune donnée opérationnelle pour la date demandée.','reportDate',v_report_date);
  end if;

  v_entries_day := coalesce(nullif(v_report_metrics->>'entries_vop','')::numeric,0);
  v_exits_day := coalesce(nullif(v_report_metrics->>'exits_vop','')::numeric, nullif(v_report_metrics->>'production_factory_exit','')::numeric,0);
  v_stock_day := coalesce(nullif(v_report_metrics->>'factory_stock','')::numeric,0);
  v_over15_day := coalesce(nullif(v_report_metrics->>'stock_over_15d','')::numeric,0);
  v_over20_day := coalesce(nullif(v_report_metrics->>'stock_over_20d','')::numeric,0);

  v_production := jsonb_build_array(
    jsonb_build_object('key','expertise','label','Expertise','value',coalesce(nullif(v_report_metrics->>'production_expertise','')::numeric,0),'color','#eb5b56'),
    jsonb_build_object('key','mecanique','label','Mécanique','value',coalesce(nullif(v_report_metrics->>'production_mechanics','')::numeric,0),'color','#47b9b4'),
    jsonb_build_object('key','dsp','label','DSP','value',coalesce(nullif(v_report_metrics->>'production_dsp','')::numeric,0),'color','#009edb'),
    jsonb_build_object('key','carrosserie','label','Carrosserie','value',coalesce(nullif(v_report_metrics->>'production_bodywork','')::numeric,0),'color','#fec82f'),
    jsonb_build_object('key','preparation','label','Préparation','value',coalesce(nullif(v_report_metrics->>'production_preparation','')::numeric,0),'color','#8d5ec7'),
    jsonb_build_object('key','qualite','label','Qualité','value',coalesce(nullif(v_report_metrics->>'production_quality','')::numeric,0),'color','#004f9f')
  );

  with ranked as (
    select s.*,
      row_number() over (
        partition by s.snapshot_at
        order by case
          when lower(s.source_name) like '%ftp%' or lower(s.source_name) like '%sftp%' then 30
          when lower(s.source_name) like '%manuel%' or lower(s.source_name) like '%book%' or lower(s.source_name) like '%excel%' then 20
          else 10
        end desc,
        s.source_name desc
      ) rn
    from public.kpi_public_dashboard_snapshots s
    where s.snapshot_at >= v_month_start
      and s.snapshot_at <= v_report_date
  )
  select
    coalesce(sum(coalesce(nullif(metrics->>'entries_vop','')::numeric,0)),0),
    coalesce(sum(coalesce(nullif(metrics->>'exits_vop','')::numeric,nullif(metrics->>'production_factory_exit','')::numeric,0)),0)
  into v_entries_mtd, v_exits_mtd
  from ranked
  where rn=1;

  select d.target_value into v_exit_target_day
  from public.kpi_daily_exit_objectives d
  where d.target_date=v_report_date
  limit 1;

  select sum(d.target_value) into v_exit_target_mtd
  from public.kpi_daily_exit_objectives d
  where d.target_date>=v_month_start and d.target_date<=v_report_date;

  select t.revenue_target into v_budget
  from public.kpi_finance_targets t
  where t.month=v_month_start
  limit 1;

  select greatest(count(*)::integer,1) into v_business_days
  from generate_series(v_month_start, v_month_end - 1, interval '1 day') d
  where extract(isodow from d) between 1 and 5;

  select count(*)::integer into v_elapsed_business_days
  from generate_series(v_month_start, v_report_date, interval '1 day') d
  where extract(isodow from d) between 1 and 5;

  if v_budget is not null then
    v_revenue_day_target := round(v_budget / v_business_days,2);
    v_revenue_target_at_date := round(v_budget * v_elapsed_business_days / v_business_days,2);
  end if;

  select
    coalesce(sum(i.revenue_total) filter (where i.invoice_date=v_report_date),0),
    count(*) filter (where i.invoice_date=v_report_date)::integer,
    coalesce(sum(i.labor_hours) filter (where i.invoice_date=v_report_date),0),
    coalesce(sum(i.revenue_total),0),
    count(*)::integer,
    coalesce(sum(i.labor_hours),0),
    coalesce(sum(i.labor_revenue),0),
    max(i.invoice_date)
  into
    v_revenue_day,
    v_invoices_day,
    v_labor_hours_day,
    v_revenue_mtd,
    v_invoices_mtd,
    v_labor_hours_mtd,
    v_labor_revenue_mtd,
    v_finance_as_of
  from public.kpi_invoice_facts i
  where i.source_name='SQL Reporting factures CRVO'
    and i.invoice_date>=v_month_start
    and i.invoice_date<=v_report_date;

  with candidates as (
    select
      b.sector_key,
      b.sector_label,
      b.vehicle_count,
      o.max_threshold,
      case when o.max_threshold is not null then greatest(b.vehicle_count-o.max_threshold,0) else 0 end as over_value,
      case when coalesce(o.max_threshold,0)>0 then b.vehicle_count/o.max_threshold else 0 end as ratio
    from public.kpi_bottleneck_live_public b
    left join public.kpi_monthly_objectives o
      on o.month=v_month_start and o.sector_key=b.sector_key
  )
  select sector_key,sector_label,vehicle_count,max_threshold,over_value
  into v_bottleneck_key,v_bottleneck_label,v_bottleneck_actual,v_bottleneck_max,v_bottleneck_over
  from candidates
  order by (over_value>0) desc, ratio desc, vehicle_count desc
  limit 1;

  select import_batch_id into v_latest_batch
  from public.kpi_ftp_vehicle_state
  order by created_at desc
  limit 1;

  if v_latest_batch is not null then
    select
      count(*) filter (
        where lower(coalesce(urgency,'')) not in ('','0','non','non urgent','aucune','false')
           or lower(coalesce(alert,'')) like '%urgent%'
      )::integer,
      count(*) filter (
        where lower(coalesce(alert,'')) ~ '(^|[^a-z])nc([^a-z]|$)'
           or lower(coalesce(status,'')) like '%non conform%'
      )::integer
    into v_urgents,v_quality_alerts
    from public.kpi_ftp_vehicle_state
    where import_batch_id=v_latest_batch;
  end if;

  select
    nullif(metrics->>'factory_stock','')::numeric,
    nullif(metrics->>'stock_over_20d','')::numeric
  into v_live_stock,v_live_over20
  from public.kpi_ftp_live_dashboard
  limit 1;

  if coalesce(v_exit_target_mtd,0)>0 and v_budget is not null then
    if v_exits_mtd >= v_exit_target_mtd and v_revenue_mtd >= coalesce(v_revenue_target_at_date,0) then
      v_tone := 'ahead';
    elsif v_exits_mtd < v_exit_target_mtd * 0.95 or v_revenue_mtd < coalesce(v_revenue_target_at_date,0) * 0.95 then
      v_tone := 'alert';
    else
      v_tone := 'watch';
    end if;
  elsif coalesce(v_exit_target_mtd,0)>0 then
    v_tone := case when v_exits_mtd>=v_exit_target_mtd then 'ahead' else 'watch' end;
  end if;

  return jsonb_build_object(
    'connected',true,
    'centre','Lens',
    'reportDate',to_char(v_report_date,'YYYY-MM-DD'),
    'generatedAt',now(),
    'generatedBy',v_user.display_name,
    'yesterday',jsonb_build_object(
      'entries',round(v_entries_day,0),
      'exits',round(v_exits_day,0),
      'exitTarget',v_exit_target_day,
      'stock',round(v_stock_day,0),
      'over15',round(v_over15_day,0),
      'over20',round(v_over20_day,0),
      'revenue',round(v_revenue_day,2),
      'revenueTarget',v_revenue_day_target,
      'invoices',v_invoices_day,
      'laborHours',round(v_labor_hours_day,2),
      'production',v_production
    ),
    'month',jsonb_build_object(
      'entries',round(v_entries_mtd,0),
      'exits',round(v_exits_mtd,0),
      'exitTarget',v_exit_target_mtd,
      'exitDelta',case when v_exit_target_mtd is null then null else round(v_exits_mtd-v_exit_target_mtd,0) end,
      'revenue',round(v_revenue_mtd,2),
      'revenueTargetAtDate',v_revenue_target_at_date,
      'revenueMonthlyTarget',v_budget,
      'revenueDelta',case when v_revenue_target_at_date is null then null else round(v_revenue_mtd-v_revenue_target_at_date,2) end,
      'invoices',v_invoices_mtd,
      'fre',case when v_invoices_mtd>0 then round(v_revenue_mtd/v_invoices_mtd,0) else null end,
      'laborHours',round(v_labor_hours_mtd,2),
      'hoursPerExit',case when v_exits_mtd>0 then round(v_labor_hours_mtd/v_exits_mtd,2) else null end,
      'laborRevenue',round(v_labor_revenue_mtd,2),
      'businessDaysElapsed',v_elapsed_business_days,
      'businessDaysMonth',v_business_days
    ),
    'pilotage',jsonb_build_object(
      'tone',v_tone,
      'urgents',coalesce(v_urgents,0),
      'qualityAlerts',coalesce(v_quality_alerts,0),
      'currentStock',v_live_stock,
      'currentOver20',v_live_over20,
      'criticalBottleneck',case when v_bottleneck_key is null then null else jsonb_build_object(
        'key',v_bottleneck_key,
        'label',v_bottleneck_label,
        'actual',v_bottleneck_actual,
        'max',v_bottleneck_max,
        'over',v_bottleneck_over
      ) end
    ),
    'sources',jsonb_build_object(
      'operations',v_report_source,
      'finance','Reporting factures CRVO',
      'financeAsOfDate',case when v_finance_as_of is null then null else to_char(v_finance_as_of,'YYYY-MM-DD') end,
      'objectives','Planning quotidien KPI CRVO',
      'park','EtatduParc FTP'
    )
  );
end
$function$;

revoke all on function public.kpi_daily_animation_admin(text,date) from public;
grant execute on function public.kpi_daily_animation_admin(text,date) to anon, authenticated, service_role;
