create table if not exists public.kpi_email_imports (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  sender text,
  subject text,
  message_id text,
  source_key text not null default 'unknown' check (source_key in ('rh','finance','billed_time','unknown')),
  original_filename text not null,
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null default 0 check (byte_size >= 0),
  mime_type text,
  status text not null default 'received' check (status in ('received','archived','processing','imported','duplicate','quarantined','failed')),
  archive_object_path text,
  row_count integer check (row_count is null or row_count >= 0),
  min_data_date date,
  max_data_date date,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz
);

create index if not exists kpi_email_imports_received_idx on public.kpi_email_imports(received_at desc);
create index if not exists kpi_email_imports_source_idx on public.kpi_email_imports(source_key, received_at desc);

create table if not exists public.kpi_billed_time_facts (
  id bigint generated always as identity primary key,
  work_date date,
  invoice_date date,
  invoice_number text,
  work_order text,
  mechanic_name text,
  time_code text,
  time_description text,
  labor_hours numeric not null default 0,
  source_file_sha256 text not null check (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_number integer not null,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique(source_file_sha256, source_row_number)
);

create index if not exists kpi_billed_time_facts_work_order_idx on public.kpi_billed_time_facts(work_order);
create index if not exists kpi_billed_time_facts_invoice_idx on public.kpi_billed_time_facts(invoice_number);
create index if not exists kpi_billed_time_facts_date_idx on public.kpi_billed_time_facts(coalesce(invoice_date, work_date) desc);

alter table public.kpi_email_imports enable row level security;
alter table public.kpi_billed_time_facts enable row level security;
revoke all on public.kpi_email_imports from anon, authenticated;
revoke all on public.kpi_billed_time_facts from anon, authenticated;

create or replace function public.kpi_apply_billed_hours_email(p_file_sha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer := 0;
  current_count integer := 0;
begin
  with by_invoice as (
    select invoice_number, sum(labor_hours) as hours
    from public.kpi_billed_time_facts
    where source_file_sha256 = p_file_sha
      and nullif(trim(invoice_number),'') is not null
    group by invoice_number
  )
  update public.kpi_invoice_facts f
     set labor_hours = b.hours,
         metadata = coalesce(f.metadata,'{}'::jsonb) || jsonb_build_object('labor_hours_channel','email','labor_hours_file_sha256',p_file_sha)
    from by_invoice b
   where f.invoice_number = b.invoice_number;
  get diagnostics current_count = row_count;
  touched := touched + current_count;

  with by_work_order as (
    select work_order, sum(labor_hours) as hours
    from public.kpi_billed_time_facts
    where source_file_sha256 = p_file_sha
      and nullif(trim(invoice_number),'') is null
      and nullif(trim(work_order),'') is not null
    group by work_order
  )
  update public.kpi_invoice_facts f
     set labor_hours = b.hours,
         metadata = coalesce(f.metadata,'{}'::jsonb) || jsonb_build_object('labor_hours_channel','email','labor_hours_file_sha256',p_file_sha)
    from by_work_order b
   where f.work_order = b.work_order;
  get diagnostics current_count = row_count;
  touched := touched + current_count;

  return touched;
end;
$$;

revoke all on function public.kpi_apply_billed_hours_email(text) from public, anon, authenticated;
grant execute on function public.kpi_apply_billed_hours_email(text) to service_role;
