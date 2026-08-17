create table if not exists public.kpi_staff_authoritative_roster(
  matricule text primary key,
  category text not null,
  last_name text not null,
  first_name text not null,
  full_name text not null,
  name_key text not null,
  roster_as_of date not null,
  source_filename text not null,
  source_sha256 text,
  imported_at timestamptz not null default now()
);
create index if not exists kpi_staff_authoritative_roster_name_idx on public.kpi_staff_authoritative_roster(name_key);
alter table public.kpi_staff_authoritative_roster enable row level security;

create table if not exists public.kpi_staff_authoritative_alias(
  name_key text primary key,
  matricule text not null references public.kpi_staff_authoritative_roster(matricule) on delete cascade,
  source text not null default 'authoritative_roster',
  updated_at timestamptz not null default now()
);
create index if not exists kpi_staff_authoritative_alias_matricule_idx on public.kpi_staff_authoritative_alias(matricule);
alter table public.kpi_staff_authoritative_alias enable row level security;

comment on table public.kpi_staff_authoritative_roster is 'Référentiel opérationnel des collaborateurs actuellement présents. Les données nominatives sont chargées en base et ne sont pas versionnées dans le dépôt public.';
comment on table public.kpi_staff_authoritative_alias is 'Aliases historiques de nom reliés au matricule du référentiel actif afin de conserver le rapprochement des pointages et facturations sans réactiver les anciens collaborateurs.';