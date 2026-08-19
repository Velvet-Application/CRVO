-- The RH import uses the same publishable-key/custom-session pattern as the
-- operational imports, so its heavier SECURITY DEFINER RPCs need bounded local
-- timeouts rather than inheriting the anon role's very short global timeout.

alter function public.kpi_rh_batch_start_admin(text,text,text,bigint,date,date,integer,jsonb)
  set statement_timeout = '30s';
alter function public.kpi_rh_batch_start_admin(text,text,text,bigint,date,date,integer,jsonb)
  set lock_timeout = '8s';

alter function public.kpi_rh_batch_chunk_admin(text,uuid,jsonb)
  set statement_timeout = '30s';
alter function public.kpi_rh_batch_chunk_admin(text,uuid,jsonb)
  set lock_timeout = '8s';

alter function public.kpi_rh_batch_commit_step_admin(text,uuid,integer)
  set statement_timeout = '60s';
alter function public.kpi_rh_batch_commit_step_admin(text,uuid,integer)
  set lock_timeout = '8s';

alter function public.kpi_rh_batch_finish_admin(text,uuid)
  set statement_timeout = '60s';
alter function public.kpi_rh_batch_finish_admin(text,uuid)
  set lock_timeout = '8s';
