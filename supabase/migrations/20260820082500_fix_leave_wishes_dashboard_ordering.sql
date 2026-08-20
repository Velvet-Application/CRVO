do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='kpi_worktime_leave_dashboard'
  order by p.oid desc
  limit 1;

  if v_def is null then
    raise exception 'kpi_worktime_leave_dashboard introuvable';
  end if;

  if position('order by q.start_date,q.employee_name' in v_def)=0 then
    raise exception 'Signature du défaut kpi_worktime_leave_dashboard introuvable';
  end if;

  v_def:=replace(v_def,'order by q.start_date,q.employee_name','order by q."startDate",q."employeeName"');
  execute v_def;
end
$$;
