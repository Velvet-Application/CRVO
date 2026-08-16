alter function public.kpi_payroll_staff_import(text,text,text,jsonb) rename to kpi_payroll_staff_import_core;
revoke all on function public.kpi_payroll_staff_import_core(text,text,text,jsonb) from public,anon,authenticated;

create or replace function public.kpi_payroll_staff_import(
  p_session_hash text,
  p_source_filename text,
  p_source_sha256 text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_run uuid;
  v_configured integer:=0;
  v_pending integer:=0;
begin
  v_result:=public.kpi_payroll_staff_import_core(p_session_hash,p_source_filename,p_source_sha256,p_rows);
  if not coalesce((v_result->>'ok')::boolean,false) then return v_result; end if;
  v_run:=(v_result->>'runId')::uuid;

  select
    count(*) filter(where exists(
      select 1 from public.kpi_bonus_employee_config c
      where c.active and c.population<>'pending' and c.job_key<>'pending'
        and c.name_key=public.kpi_normalize_person_name(e.full_name)
        and (e.matricule is null or c.matricule=e.matricule)
    )),
    count(*) filter(where not exists(
      select 1 from public.kpi_bonus_employee_config c
      where c.active and c.population<>'pending' and c.job_key<>'pending'
        and c.name_key=public.kpi_normalize_person_name(e.full_name)
        and (e.matricule is null or c.matricule=e.matricule)
    ))
  into v_configured,v_pending
  from public.kpi_staff_events e
  where e.import_run_id=v_run and coalesce((e.payload->>'active')::boolean,false);

  update public.kpi_staff_import_runs
  set configured_bonus_rows=v_configured,pending_bonus_rows=v_pending,
      metadata=metadata||jsonb_build_object('payplanStatusRecomputed',true)
  where id=v_run;

  return v_result||jsonb_build_object('bonusConfigured',v_configured,'bonusPending',v_pending);
end $$;

revoke all on function public.kpi_payroll_staff_import(text,text,text,jsonb) from public;
grant execute on function public.kpi_payroll_staff_import(text,text,text,jsonb) to anon,authenticated;
