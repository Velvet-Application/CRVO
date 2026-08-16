do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.kpi_payroll_staff_import_core(text,text,text,jsonb)'::regprocedure) into v_def;
  v_def:=replace(
    v_def,
    'v_user.user_id',
    '(select u.id from public.crvo_auth_users u where u.username=v_user.username limit 1)'
  );
  execute v_def;
end $$;
