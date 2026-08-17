create or replace function public.kpi_kiosk_direction_finance(p_history boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (timezone('Europe/Paris', now()))::date;
  v_month_start date := date_trunc('month', (timezone('Europe/Paris', now()))::date)::date;
  v_month_end date := (date_trunc('month', (timezone('Europe/Paris', now()))::date) + interval '1 month')::date;
  v_budget numeric := null;
  v_business_days integer := 1;
  v_latest_invoice_date date := null;
  v_snapshots jsonb := '[]'::jsonb;
  v_latest jsonb := null;
begin
  select t.revenue_target into v_budget
  from public.kpi_finance_targets t
  where t.month=v_month_start
  limit 1;

  select greatest(count(*)::integer,1) into v_business_days
  from generate_series(v_month_start, v_month_end - 1, interval '1 day') d
  where extract(isodow from d) between 1 and 5;

  select max(i.invoice_date) into v_latest_invoice_date
  from public.kpi_invoice_facts i
  where i.invoice_date >= v_month_start
    and i.invoice_date < v_month_end
    and i.invoice_date <= v_today
    and i.source_name='SQL Reporting factures CRVO';

  if v_latest_invoice_date is null then
    return jsonb_build_object(
      'connected',false,
      'backend','kiosk-finance-rpc',
      'targetConfigured',v_budget is not null,
      'budget',v_budget,
      'asOfDate',null,
      'snapshot',null,
      'snapshots',case when p_history then '[]'::jsonb else null end,
      'error','Aucune facture réelle importée pour le mois courant.'
    );
  end if;

  with invoice_day as (
    select
      i.invoice_date as d,
      count(*)::integer as invoices_day,
      coalesce(sum(i.revenue_total),0)::numeric as revenue_day,
      coalesce(sum(i.labor_revenue),0)::numeric as labor_revenue_day,
      coalesce(sum(i.labor_hours),0)::numeric as labor_hours_day
    from public.kpi_invoice_facts i
    where i.invoice_date >= v_month_start
      and i.invoice_date < v_month_end
      and i.invoice_date <= v_latest_invoice_date
      and i.source_name='SQL Reporting factures CRVO'
    group by i.invoice_date
  ), calc as (
    select
      id.d,
      id.invoices_day,
      id.revenue_day,
      id.labor_revenue_day,
      id.labor_hours_day,
      sum(id.invoices_day) over(order by id.d)::integer as invoices_cumulative,
      sum(id.revenue_day) over(order by id.d)::numeric as revenue_cumulative,
      sum(id.labor_revenue_day) over(order by id.d)::numeric as labor_revenue_cumulative,
      sum(id.labor_hours_day) over(order by id.d)::numeric as labor_hours_cumulative
    from invoice_day id
  ), decorated as (
    select c.d,
      jsonb_build_object(
        'date',to_char(c.d,'YYYY-MM-DD'),
        'source','Reporting factures CRVO · kiosk',
        'filename','Reporting CRVO Lens factures',
        'metrics',jsonb_build_object(
          'revenue_day',round(c.revenue_day,2),
          'revenue_cumulative',round(c.revenue_cumulative,2),
          'revenue_day_target',case when v_budget is null then null else round(v_budget/v_business_days,2) end,
          'revenue_cumulative_target',case when v_budget is null then null else round(v_budget,2) end,
          'labor_revenue_day',round(c.labor_revenue_day,2),
          'labor_revenue_cumulative',round(c.labor_revenue_cumulative,2),
          'labor_hours_day',round(c.labor_hours_day,2),
          'labor_hours',round(c.labor_hours_cumulative,2),
          'invoices_day',c.invoices_day,
          'invoices_cumulative',c.invoices_cumulative,
          'sql_invoice_source',1
        )
      ) as payload
    from calc c
    order by c.d
  )
  select coalesce(jsonb_agg(payload order by d desc),'[]'::jsonb),(array_agg(payload order by d desc))[1]
  into v_snapshots,v_latest
  from decorated;

  return jsonb_build_object(
    'connected',true,
    'backend','kiosk-finance-rpc',
    'targetConfigured',v_budget is not null,
    'budget',v_budget,
    'asOfDate',to_char(v_latest_invoice_date,'YYYY-MM-DD'),
    'snapshot',v_latest,
    'snapshots',case when p_history then v_snapshots else null end
  );
end;
$function$;

revoke all on function public.kpi_kiosk_direction_finance(boolean) from public;
grant execute on function public.kpi_kiosk_direction_finance(boolean) to anon, authenticated;
comment on function public.kpi_kiosk_direction_finance(boolean) is 'Read-only aggregated finance payload for the CRVO direction kiosk. Does not expose invoice-level data.';
