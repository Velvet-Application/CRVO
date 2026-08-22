create or replace function public.kpi_pr_dev_bodyshop_dashboard(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $fn$
declare v_auth record; v_setting jsonb; v_result jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès Magasin non autorisé.' using errcode='42501'; end if;
  select value into v_setting from public.kpi_pr_settings where key='bodyshop_consumables';
  with months as (
    select generate_series(date_trunc('month',current_date)-interval '11 months',date_trunc('month',current_date),interval '1 month')::date month_start
  ), cons as (
    select cp.period_month month_start,coalesce(sum(abs(m.value_delta_ht)),0) amount_ht
    from public.kpi_pr_bodyshop_cession_periods cp
    left join public.kpi_pr_movements m on m.work_order=cp.work_order
      and date_trunc('month',m.created_at)::date=cp.period_month
      and m.movement_type in ('issue_work_order','package_issue')
    group by cp.period_month
  ), quality as (
    select month_start,max(vop) vop from public.kpi_quality_monthly_outputs group by month_start
  ), exits as (
    select date_trunc('month',to_timestamp(factory_exit_date,'DD/MM/YYYY HH24:MI:SS'))::date month_start,
           count(distinct coalesce(nullif(vin,''),nullif(registration,''),work_order)) vop
    from public.kpi_ftp_lead_time_state
    where nullif(factory_exit_date,'') is not null
    group by 1
  ), series as (
    select mm.month_start,coalesce(c.amount_ht,0) amount_ht,coalesce(q.vop,e.vop,0) vop,
      case when coalesce(q.vop,e.vop,0)>0 then round(coalesce(c.amount_ht,0)/coalesce(q.vop,e.vop,0),2) else 0 end per_vop,
      cp.work_order,cp.confidence
    from months mm
    left join cons c using(month_start)
    left join quality q using(month_start)
    left join exits e using(month_start)
    left join public.kpi_pr_bodyshop_cession_periods cp on cp.period_month=mm.month_start
  )
  select jsonb_build_object(
    'cessionWorkOrder',coalesce(v_setting->>'cessionWorkOrder',''),
    'targetEuroPerVop',coalesce(nullif(v_setting->>'targetEuroPerVop','')::numeric,0),
    'current',(select jsonb_build_object('monthStart',month_start,'amountHt',round(amount_ht,2),'vop',vop,'perVop',per_vop,'workOrder',work_order,'confidence',confidence) from series order by month_start desc limit 1),
    'months',(select jsonb_agg(jsonb_build_object('monthStart',month_start,'amountHt',round(amount_ht,2),'vop',vop,'perVop',per_vop,'workOrder',work_order,'confidence',confidence) order by month_start) from series)
  ) into v_result;
  return v_result;
end;
$fn$;
