create extension if not exists pgcrypto;

update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  'text/csv',
  'application/csv',
  'text/plain'
]
where id = 'kpi-raw-archive';

create or replace function public.kpi_release_failed_email_import_hash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed' then
    new.sha256 := encode(digest(old.sha256 || ':' || new.id::text || ':failed', 'sha256'), 'hex');
  end if;
  return new;
end;
$$;

drop trigger if exists kpi_release_failed_email_import_hash_trg on public.kpi_email_imports;
create trigger kpi_release_failed_email_import_hash_trg
before update of status on public.kpi_email_imports
for each row
when (new.status = 'failed' and old.status is distinct from 'failed')
execute function public.kpi_release_failed_email_import_hash();

update public.kpi_email_imports
set sha256 = encode(digest(sha256 || ':' || id::text || ':failed-migration', 'sha256'), 'hex')
where status = 'failed';
