create or replace function public.kpi_bonus_preserve_existing_mapping_on_payroll_gap()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.active
     and new.active=false
     and coalesce(new.metadata->>'employmentStatus','')='active'
     and coalesce(new.metadata->>'needsPayplanConfig','false')='true'
     and old.population<>'pending'
     and old.job_key<>'pending' then
    new.active:=true;
    new.population:=old.population;
    new.job_key:=old.job_key;
    new.sector_key:=old.sector_key;
    new.sector_label:=old.sector_label;
    new.metadata:=new.metadata||jsonb_build_object(
      'needsPayplanConfig',false,
      'payrollMappingPreserved',true,
      'payrollMappingWarning','Métier non reconnu dans le fichier paie : configuration Payplan existante conservée.'
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_kpi_bonus_preserve_existing_mapping_on_payroll_gap on public.kpi_bonus_employee_config;
create trigger trg_kpi_bonus_preserve_existing_mapping_on_payroll_gap
before update on public.kpi_bonus_employee_config
for each row execute function public.kpi_bonus_preserve_existing_mapping_on_payroll_gap();
