-- Ensure pgcrypto functions used by the SECURITY DEFINER closure routine
-- resolve deterministically without relying on caller/session search_path.
-- pg_catalog and the extensions schema are resolved before application objects.

alter function public.kpi_bonus_close_workflow(text,uuid)
  set search_path to pg_catalog, extensions, public;
