-- The PDF filters known stale park corrections client-side. Return one extra
-- candidate so the Top 10 remains complete until the next EtatduParc refresh.
do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.kpi_daily_animation_enrichment_admin(text,date)'::regprocedure)
    into v_definition;

  v_updated := regexp_replace(v_definition, 'limit 10', 'limit 11', 'i');
  if v_updated = v_definition then
    raise exception 'Top vieillissants: clause limit 10 introuvable.';
  end if;

  execute v_updated;
end
$$;
