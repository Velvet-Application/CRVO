create table if not exists public.kpi_annualization_settings (
  entity text primary key,
  mode text not null default 'preparation' check (mode in ('preparation','shadow','dual_run','official','frozen')),
  official_go_live_date date not null default date '2027-01-01',
  official_engine_enabled boolean not null default false,
  shadow_started_at timestamptz,
  dual_run_started_at timestamptz,
  official_started_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

insert into public.kpi_annualization_settings(entity,mode,official_go_live_date,official_engine_enabled,metadata)
values('CRVO','preparation',date '2027-01-01',false,jsonb_build_object(
  'purpose','Annualisation du centre 2027',
  'legacyAnnualizationUntouched',true,
  'requiresLegalValidation',true
))
on conflict (entity) do nothing;

create table if not exists public.kpi_annualization_rulesets (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  version text not null,
  title text not null,
  valid_from date not null,
  valid_to date not null,
  status text not null default 'draft' check (status in ('draft','validated','retired')),
  reference_period text not null default 'calendar_year',
  rules jsonb not null default '{}'::jsonb,
  legal_sources jsonb not null default '[]'::jsonb,
  requires_legal_validation boolean not null default true,
  validation_comment text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  validated_by uuid,
  validated_by_name text,
  validated_at timestamptz,
  retired_at timestamptz,
  check (valid_to >= valid_from),
  unique(entity,version)
);
create index if not exists kpi_annualization_rulesets_period_idx on public.kpi_annualization_rulesets(entity,valid_from,valid_to,status);

insert into public.kpi_annualization_rulesets(entity,version,title,valid_from,valid_to,status,rules,legal_sources,requires_legal_validation,validation_comment)
values(
  'CRVO','2027.0-DRAFT','Accord Annualisation CRVO — préparation 2027',date '2027-01-01',date '2027-12-31','draft',
  jsonb_build_object(
    'annualTargetHours',null,
    'weeklyReferenceHours',null,
    'overtimeContingentHours',null,
    'nightWindow',null,
    'premiumRules',jsonb_build_object(),
    'absenceRules',jsonb_build_object(),
    'entryExitProration',null,
    'scheduleChangeNoticeDays',null,
    'dailyAndWeeklyLimits',jsonb_build_object(),
    'compensatoryRestRules',jsonb_build_object()
  ),
  jsonb_build_array(
    jsonb_build_object('kind','legal_reference','title','Aménagement du temps de travail sur une période supérieure à la semaine','authority','Service-Public.fr','url','https://www.service-public.fr/particuliers/vosdroits/F75'),
    jsonb_build_object('kind','legal_reference','title','Durée du travail du salarié','authority','Service-Public.fr','url','https://www.service-public.fr/particuliers/vosdroits/F1911'),
    jsonb_build_object('kind','legal_reference','title','Travail de nuit du salarié','authority','Service-Public.fr','url','https://www.service-public.fr/particuliers/vosdroits/F2212'),
    jsonb_build_object('kind','legal_reference','title','Conservation des documents de décompte','authority','Légifrance','url','https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033515983')
  ),
  true,
  'Aucune valeur conventionnelle n’est activée. Convention collective, accord d’entreprise/site et règles RH à valider avant passage en mode officiel.'
)
on conflict(entity,version) do nothing;

create table if not exists public.kpi_annualization_employee_contracts (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text not null,
  employee_name text not null,
  valid_from date not null,
  valid_to date,
  ruleset_id uuid not null references public.kpi_annualization_rulesets(id),
  regime text not null default 'hourly',
  contractual_weekly_hours numeric(7,2),
  annual_target_hours numeric(9,2),
  workload_pct numeric(6,3) not null default 100,
  classification text,
  team_code text,
  sector_key text,
  excluded boolean not null default false,
  exclusion_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  check (valid_to is null or valid_to >= valid_from),
  check (workload_pct > 0 and workload_pct <= 100),
  unique(entity,employee_key,valid_from)
);
create index if not exists kpi_annualization_contract_employee_idx on public.kpi_annualization_employee_contracts(entity,employee_key,valid_from,valid_to);

create table if not exists public.kpi_annualization_employee_account_links (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  user_id uuid not null,
  employee_key text not null,
  employee_name text not null,
  valid_from date not null default current_date,
  valid_to date,
  verified_at timestamptz,
  verified_by uuid,
  verified_by_name text,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  unique(entity,user_id,valid_from),
  unique(entity,employee_key,valid_from)
);
create index if not exists kpi_annualization_account_link_idx on public.kpi_annualization_employee_account_links(entity,user_id,employee_key);

create table if not exists public.kpi_annualization_ledger (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text not null,
  employee_name text not null,
  work_date date not null,
  contract_id uuid references public.kpi_annualization_employee_contracts(id),
  ruleset_id uuid references public.kpi_annualization_rulesets(id),
  entry_kind text not null,
  state text not null default 'forecast' check (state in ('forecast','observed','validated','closed','adjustment','cancelled')),
  source_type text not null,
  source_id text,
  theoretical_hours numeric(8,2) not null default 0,
  effective_work_hours numeric(8,2) not null default 0,
  credited_hours numeric(8,2) not null default 0,
  annualization_delta_hours numeric(8,2) not null default 0,
  neutralized_hours numeric(8,2) not null default 0,
  employee_imputable_delta_hours numeric(8,2) not null default 0,
  reason_code text,
  explanation text not null,
  parent_entry_id uuid references public.kpi_annualization_ledger(id),
  payload jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  validated_at timestamptz,
  validated_by uuid,
  validated_by_name text,
  closed_at timestamptz,
  closure_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists kpi_annualization_ledger_employee_date_idx on public.kpi_annualization_ledger(entity,employee_key,work_date,state);
create index if not exists kpi_annualization_ledger_source_idx on public.kpi_annualization_ledger(source_type,source_id);

create table if not exists public.kpi_annualization_special_hours (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text not null,
  employee_name text not null,
  work_date date not null,
  ledger_entry_id uuid references public.kpi_annualization_ledger(id),
  special_type text not null check (special_type in ('overtime','night','sunday','public_holiday','premium','compensatory_rest_accrual','compensatory_rest_taken','other')),
  hours numeric(8,2) not null check (hours >= 0),
  premium_rate numeric(8,4),
  compensatory_rest_hours numeric(8,2) not null default 0,
  contingent_hours numeric(8,2) not null default 0,
  payroll_status text not null default 'not_exported' check (payroll_status in ('not_exported','ready','exported','settled','excluded')),
  rule_reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists kpi_annualization_special_employee_idx on public.kpi_annualization_special_hours(entity,employee_key,work_date,special_type);

create table if not exists public.kpi_annualization_team_loans (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text not null,
  employee_name text not null,
  from_team text,
  from_sector text,
  to_team text not null,
  to_sector text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  planned_hours numeric(8,2),
  actual_hours numeric(8,2),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','origin_approved','approved','refused','cancelled','completed')),
  requested_by uuid,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_comment text,
  check (ends_at > starts_at)
);
create index if not exists kpi_annualization_loans_employee_idx on public.kpi_annualization_team_loans(entity,employee_key,starts_at,status);

create table if not exists public.kpi_annualization_period_closures (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  period_type text not null check (period_type in ('month','year')),
  period_start date not null,
  period_end date not null,
  status text not null default 'preclose' check (status in ('preclose','blocked','closed','reopened')),
  ruleset_id uuid references public.kpi_annualization_rulesets(id),
  snapshot jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  closed_by uuid,
  closed_by_name text,
  closed_at timestamptz,
  reopened_by uuid,
  reopened_by_name text,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique(entity,period_type,period_start,period_end)
);

alter table public.kpi_annualization_ledger drop constraint if exists kpi_annualization_ledger_closure_fk;
alter table public.kpi_annualization_ledger add constraint kpi_annualization_ledger_closure_fk foreign key (closure_id) references public.kpi_annualization_period_closures(id);

create table if not exists public.kpi_annualization_disputes (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text not null,
  employee_name text not null,
  work_date date not null,
  ledger_entry_id uuid references public.kpi_annualization_ledger(id),
  requested_by_user_id uuid,
  requested_by_name text not null,
  reason text not null,
  requested_value jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','accepted','refused','cancelled')),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_comment text,
  adjustment_entry_id uuid references public.kpi_annualization_ledger(id),
  created_at timestamptz not null default now()
);
create index if not exists kpi_annualization_disputes_employee_idx on public.kpi_annualization_disputes(entity,employee_key,status,work_date);

create table if not exists public.kpi_annualization_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text not null,
  employee_name text not null,
  period_start date not null,
  period_end date not null,
  statement_hash text not null,
  user_id uuid,
  acknowledged_at timestamptz not null default now(),
  channel text not null default 'toolbox',
  metadata jsonb not null default '{}'::jsonb,
  unique(entity,employee_key,period_start,period_end,statement_hash)
);

create table if not exists public.kpi_annualization_compliance_alerts (
  id uuid primary key default gen_random_uuid(),
  entity text not null default 'CRVO',
  employee_key text,
  employee_name text,
  alert_date date not null,
  alert_code text not null,
  severity text not null check (severity in ('info','warning','critical','blocking')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  title text not null,
  detail text not null,
  rule_reference text,
  evidence jsonb not null default '{}'::jsonb,
  predictive boolean not null default false,
  detected_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_by_name text,
  acknowledged_at timestamptz,
  resolved_by uuid,
  resolved_by_name text,
  resolved_at timestamptz,
  resolution_comment text
);
create index if not exists kpi_annualization_alerts_open_idx on public.kpi_annualization_compliance_alerts(entity,status,severity,alert_date);

create table if not exists public.kpi_annualization_audit (
  id bigserial primary key,
  entity text not null default 'CRVO',
  actor_user_id uuid,
  actor_name text,
  action text not null,
  object_type text not null,
  object_id text,
  employee_key text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  occurred_at timestamptz not null default now()
);
create index if not exists kpi_annualization_audit_object_idx on public.kpi_annualization_audit(entity,object_type,object_id,occurred_at desc);
create index if not exists kpi_annualization_audit_employee_idx on public.kpi_annualization_audit(entity,employee_key,occurred_at desc);

create table if not exists public.kpi_annualization_go_live_checks (
  check_key text primary key,
  label text not null,
  category text not null,
  required boolean not null default true,
  status text not null default 'pending' check (status in ('pending','in_progress','passed','waived','failed')),
  evidence text,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz,
  sort_order integer not null default 0
);

insert into public.kpi_annualization_go_live_checks(check_key,label,category,sort_order) values
('legal_rules_validated','Convention/accord et règles 2027 validés par RH/Juridique','legal',10),
('population_contracts_complete','Population 2027 et contrats annualisés complets','data',20),
('employee_account_links','Accès salarié et rattachements individuels contrôlés','security',30),
('2026_replay_reconciled','Rejeu 2026 rapproché avec les données de référence','validation',40),
('shadow_mode_reconciled','Mode miroir rapproché sans écart non expliqué','validation',50),
('dual_run_december','Double gestion de décembre validée par RH','validation',60),
('monthly_close_tested','Clôture mensuelle et régularisation testées','process',70),
('annual_close_tested','Pré-clôture et clôture annuelle testées','process',80),
('employee_statement_tested','Relevé salarié, contestation et accusé de consultation testés','transparency',90),
('rls_security_audited','RLS, RPC et journalisation des accès audités','security',100),
('exports_payroll_validated','Exports paie / RH et preuves d’audit validés','integration',110),
('go_live_signed_off','Go-live 01/01/2027 formellement validé','go_live',120)
on conflict(check_key) do nothing;

alter table public.kpi_annualization_settings enable row level security;
alter table public.kpi_annualization_rulesets enable row level security;
alter table public.kpi_annualization_employee_contracts enable row level security;
alter table public.kpi_annualization_employee_account_links enable row level security;
alter table public.kpi_annualization_ledger enable row level security;
alter table public.kpi_annualization_special_hours enable row level security;
alter table public.kpi_annualization_team_loans enable row level security;
alter table public.kpi_annualization_period_closures enable row level security;
alter table public.kpi_annualization_disputes enable row level security;
alter table public.kpi_annualization_acknowledgements enable row level security;
alter table public.kpi_annualization_compliance_alerts enable row level security;
alter table public.kpi_annualization_audit enable row level security;
alter table public.kpi_annualization_go_live_checks enable row level security;

revoke all on table public.kpi_annualization_settings from anon,authenticated;
revoke all on table public.kpi_annualization_rulesets from anon,authenticated;
revoke all on table public.kpi_annualization_employee_contracts from anon,authenticated;
revoke all on table public.kpi_annualization_employee_account_links from anon,authenticated;
revoke all on table public.kpi_annualization_ledger from anon,authenticated;
revoke all on table public.kpi_annualization_special_hours from anon,authenticated;
revoke all on table public.kpi_annualization_team_loans from anon,authenticated;
revoke all on table public.kpi_annualization_period_closures from anon,authenticated;
revoke all on table public.kpi_annualization_disputes from anon,authenticated;
revoke all on table public.kpi_annualization_acknowledgements from anon,authenticated;
revoke all on table public.kpi_annualization_compliance_alerts from anon,authenticated;
revoke all on table public.kpi_annualization_audit from anon,authenticated;
revoke all on table public.kpi_annualization_go_live_checks from anon,authenticated;
grant all on table public.kpi_annualization_settings,public.kpi_annualization_rulesets,public.kpi_annualization_employee_contracts,public.kpi_annualization_employee_account_links,public.kpi_annualization_ledger,public.kpi_annualization_special_hours,public.kpi_annualization_team_loans,public.kpi_annualization_period_closures,public.kpi_annualization_disputes,public.kpi_annualization_acknowledgements,public.kpi_annualization_compliance_alerts,public.kpi_annualization_audit,public.kpi_annualization_go_live_checks to service_role;
grant usage,select on sequence public.kpi_annualization_audit_id_seq to service_role;

create or replace function public.kpi_annualization_v2_access(p_session_hash text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user public.crvo_auth_users%rowtype;
  v_worktime boolean:=false;
  v_hr boolean:=false;
  v_manager boolean:=false;
  v_own_employee_key text;
begin
  select u.* into v_user
  from public.crvo_auth_sessions s
  join public.crvo_auth_users u on u.id=s.user_id
  where s.token_hash=p_session_hash and s.revoked_at is null and s.expires_at>now() and u.is_active
  limit 1;
  if v_user.id is null then raise exception 'Session requise.' using errcode='42501'; end if;
  v_worktime:=v_user.role='admin' or '*'=any(v_user.page_permissions) or 'worktime'=any(v_user.page_permissions);
  v_hr:=v_user.role='admin' or v_user.access_profile='hr';
  v_manager:=v_user.role='admin' or v_user.access_profile in ('hr','service_manager','team_manager');
  select l.employee_key into v_own_employee_key
  from public.kpi_annualization_employee_account_links l
  where l.entity='CRVO' and l.user_id=v_user.id and current_date>=l.valid_from and (l.valid_to is null or current_date<=l.valid_to)
  order by l.valid_from desc limit 1;
  return jsonb_build_object(
    'allowed',v_worktime or v_own_employee_key is not null,
    'userId',v_user.id,
    'displayName',v_user.display_name,
    'role',v_user.role,
    'profile',v_user.access_profile,
    'canReadCentre',v_worktime and v_manager,
    'canManageTeam',v_worktime and v_manager,
    'canClose',v_hr,
    'canConfigureRules',v_hr,
    'canManageContracts',v_hr,
    'canViewOwn',v_own_employee_key is not null,
    'ownEmployeeKey',v_own_employee_key
  );
end$$;

create or replace function public.kpi_annualization_v2_readiness(p_session_hash text,p_entity text default 'CRVO')
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_access jsonb;
  v_entity text:=upper(coalesce(p_entity,'CRVO'));
  v_settings public.kpi_annualization_settings%rowtype;
  v_rulesets int;
  v_validated_rulesets int;
  v_contracts int;
  v_links int;
  v_ledger int;
  v_open_alerts int;
  v_checks_total int;
  v_checks_passed int;
  v_checks_failed int;
  v_blockers jsonb:='[]'::jsonb;
begin
  v_access:=public.kpi_annualization_v2_access(p_session_hash);
  if not coalesce((v_access->>'canReadCentre')::boolean,false) and not coalesce((v_access->>'canConfigureRules')::boolean,false) then
    raise exception 'Accès Annualisation du centre requis.' using errcode='42501';
  end if;
  select * into v_settings from public.kpi_annualization_settings where entity=v_entity;
  select count(*) into v_rulesets from public.kpi_annualization_rulesets where entity=v_entity;
  select count(*) into v_validated_rulesets from public.kpi_annualization_rulesets where entity=v_entity and status='validated' and valid_from<=date '2027-01-01' and valid_to>=date '2027-12-31';
  select count(*) into v_contracts from public.kpi_annualization_employee_contracts where entity=v_entity and (valid_to is null or valid_to>=date '2027-01-01');
  select count(*) into v_links from public.kpi_annualization_employee_account_links where entity=v_entity and (valid_to is null or valid_to>=date '2027-01-01');
  select count(*) into v_ledger from public.kpi_annualization_ledger where entity=v_entity;
  select count(*) into v_open_alerts from public.kpi_annualization_compliance_alerts where entity=v_entity and status in ('open','acknowledged');
  select count(*),count(*) filter(where status in ('passed','waived')),count(*) filter(where status='failed') into v_checks_total,v_checks_passed,v_checks_failed from public.kpi_annualization_go_live_checks where required;
  if v_settings.entity is null then v_blockers:=v_blockers||jsonb_build_array('Configuration CRVO absente.'); end if;
  if coalesce(v_validated_rulesets,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Aucun référentiel 2027 validé.'); end if;
  if coalesce(v_contracts,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Population/contrats 2027 non chargés.'); end if;
  if coalesce(v_links,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Rattachements comptes salariés non préparés.'); end if;
  if coalesce(v_checks_failed,0)>0 then v_blockers:=v_blockers||jsonb_build_array('Au moins un contrôle de go-live est en échec.'); end if;
  if coalesce(v_settings.official_engine_enabled,false) then
    if coalesce(v_checks_passed,0)<coalesce(v_checks_total,0) then v_blockers:=v_blockers||jsonb_build_array('Moteur officiel activé alors que la checklist de go-live n’est pas entièrement validée.'); end if;
    if coalesce(v_validated_rulesets,0)=0 then v_blockers:=v_blockers||jsonb_build_array('Moteur officiel activé sans référentiel juridique validé.'); end if;
  end if;
  return jsonb_build_object(
    'entity',v_entity,
    'mode',coalesce(v_settings.mode,'missing'),
    'officialGoLiveDate',v_settings.official_go_live_date,
    'officialEngineEnabled',coalesce(v_settings.official_engine_enabled,false),
    'rulesets',v_rulesets,
    'validatedRulesets2027',v_validated_rulesets,
    'employeeContracts',v_contracts,
    'employeeAccountLinks',v_links,
    'ledgerEntries',v_ledger,
    'openComplianceAlerts',v_open_alerts,
    'goLiveChecks',jsonb_build_object('total',v_checks_total,'passedOrWaived',v_checks_passed,'failed',v_checks_failed),
    'blockers',v_blockers,
    'safeToGoLive',(jsonb_array_length(v_blockers)=0 and coalesce(v_settings.official_engine_enabled,false))
  );
end$$;

revoke all on function public.kpi_annualization_v2_access(text) from public;
revoke all on function public.kpi_annualization_v2_readiness(text,text) from public;
grant execute on function public.kpi_annualization_v2_access(text) to anon,authenticated,service_role;
grant execute on function public.kpi_annualization_v2_readiness(text,text) to anon,authenticated,service_role;

select pg_notify('pgrst','reload schema');
