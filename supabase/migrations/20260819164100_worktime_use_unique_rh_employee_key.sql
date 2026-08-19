-- Use the internal RH employee_key as the technical identifier in Worktime.
-- Matricule remains display/search data only: source RH currently contains a collision
-- where DECLEIR ARNAUD and FACHE AUGUSTE both carry matricule 45390.

do $do$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace='public'::regnamespace
    and proname='kpi_worktime_dashboard'
    and pg_get_function_identity_arguments(oid)='p_session_hash text, p_entity text, p_from date, p_to date';
  if v_def is null then raise exception 'kpi_worktime_dashboard introuvable'; end if;
  v_def := replace(v_def,
    $old$'employeeKey',coalesce(nullif(d.matricule,''),d.name_key)$old$,
    $new$'employeeKey',d.employee_key$new$);
  execute v_def;

  select pg_get_functiondef(oid) into v_def
  from pg_proc
  where pronamespace='public'::regnamespace
    and proname='kpi_worktime_create_event'
    and pg_get_function_identity_arguments(oid)='p_session_hash text, p_entity text, p_employee_key text, p_kind text, p_reason text, p_start date, p_end date, p_event_time time without time zone, p_comment text';
  if v_def is null then raise exception 'kpi_worktime_create_event introuvable'; end if;
  v_def := replace(v_def,
    $old$where d.active and coalesce(nullif(d.matricule,''),d.name_key)=p_employee_key limit 1$old$,
    $new$where d.active and d.employee_key=p_employee_key limit 1$new$);
  execute v_def;
end $do$;
