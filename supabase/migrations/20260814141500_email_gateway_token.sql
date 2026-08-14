create table if not exists public.kpi_email_gateway_config (
  id smallint primary key default 1 check (id = 1),
  token_sha256 text not null check (token_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  updated_by text,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.kpi_email_gateway_config enable row level security;
revoke all on public.kpi_email_gateway_config from anon, authenticated;
