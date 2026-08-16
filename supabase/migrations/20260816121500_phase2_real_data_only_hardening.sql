create table if not exists public.kpi_finance_targets (
  month date primary key,
  revenue_target numeric not null check (revenue_target >= 0),
  source text not null,
  updated_at timestamptz not null default now(),
  constraint kpi_finance_targets_month_start check (month = date_trunc('month', month)::date)
);

with ranked as (
  select date_trunc('month', snapshot_at)::date month,
         nullif(metrics->>'revenue_cumulative_target','')::numeric target,
         row_number() over(partition by date_trunc('month', snapshot_at)::date order by snapshot_at desc, imported_at desc) rn
  from public.kpi_financial_snapshots
  where metrics ? 'revenue_cumulative_target'
    and nullif(metrics->>'revenue_cumulative_target','')::numeric > 0
)
insert into public.kpi_finance_targets(month,revenue_target,source,updated_at)
select month,target,'Référentiel financier CRVO importé',now() from ranked where rn=1
on conflict(month) do update set revenue_target=excluded.revenue_target,source=excluded.source,updated_at=excluded.updated_at;

with mapping(sector_key,sector_label,metric_key) as (
  values ('expertise','Expertise','bottleneck_expertise'),('chiffrage','Chiffrage','bottleneck_chiffrage'),
  ('controle_technique','Contrôle technique','bottleneck_controle_technique'),('dsp','DSP','bottleneck_dsp'),
  ('jantes','Jantes','bottleneck_jantes'),('mecanique','Mécanique','bottleneck_mecanique'),
  ('carrosserie','Carrosserie','bottleneck_carrosserie'),('parc_travaux','Parc travaux','bottleneck_parc_travaux'),
  ('preparation','Préparation','bottleneck_preparation')
)
insert into public.kpi_bottleneck_daily_snapshots(snapshot_date,sector_key,sector_label,vehicle_count,source_modified_at,frozen_at)
select d.snapshot_at,m.sector_key,m.sector_label,(d.metrics->>m.metric_key)::integer,null,now()
from public.kpi_dashboard_snapshots d cross join mapping m
where d.status='verified' and d.metrics ? m.metric_key and nullif(d.metrics->>m.metric_key,'') is not null
on conflict(snapshot_date,sector_key) do nothing;

update public.kpi_data_sources set kind='manual',name='Historique Excel CRVO quotidien'
where kind='seed' or name='Classeur Excel CRVO quotidien';

create or replace function public.kpi_direction_finance(p_session_hash text,p_history boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_today date:=(timezone('Europe/Paris',now()))::date;
  v_month_start date:=date_trunc('month',(timezone('Europe/Paris',now()))::date)::date;
  v_month_end date:=(date_trunc('month',(timezone('Europe/Paris',now()))::date)+interval '1 month')::date;
  v_budget numeric:=null; v_business_days integer:=1; v_latest_invoice_date date:=null;
  v_snapshots jsonb:='[]'::jsonb; v_latest jsonb:=null;
begin
  if not exists(select 1 from public.crvo_auth_validate(p_session_hash) v where v.ok) then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  select t.revenue_target into v_budget from public.kpi_finance_targets t where t.month=v_month_start limit 1;
  select greatest(count(*)::integer,1) into v_business_days from generate_series(v_month_start,v_month_end-1,interval '1 day') d where extract(isodow from d) between 1 and 5;
  select max(i.invoice_date) into v_latest_invoice_date from public.kpi_invoice_facts i where i.invoice_date>=v_month_start and i.invoice_date<v_month_end and i.invoice_date<=v_today and i.source_name='SQL Reporting factures CRVO';
  if v_latest_invoice_date is null then
    return jsonb_build_object('connected',false,'backend','authenticated-direct-invoices','targetConfigured',v_budget is not null,'asOfDate',null,'snapshot',null,'snapshots',case when p_history then '[]'::jsonb else null end,'error','Aucune facture réelle importée pour le mois courant.');
  end if;
  with invoice_day as (
    select i.invoice_date d,count(*)::integer invoices_day,coalesce(sum(i.revenue_total),0)::numeric revenue_day,
           coalesce(sum(i.labor_revenue),0)::numeric labor_revenue_day,coalesce(sum(i.labor_hours),0)::numeric labor_hours_day
    from public.kpi_invoice_facts i where i.invoice_date>=v_month_start and i.invoice_date<v_month_end and i.invoice_date<=v_latest_invoice_date and i.source_name='SQL Reporting factures CRVO' group by i.invoice_date
  ),calc as (
    select id.d,id.invoices_day,id.revenue_day,id.labor_revenue_day,id.labor_hours_day,
           sum(id.invoices_day) over(order by id.d)::integer invoices_cumulative,
           sum(id.revenue_day) over(order by id.d)::numeric revenue_cumulative,
           sum(id.labor_revenue_day) over(order by id.d)::numeric labor_revenue_cumulative,
           sum(id.labor_hours_day) over(order by id.d)::numeric labor_hours_cumulative from invoice_day id
  ),decorated as (
    select c.d,jsonb_build_object('date',to_char(c.d,'YYYY-MM-DD'),'source','Reporting factures CRVO · direct','filename','Reporting CRVO Lens factures','metrics',jsonb_build_object(
      'revenue_day',round(c.revenue_day,2),'revenue_cumulative',round(c.revenue_cumulative,2),
      'revenue_day_target',case when v_budget is null then null else round(v_budget/v_business_days,2) end,
      'revenue_cumulative_target',case when v_budget is null then null else round(v_budget,2) end,
      'labor_revenue_day',round(c.labor_revenue_day,2),'labor_revenue_cumulative',round(c.labor_revenue_cumulative,2),
      'labor_hours_day',round(c.labor_hours_day,2),'labor_hours',round(c.labor_hours_cumulative,2),
      'invoices_day',c.invoices_day,'invoices_cumulative',c.invoices_cumulative,'sql_invoice_source',1)) payload from calc c order by c.d
  ) select coalesce(jsonb_agg(payload order by d desc),'[]'::jsonb),(array_agg(payload order by d desc))[1] into v_snapshots,v_latest from decorated;
  return jsonb_build_object('connected',true,'backend','authenticated-direct-invoices','targetConfigured',v_budget is not null,'asOfDate',to_char(v_latest_invoice_date,'YYYY-MM-DD'),'snapshot',v_latest,'snapshots',case when p_history then v_snapshots else null end);
end;$function$;

revoke all on public.kpi_finance_targets from anon,authenticated;
revoke select on public.kpi_rh_staff_dimension,public.kpi_sql_presence_facts,public.kpi_billed_time_facts,public.kpi_invoice_facts,public.kpi_vehicle_workload,public.kpi_ftp_vehicle_state,
public.kpi_bonus_components,public.kpi_bonus_employee_config,public.kpi_bonus_events,public.kpi_bonus_exports,public.kpi_bonus_manual_inputs,public.kpi_bonus_payplan_rules,public.kpi_bonus_payplan_versions,public.kpi_bonus_source_enrichment,public.kpi_bonus_validations,public.kpi_bonus_workflows,
public.kpi_direct_import_tokens,public.kpi_ops_import_staging,public.kpi_rh_presence_staging from anon,authenticated;

do $hardening$ declare r record; begin
  for r in select distinct grantee,table_name,privilege_type from information_schema.role_table_grants
           where table_schema='public' and table_name like 'kpi_%' and grantee in ('anon','authenticated') and privilege_type<>'SELECT'
  loop execute format('revoke %s on public.%I from %I',r.privilege_type,r.table_name,r.grantee); end loop;
end;$hardening$;
