alter function public.kpi_pr_dev_snapshot(text,text) rename to kpi_pr_dev_snapshot_base;

create function public.kpi_pr_dev_snapshot(p_token_hash text,p_query text default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $fn$
declare
  v_payload jsonb;
  v_bodyshop jsonb;
begin
  v_payload:=public.kpi_pr_dev_snapshot_base(p_token_hash,p_query);
  v_bodyshop:=public.kpi_pr_dev_bodyshop_dashboard(p_token_hash);
  return jsonb_set(v_payload,'{bodyshopConsumables}',coalesce(v_bodyshop,'{}'::jsonb),true);
end;
$fn$;
