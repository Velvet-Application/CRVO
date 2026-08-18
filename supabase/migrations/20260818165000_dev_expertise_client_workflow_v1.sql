create table if not exists public.kpi_dev_expertise_cases (
  id uuid primary key default gen_random_uuid(),
  vehicle_key text not null unique,
  registration text,
  work_order text,
  vin text,
  client_name text,
  model text,
  mileage numeric,
  status text not null default 'draft' check (status in ('draft','validated','submitted','viewed','accepted','partially_accepted','refused','closed')),
  share_token uuid not null default gen_random_uuid() unique,
  current_revision integer not null default 0,
  draft_snapshot jsonb not null default '{}'::jsonb,
  total_ht numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  validated_at timestamptz,
  submitted_at timestamptz,
  first_opened_at timestamptz,
  client_decided_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kpi_dev_expertise_revisions (
  id bigserial primary key,
  case_id uuid not null references public.kpi_dev_expertise_cases(id) on delete cascade,
  revision_no integer not null,
  action text not null check (action in ('validated','submitted')),
  snapshot jsonb not null,
  total_ht numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  unique(case_id, revision_no)
);

create table if not exists public.kpi_dev_expertise_items (
  id bigserial primary key,
  case_id uuid not null references public.kpi_dev_expertise_cases(id) on delete cascade,
  revision_no integer not null,
  item_key text not null,
  category text not null,
  label text not null,
  defect text,
  justification text,
  method text,
  photo_data text,
  amount_ht numeric(14,2) not null default 0,
  amount_ttc numeric(14,2) not null default 0,
  client_selectable boolean not null default false,
  client_choice boolean,
  decided_at timestamptz,
  unique(case_id, revision_no, item_key)
);

create table if not exists public.kpi_dev_expertise_messages (
  id bigserial primary key,
  case_id uuid not null references public.kpi_dev_expertise_cases(id) on delete cascade,
  author_role text not null check (author_role in ('expert','client')),
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.kpi_dev_expertise_events (
  id bigserial primary key,
  case_id uuid not null references public.kpi_dev_expertise_cases(id) on delete cascade,
  event_type text not null,
  actor_role text not null,
  actor_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kpi_dev_expertise_events_case_created_idx on public.kpi_dev_expertise_events(case_id, created_at);
create index if not exists kpi_dev_expertise_messages_case_created_idx on public.kpi_dev_expertise_messages(case_id, created_at);
create index if not exists kpi_dev_expertise_items_case_revision_idx on public.kpi_dev_expertise_items(case_id, revision_no);

alter table public.kpi_dev_expertise_cases enable row level security;
alter table public.kpi_dev_expertise_revisions enable row level security;
alter table public.kpi_dev_expertise_items enable row level security;
alter table public.kpi_dev_expertise_messages enable row level security;
alter table public.kpi_dev_expertise_events enable row level security;
revoke all on public.kpi_dev_expertise_cases, public.kpi_dev_expertise_revisions, public.kpi_dev_expertise_items, public.kpi_dev_expertise_messages, public.kpi_dev_expertise_events from anon, authenticated;
grant select, insert, update, delete on public.kpi_dev_expertise_cases, public.kpi_dev_expertise_revisions, public.kpi_dev_expertise_items, public.kpi_dev_expertise_messages, public.kpi_dev_expertise_events to service_role;
