revoke all on table public.kpi_worktime_daily_validations from anon, authenticated, public;
revoke all on table public.kpi_notifications from anon, authenticated, public;
revoke all on table public.kpi_notification_reads from anon, authenticated, public;

grant all on table public.kpi_worktime_daily_validations to service_role;
grant all on table public.kpi_notifications to service_role;
grant all on table public.kpi_notification_reads to service_role;

alter table public.kpi_worktime_daily_validations enable row level security;
alter table public.kpi_notifications enable row level security;
alter table public.kpi_notification_reads enable row level security;
