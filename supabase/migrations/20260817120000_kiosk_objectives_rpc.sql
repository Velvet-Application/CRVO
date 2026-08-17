create or replace function public.kpi_kiosk_objectives(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_start date := date_trunc('month', coalesce(p_month, (timezone('Europe/Paris', now()))::date))::date;
  v_end date := (date_trunc('month', coalesce(p_month, (timezone('Europe/Paris', now()))::date)) + interval '1 month')::date;
  v_objectives jsonb := '[]'::jsonb;
  v_daily jsonb := '{}'::jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(o.month,'YYYY-MM-DD'),
    'sectorKey', o.sector_key,
    'sectorLabel', o.sector_label,
    'dailyTarget', o.daily_target,
    'minThreshold', o.min_threshold,
    'maxThreshold', o.max_threshold,
    'updatedAt', o.updated_at
  ) order by o.sector_label), '[]'::jsonb)
  into v_objectives
  from public.kpi_monthly_objectives o
  where o.month = v_start;

  select coalesce(jsonb_object_agg(to_char(d.target_date,'YYYY-MM-DD'), d.target_value order by d.target_date), '{}'::jsonb)
  into v_daily
  from public.kpi_daily_exit_objectives d
  where d.target_date >= v_start and d.target_date < v_end;

  return jsonb_build_object(
    'connected', true,
    'configured', jsonb_array_length(v_objectives) > 0,
    'month', to_char(v_start,'YYYY-MM-DD'),
    'objectives', v_objectives,
    'sortieDailyTargets', v_daily,
    'storage', 'supabase-kiosk-rpc'
  );
end;
$function$;

revoke all on function public.kpi_kiosk_objectives(date) from public;
grant execute on function public.kpi_kiosk_objectives(date) to anon, authenticated, service_role;
