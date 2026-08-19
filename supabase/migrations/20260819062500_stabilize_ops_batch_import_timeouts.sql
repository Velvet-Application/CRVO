-- Browser imports call SECURITY DEFINER RPCs with the publishable Supabase key.
-- The anon role is intentionally configured with a short statement_timeout, so
-- import RPCs need their own bounded timeout while keeping the rest of the app
-- protected by the stricter global limit.

create index if not exists kpi_invoice_facts_source_date_idx
  on public.kpi_invoice_facts(source_name, invoice_date);

create index if not exists kpi_billed_time_facts_source_effective_date_invoice_idx
  on public.kpi_billed_time_facts(source_name, (coalesce(invoice_date, work_date)), invoice_number);

alter function public.kpi_ops_batch_start_admin(text,text,text,text,bigint,date,date,integer,jsonb)
  set statement_timeout = '30s';
alter function public.kpi_ops_batch_start_admin(text,text,text,text,bigint,date,date,integer,jsonb)
  set lock_timeout = '8s';

alter function public.kpi_ops_batch_chunk_admin(text,uuid,jsonb)
  set statement_timeout = '30s';
alter function public.kpi_ops_batch_chunk_admin(text,uuid,jsonb)
  set lock_timeout = '8s';

alter function public.kpi_ops_batch_commit_step_admin(text,uuid,integer)
  set statement_timeout = '60s';
alter function public.kpi_ops_batch_commit_step_admin(text,uuid,integer)
  set lock_timeout = '8s';
