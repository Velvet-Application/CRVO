create table if not exists public.kpi_health_cache (
  cache_key text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

revoke all on public.kpi_health_cache from public, anon, authenticated;
grant select,insert,update,delete on public.kpi_health_cache to service_role;

create or replace function public.kpi_industrial_health_v4_compute()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_base jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_level text := 'green';
  v_sync_age numeric := null;
  v_source_age numeric := null;
  v_paris_now timestamp := timezone('Europe/Paris',now());
  v_business_date date;
  v_snapshot_date date := null;
  v_target numeric := null;
begin
  v_business_date := v_paris_now::date - case when extract(hour from v_paris_now) < 5 then 1 else 0 end;
  v_base := public.kpi_industrial_health_v2_public();
  v_sync_age := nullif(v_base->'ftp'->>'syncAgeMinutes','')::numeric;
  v_source_age := nullif(v_base->'production'->>'sourceAgeMinutes','')::numeric;
  v_snapshot_date := nullif(v_base->'production'->>'snapshotDate','')::date;
  select target_value into v_target from public.kpi_daily_exit_objectives where target_date=v_business_date limit 1;
  select coalesce(jsonb_agg(w),'[]'::jsonb) into v_warnings from jsonb_array_elements(coalesce(v_base->'warnings','[]'::jsonb)) w
  where coalesce(w->>'code','') not in ('ftp_sync_stale','ftp_sync_watch','ftp_sync_alert','ftp_sync_non_certified','ftp_source_stale','ftp_source_watch','live_missing','live_wrong_date','daily_target_missing');
  if v_snapshot_date is null then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','live_missing','severity','critical','message','Aucune photo de production FTP disponible.'));
  elsif v_snapshot_date <> v_business_date then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','live_wrong_date','severity','critical','message','La photo FTP active ne correspond pas à la journée usine en cours (05h00–04h59).','businessDate',v_business_date,'snapshotDate',v_snapshot_date));
  end if;
  if v_target is null or v_target <= 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','daily_target_missing','severity','critical','message','Objectif Sortie usine de la journée industrielle active absent.','businessDate',v_business_date));
  end if;
  if v_sync_age is null or v_sync_age > 80 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','ftp_sync_stale','severity','critical','message','Aucune synchronisation FTP réussie depuis plus de 80 minutes.','ageMinutes',round(coalesce(v_sync_age,99999),1)));
  elsif v_sync_age > 50 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','ftp_sync_watch','severity','warning','message','La synchronisation FTP dépasse le rythme de secours attendu.','ageMinutes',round(v_sync_age,1)));
  end if;
  if v_source_age is null or v_source_age > 145 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','ftp_source_stale','severity','critical','message','Les fichiers métier horaires n’ont pas été renouvelés depuis plus de 145 minutes.','ageMinutes',round(coalesce(v_source_age,99999),1)));
  elsif v_source_age > 85 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code','ftp_source_watch','severity','warning','message','Le dépôt métier horaire attendu semble avoir manqué un cycle.','ageMinutes',round(v_source_age,1)));
  end if;
  if exists(select 1 from jsonb_array_elements(v_warnings) w where w->>'severity'='critical') then v_level := 'red';
  elsif exists(select 1 from jsonb_array_elements(v_warnings) w where w->>'severity'='warning') then v_level := 'amber'; else v_level := 'green'; end if;
  v_base := jsonb_set(v_base,'{warnings}',v_warnings,true);
  v_base := jsonb_set(v_base,'{trustLevel}',to_jsonb(v_level),true);
  v_base := jsonb_set(v_base,'{ok}',to_jsonb(v_level<>'red'),true);
  v_base := jsonb_set(v_base,'{dataReady}',to_jsonb(v_snapshot_date is not null and v_snapshot_date=v_business_date),true);
  v_base := jsonb_set(v_base,'{production}',coalesce(v_base->'production','{}'::jsonb)||jsonb_build_object('businessDate',v_business_date,'dailyExitTarget',v_target),true);
  v_base := jsonb_set(v_base,'{feedContract}',jsonb_build_object('cadenceMinutes',60,'continuous24x7',true,'businessDayStart','05:00','businessDayEnd','04:59','morning','05:00-12:59','afternoon','13:00-20:59','night','21:00-04:59','factoryExpected','Factory-J+1.csv','parkExpected','EtatduParc.csv','syncWatchMinutes',50,'syncCriticalMinutes',80,'sourceWatchMinutes',85,'sourceCriticalMinutes',145),true);
  return v_base;
end
$function$;

create or replace function public.kpi_industrial_finance_health_compute()
returns jsonb language plpgsql security definer set search_path='public'
as $function$
declare f jsonb;
begin
  f:=public.kpi_kiosk_direction_finance(false);
  return jsonb_build_object('ready',coalesce((f->>'connected')::boolean,false) and coalesce((f->>'budget')::numeric,0)>0 and coalesce((f->'snapshot'->'metrics'->>'revenue_cumulative')::numeric,0)>0,'asOfDate',f->>'asOfDate','revenue',coalesce((f->'snapshot'->'metrics'->>'revenue_cumulative')::numeric,0),'budget',coalesce((f->>'budget')::numeric,0),'pendingCount',coalesce((f->'pendingInvoices'->>'count')::int,0),'pendingRevenue',coalesce((f->'pendingInvoices'->>'revenue')::numeric,0),'overdueCount',coalesce((f->'pendingInvoices'->>'overdueCount')::int,0),'parkDate',f->'pendingInvoices'->>'parkDate','parkModifiedAt',f->'pendingInvoices'->>'parkModifiedAt');
end
$function$;

create or replace function public.kpi_health_cache_refresh()
returns jsonb language plpgsql security definer set search_path='public'
as $function$
declare v_industrial boolean:=false;v_finance boolean:=false;v_payload jsonb;
begin
  begin
    v_payload:=public.kpi_industrial_health_v4_compute();
    insert into public.kpi_health_cache(cache_key,payload,computed_at) values('industrial_v4',v_payload,now()) on conflict(cache_key) do update set payload=excluded.payload,computed_at=excluded.computed_at;
    v_industrial:=true;
  exception when others then raise warning 'kpi health cache industrial refresh failed: %',sqlerrm; end;
  begin
    v_payload:=public.kpi_industrial_finance_health_compute();
    insert into public.kpi_health_cache(cache_key,payload,computed_at) values('finance',v_payload,now()) on conflict(cache_key) do update set payload=excluded.payload,computed_at=excluded.computed_at;
    v_finance:=true;
  exception when others then raise warning 'kpi health cache finance refresh failed: %',sqlerrm; end;
  return jsonb_build_object('industrial',v_industrial,'finance',v_finance,'refreshedAt',now());
end
$function$;

create or replace function public.kpi_industrial_health_v4_public()
returns jsonb language plpgsql security definer set search_path='public'
as $function$
declare v_payload jsonb;
begin
  select payload into v_payload from public.kpi_health_cache where cache_key='industrial_v4' and computed_at>=now()-interval '3 minutes';
  if v_payload is null then
    v_payload:=public.kpi_industrial_health_v4_compute();
    insert into public.kpi_health_cache(cache_key,payload,computed_at) values('industrial_v4',v_payload,now()) on conflict(cache_key) do update set payload=excluded.payload,computed_at=excluded.computed_at;
  end if;
  return v_payload;
end
$function$;

create or replace function public.kpi_industrial_finance_health_public()
returns jsonb language plpgsql security definer set search_path='public'
as $function$
declare v_payload jsonb;
begin
  select payload into v_payload from public.kpi_health_cache where cache_key='finance' and computed_at>=now()-interval '3 minutes';
  if v_payload is null then
    v_payload:=public.kpi_industrial_finance_health_compute();
    insert into public.kpi_health_cache(cache_key,payload,computed_at) values('finance',v_payload,now()) on conflict(cache_key) do update set payload=excluded.payload,computed_at=excluded.computed_at;
  end if;
  return v_payload;
end
$function$;

revoke all on function public.kpi_industrial_health_v4_compute() from public,anon,authenticated;
revoke all on function public.kpi_industrial_finance_health_compute() from public,anon,authenticated;
revoke all on function public.kpi_health_cache_refresh() from public,anon,authenticated;
revoke all on function public.kpi_industrial_health_v4_public() from public;
revoke all on function public.kpi_industrial_finance_health_public() from public;
grant execute on function public.kpi_health_cache_refresh() to service_role;
grant execute on function public.kpi_industrial_health_v4_public() to anon,authenticated,service_role;
grant execute on function public.kpi_industrial_finance_health_public() to anon,authenticated,service_role;

do $$ declare j bigint; begin
  for j in select jobid from cron.job where jobname='crvo-health-cache-refresh' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('crvo-health-cache-refresh','* * * * *','select public.kpi_health_cache_refresh();');
end $$;

select public.kpi_health_cache_refresh();
