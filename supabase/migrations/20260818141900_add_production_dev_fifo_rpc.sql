create or replace function public.kpi_production_dev_fifo(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth record;
  v_fifo jsonb := '[]'::jsonb;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) limit 1;
  if not coalesce(v_auth.ok,false) or coalesce(v_auth.role,'') <> 'admin' then
    raise exception 'development sandbox forbidden' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.sector_label, f.fifo_age_days desc nulls last, f.registration),'[]'::jsonb)
    into v_fifo
  from public.kpi_pilotage_fifo_public f;

  return v_fifo;
end;
$$;

grant execute on function public.kpi_production_dev_fifo(text) to anon, authenticated, service_role;
