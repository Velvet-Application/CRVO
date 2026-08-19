create or replace function public.kpi_system_status_get(p_token_hash text)
returns table(payload jsonb)
language plpgsql
stable security definer
set search_path='public'
as $function$
declare
  v_ok boolean;
  v_health jsonb;
  v_live record;
  v_bridge record;
  v_invoice record;
  v_billed record;
  v_presence record;
  v_workload record;
  v_rh record;
  v_today date:=(timezone('Europe/Paris',now()))::date;
begin
  select exists(
    select 1 from public.crvo_auth_sessions s join public.crvo_auth_users u on u.id=s.user_id
    where s.token_hash=p_token_hash and s.revoked_at is null and s.expires_at>now() and u.is_active=true
  ) into v_ok;
  if not v_ok then return query select jsonb_build_object('supabase',false,'error','Session CRVO requise.'); return; end if;

  v_health:=public.kpi_industrial_health_v4_public();
  select snapshot_at,source_name,source_modified_at,factory_modified_at,park_modified_at into v_live from public.kpi_ftp_live_dashboard order by snapshot_at desc limit 1;
  select started_at,finished_at,status,files_seen,files_imported,details into v_bridge from public.kpi_bridge_runs order by started_at desc limit 1;
  select invoice_date,imported_at into v_invoice from public.kpi_invoice_facts where source_name='SQL Reporting factures CRVO' order by invoice_date desc,imported_at desc limit 1;
  select filename,min_date,max_date,completed_at,status into v_billed from public.kpi_ops_import_batches where source_key='billed_time' and status='imported' order by completed_at desc nulls last,created_at desc limit 1;
  select max(work_date) filter(where work_date<=v_today) work_date,max(source_synced_at) source_synced_at into v_presence from public.kpi_sql_presence_facts where source_name='Direct Data RH';
  select snapshot_at,observed_at into v_workload from public.kpi_vehicle_workload where source_name='SQL OR encours CRVO' order by snapshot_at desc,observed_at desc limit 1;
  select completed_at,status,max_work_date,rows_saved into v_rh from public.kpi_sql_presence_sync_runs order by completed_at desc nulls last limit 1;

  return query select jsonb_build_object(
    'supabase',true,'supabaseConfigured',true,'supabaseStatus','connected',
    'ftpBridge',coalesce((v_health->>'dataReady')::boolean,false),
    'sftpBridge',false,
    'dataTrust',jsonb_build_object('level',v_health->>'trustLevel','ok',coalesce((v_health->>'ok')::boolean,false),'warnings',coalesce(v_health->'warnings','[]'::jsonb),'checkedAt',v_health->>'checkedAt'),
    'ftpRefresh',case when v_live.snapshot_at is null then null else jsonb_build_object(
      'lastRefreshAt',v_bridge.finished_at,'lastDepositAt',v_live.source_modified_at,
      'lastDepositFilename',case when v_live.source_name like '%Factory-j_1%' then 'Factory-j_1.csv / EtatduParc.csv' when v_live.source_name like '%Factory-j+1%' then 'Factory-j+1.csv / EtatduParc.csv' else 'Factory / EtatduParc.csv' end,
      'filesSeen',coalesce(v_bridge.files_seen,0),'filesImported',coalesce(v_bridge.files_imported,0),
      'bridgeStatus',v_bridge.status,'bridgeStartedAt',v_bridge.started_at,'bridgeFinishedAt',v_bridge.finished_at,
      'protocol',coalesce(v_bridge.details->>'protocol','ftp'),'sourceModifiedAt',v_live.source_modified_at,
      'factoryModifiedAt',v_live.factory_modified_at,'parkModifiedAt',v_live.park_modified_at,
      'syncAgeMinutes',v_health->'ftp'->'syncAgeMinutes','sourceAgeMinutes',v_health->'production'->'sourceAgeMinutes'
    ) end,
    'readiness',jsonb_build_object(
      'operational',jsonb_build_object('latestDate',v_live.snapshot_at,'updatedAt',v_bridge.finished_at,'sourceModifiedAt',v_live.source_modified_at,'ready',v_live.snapshot_at is not null),
      'finance',jsonb_build_object('latestDate',v_invoice.invoice_date,'updatedAt',v_invoice.imported_at,'ready',v_invoice.invoice_date is not null),
      'billedTime',jsonb_build_object('latestDate',v_billed.max_date,'periodStart',v_billed.min_date,'filename',v_billed.filename,'updatedAt',v_billed.completed_at,'ready',v_billed.max_date is not null),
      'rhPresence',jsonb_build_object('latestDate',v_presence.work_date,'updatedAt',coalesce(v_presence.source_synced_at,v_rh.completed_at),'ready',v_presence.work_date is not null,'lastSyncStatus',v_rh.status,'scheduledThrough',v_rh.max_work_date),
      'workload',jsonb_build_object('latestDate',v_workload.snapshot_at,'updatedAt',v_workload.observed_at,'ready',v_workload.snapshot_at is not null)
    ),
    'archiveBucket','kpi-raw-archive'
  );
end
$function$;

revoke all on function public.kpi_system_status_get(text) from public;
grant execute on function public.kpi_system_status_get(text) to anon,authenticated,service_role;
