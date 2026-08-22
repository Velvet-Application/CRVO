do $do$
declare
  ddl text;
  old_sql text := $old$from public.kpi_ftp_vehicle_state where nullif(trim(coalesce(work_order,'')),'') is not null order by work_order,snapshot_at desc,source_modified_at desc nulls last,created_at desc$old$;
  new_sql text := $new$from public.kpi_ftp_vehicle_state where import_batch_id=(select import_batch_id from public.kpi_ftp_vehicle_state where import_batch_id is not null order by created_at desc limit 1) and nullif(trim(coalesce(work_order,'')),'') is not null order by work_order,snapshot_at desc,source_modified_at desc nulls last,created_at desc$new$;
begin
  select pg_get_functiondef('public.kpi_pr_dev_snapshot(text,text)'::regprocedure) into ddl;
  if position(old_sql in ddl)=0 then
    raise exception 'Motif snapshot PR introuvable';
  end if;
  ddl := replace(ddl,old_sql,new_sql);
  execute ddl;
end
$do$;
