-- Applied to production Supabase on 2026-08-14.
-- Four direct business imports: RH presence, billed time, invoices/CA, and active OR workload.

alter table public.kpi_billed_time_facts add column if not exists source_name text;
alter table public.kpi_billed_time_facts add column if not exists sector_key text;
alter table public.kpi_billed_time_facts add column if not exists sector_label text;
alter table public.kpi_billed_time_facts add column if not exists workcenter_key text;
alter table public.kpi_billed_time_facts add column if not exists team_code text;
alter table public.kpi_billed_time_facts add column if not exists matricule text;
alter table public.kpi_billed_time_facts add column if not exists intervention text;
update public.kpi_billed_time_facts set source_name='Direct Temps pointé facturé' where source_name is null;
alter table public.kpi_billed_time_facts alter column source_name set default 'Direct Temps pointé facturé';
alter table public.kpi_billed_time_facts alter column source_name set not null;
create index if not exists kpi_billed_time_facts_source_date_idx on public.kpi_billed_time_facts(source_name, coalesce(invoice_date,work_date) desc);
create index if not exists kpi_billed_time_facts_sector_idx on public.kpi_billed_time_facts(sector_key, coalesce(invoice_date,work_date) desc);
create index if not exists kpi_billed_time_facts_team_idx on public.kpi_billed_time_facts(team_code, coalesce(invoice_date,work_date) desc);

create table if not exists public.kpi_rh_presence_code_map(
  time_code text primary key,
  metier_code text not null,
  metier_label text not null,
  sector_key text not null,
  sector_label text not null,
  workcenter_key text not null,
  workcenter_label text not null,
  counts_as_presence boolean not null default true,
  excluded boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.kpi_rh_presence_code_map enable row level security;
revoke all on public.kpi_rh_presence_code_map from anon,authenticated;
grant select,insert,update,delete on public.kpi_rh_presence_code_map to service_role;

insert into public.kpi_rh_presence_code_map(time_code,metier_code,metier_label,sector_key,sector_label,workcenter_key,workcenter_label,counts_as_presence,excluded) values
('1A','ACH','Acheteur','magasin','Magasin','acheteur','Acheteur',true,false),
('1A1','ADM','Administratif','administratif','Administratif','administratif','Administratif',true,false),
('1B','AUT','Autre / entretien','autre','Autre / entretien','autre','Autre / entretien',true,false),
('1C','BOX','Box carrosserie','carrosserie','Carrosserie','box','Box',true,false),
('1D','CHE','Chef d''équipe','encadrement','Encadrement','chef_equipe','Chef d''équipe',true,false),
('1E','DSP','DSP','dsp','DSP','dsp','DSP',true,false),
('1E1','DYN','Expertise dynamique','expertise','Expertise','expertise_dynamique','Expertise dynamique',true,false),
('1G','EXP','Expertise','expertise','Expertise','expertise','Expertise',true,false),
('1H','FIX','Fixline carrosserie','carrosserie','Carrosserie','fixline','Fixline',true,false),
('1I','JAN','Jantes','jantes','Jantes','jantes','Jantes',true,false),
('1J','JOC','Jockey','jockey','Jockey','jockey','Jockey',true,false),
('1J1','LAB','Labo peinture','magasin','Magasin','labo_peinture','Labo peinture',true,false),
('1K','LAV','Lavage','lavage','Lavage','lavage','Lavage',true,false),
('1L','MEC','Mécanique','mecanique','Mécanique','mecanique','Mécanique',true,false),
('1M','MGN','Magasin','magasin','Magasin','magasin','Magasin',true,false),
('1N','OQF','Opérateur qualité','qualite','Qualité','operateur_qualite','Opérateur qualité',true,false),
('1O','PHO','Photo','photo','Photo','photo','Photo',true,false),
('1P','PRE','Préparation','preparation','Préparation','preparation','Préparation',true,false),
('1P1','TRA','Transverse / diagnostic','diagnostic','Diagnostic','diagnostic','Transverse / diagnostic',true,false),
('1Q','QUA','Qualité','qualite','Qualité','qualite','Qualité',true,false),
('1R','TOL','Tôlerie','carrosserie','Carrosserie','tolerie','Tôlerie',true,false),
('1S','VOM','VOM','ignore','Ignoré','ignore','Ignoré',false,true)
on conflict(time_code) do update set
  metier_code=excluded.metier_code,
  metier_label=excluded.metier_label,
  sector_key=excluded.sector_key,
  sector_label=excluded.sector_label,
  workcenter_key=excluded.workcenter_key,
  workcenter_label=excluded.workcenter_label,
  counts_as_presence=excluded.counts_as_presence,
  excluded=excluded.excluded,
  updated_at=now();

create or replace function public.kpi_normalize_person_name(p_value text)
returns text language sql immutable set search_path=public as $$
  select lower(trim(regexp_replace(
    translate(coalesce(p_value,''),
      'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
      'AAAAAACEEEEIIIINOOOOOUUUUYYaaaaaaceeeeiiiinooooouuuuyy'),
    '[^A-Za-z0-9]+',' ','g')))
$$;

create or replace function public.kpi_rh_base_name(p_value text)
returns text language sql immutable set search_path=public as $$
  select trim(regexp_replace(coalesce(p_value,''), '-[^-]+-[A-Z]-[0-9]+$', '', 'i'))
$$;

create or replace function public.kpi_rh_service_from_name(p_value text)
returns text language sql immutable set search_path=public as $$
  select nullif((regexp_match(coalesce(p_value,''), '-([^-]+)-[A-Z]-[0-9]+$', 'i'))[1],'')
$$;

create or replace function public.kpi_rh_team_from_name(p_value text)
returns text language sql immutable set search_path=public as $$
  select case
    when upper(coalesce((regexp_match(coalesce(p_value,''), '-[^-]+-([A-Z])-[0-9]+$', 'i'))[1],'')) in ('A','B','C')
      then upper((regexp_match(coalesce(p_value,''), '-[^-]+-([A-Z])-[0-9]+$', 'i'))[1])
    else null
  end
$$;

create or replace function public.kpi_rh_matricule_from_name(p_value text)
returns text language sql immutable set search_path=public as $$
  select nullif((regexp_match(coalesce(p_value,''), '-([0-9]+)$'))[1],'')
$$;

create table if not exists public.kpi_productivity_team_assignment(
  name_key text primary key,
  mechanic_name text not null,
  team_code text not null check(team_code in ('A','B','C')),
  scope text not null default 'general',
  role_label text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.kpi_productivity_team_assignment enable row level security;
revoke all on public.kpi_productivity_team_assignment from anon,authenticated;
grant select,insert,update,delete on public.kpi_productivity_team_assignment to service_role;

insert into public.kpi_productivity_team_assignment(name_key,mechanic_name,team_code,scope,role_label) values
(public.kpi_normalize_person_name('Sebastien HANOTEL'),'Sebastien HANOTEL','A','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Anthony SPREUX'),'Anthony SPREUX','A','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Jean Francois COLLAERT'),'Jean Francois COLLAERT','A','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Giovanni CAVROIS'),'Giovanni CAVROIS','B','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Jordan CLABAUT'),'Jordan CLABAUT','B','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Jean Marc DEGARDIN'),'Jean Marc DEGARDIN','B','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Yves-marie THERON'),'Yves-marie THERON','C','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Corentin ARZU'),'Corentin ARZU','C','fixline','Superviseur Fixline'),
(public.kpi_normalize_person_name('Julien LEMAIRE'),'Julien LEMAIRE','C','fixline','Superviseur Fixline')
on conflict(name_key) do update set
  mechanic_name=excluded.mechanic_name,
  team_code=excluded.team_code,
  scope=excluded.scope,
  role_label=excluded.role_label,
  active=true,
  updated_at=now();

update public.kpi_rh_staff_dimension d set
  matricule=coalesce(public.kpi_rh_matricule_from_name(d.full_name),d.matricule),
  service=coalesce(public.kpi_rh_service_from_name(d.full_name),d.service),
  team_code=coalesce(public.kpi_rh_team_from_name(d.full_name),d.team_code),
  full_name=public.kpi_rh_base_name(d.full_name),
  name_key=public.kpi_normalize_person_name(public.kpi_rh_base_name(d.full_name)),
  source_updated_at=now();

create table if not exists public.kpi_ops_import_batches(
  id uuid primary key default gen_random_uuid(),
  source_key text not null check(source_key in ('billed_time','finance','workload')),
  filename text not null,
  file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check(byte_size>0 and byte_size<=26214400),
  min_date date,
  max_date date,
  total_rows integer not null check(total_rows>0 and total_rows<=500000),
  received_rows integer not null default 0,
  committed_rows integer not null default 0,
  status text not null default 'processing' check(status in ('processing','imported','failed')),
  headers jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);
create index if not exists kpi_ops_import_batches_sha_idx on public.kpi_ops_import_batches(source_key,file_sha256,status,created_at desc);

create table if not exists public.kpi_ops_import_staging(
  batch_id uuid not null references public.kpi_ops_import_batches(id) on delete cascade,
  row_index integer not null,
  data_date date,
  payload jsonb not null,
  primary key(batch_id,row_index)
);
create index if not exists kpi_ops_import_staging_date_idx on public.kpi_ops_import_staging(batch_id,data_date,row_index);
alter table public.kpi_ops_import_batches enable row level security;
alter table public.kpi_ops_import_staging enable row level security;
revoke all on public.kpi_ops_import_batches from anon,authenticated;
revoke all on public.kpi_ops_import_staging from anon,authenticated;
grant all on public.kpi_ops_import_batches to service_role;
grant all on public.kpi_ops_import_staging to service_role;

create or replace function public.kpi_ops_batch_start_admin(
  p_session_hash text,p_source_key text,p_filename text,p_file_sha256 text,p_byte_size bigint,
  p_min_date date,p_max_date date,p_total_rows integer,p_headers jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_user record; v_existing record; v_id uuid;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null or v_user.role<>'admin' then raise exception 'Accès administrateur CRVO requis.' using errcode='42501'; end if;
  if p_source_key not in ('billed_time','finance','workload') then raise exception 'Type d''import invalide.'; end if;
  if coalesce(btrim(p_filename),'')='' or p_file_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Métadonnées fichier invalides.'; end if;
  if p_byte_size<=0 or p_byte_size>26214400 or p_total_rows<=0 or p_total_rows>500000 then raise exception 'Taille ou nombre de lignes invalide.'; end if;
  select id,filename,total_rows,min_date,max_date into v_existing
  from public.kpi_ops_import_batches
  where source_key=p_source_key and file_sha256=p_file_sha256 and status='imported'
  order by completed_at desc nulls last limit 1;
  if found then
    return jsonb_build_object('duplicate',true,'batchId',v_existing.id,'filename',v_existing.filename,'rows',v_existing.total_rows,'dateRange',jsonb_build_object('min',v_existing.min_date,'max',v_existing.max_date));
  end if;
  update public.kpi_ops_import_batches
    set status='failed',completed_at=now(),error_message='Import remplacé par une nouvelle tentative.'
    where source_key=p_source_key and file_sha256=p_file_sha256 and status='processing' and created_at<now()-interval '2 minutes';
  insert into public.kpi_ops_import_batches(source_key,filename,file_sha256,byte_size,min_date,max_date,total_rows,headers,created_by,metadata)
  values(p_source_key,p_filename,p_file_sha256,p_byte_size,p_min_date,p_max_date,p_total_rows,coalesce(p_headers,'[]'::jsonb),v_user.display_name,jsonb_build_object('delivery_channel','browser_chunked_v2','cleanup_done',false))
  returning id into v_id;
  return jsonb_build_object('ready',true,'batchId',v_id);
end $$;

create or replace function public.kpi_ops_batch_chunk_admin(p_session_hash text,p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user record; v_status text; v_received integer;
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null or v_user.role<>'admin' then raise exception 'Accès administrateur CRVO requis.' using errcode='42501'; end if;
  select status into v_status from public.kpi_ops_import_batches where id=p_batch_id;
  if v_status is null then raise exception 'Lot introuvable.'; end if;
  if v_status<>'processing' then raise exception 'Lot non modifiable.'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>2000 then raise exception 'Bloc invalide (1 à 2000 lignes).'; end if;
  insert into public.kpi_ops_import_staging(batch_id,row_index,data_date,payload)
  select p_batch_id,x.row_index,x.data_date,x.payload
  from jsonb_to_recordset(p_rows) as x(row_index integer,data_date date,payload jsonb)
  where x.row_index>0 and x.payload is not null
  on conflict(batch_id,row_index) do update set data_date=excluded.data_date,payload=excluded.payload;
  select count(*) into v_received from public.kpi_ops_import_staging where batch_id=p_batch_id;
  update public.kpi_ops_import_batches set received_rows=v_received where id=p_batch_id;
  return jsonb_build_object('accepted',jsonb_array_length(p_rows),'receivedRows',v_received);
end $$;

create or replace function public.kpi_ops_batch_commit_step_admin(p_session_hash text,p_batch_id uuid,p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_user record;
  v_batch public.kpi_ops_import_batches%rowtype;
  v_limit integer; v_take integer; v_remaining integer;
  v_now timestamptz:=now(); v_cleanup boolean;
  c_finance constant text:='SQL Reporting factures CRVO';
  c_billed constant text:='Direct Temps pointé facturé';
  c_workload constant text:='SQL OR encours CRVO';
begin
  select * into v_user from public.crvo_auth_validate(p_session_hash) where ok limit 1;
  if v_user is null or v_user.role<>'admin' then raise exception 'Accès administrateur CRVO requis.' using errcode='42501'; end if;
  select * into v_batch from public.kpi_ops_import_batches where id=p_batch_id for update;
  if v_batch.id is null then raise exception 'Lot introuvable.'; end if;
  if v_batch.status='imported' then return jsonb_build_object('imported',true,'rows',v_batch.total_rows,'filename',v_batch.filename,'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date)); end if;
  if v_batch.status<>'processing' then raise exception 'Lot non finalisable.'; end if;
  if v_batch.received_rows<>v_batch.total_rows then raise exception 'Import incomplet : % lignes reçues sur % attendues.',v_batch.received_rows,v_batch.total_rows; end if;
  v_limit:=greatest(100,least(coalesce(p_limit,5000),10000));
  v_cleanup:=coalesce((v_batch.metadata->>'cleanup_done')::boolean,false);

  if not v_cleanup then
    if v_batch.source_key='finance' then
      delete from public.kpi_invoice_facts where source_name=c_finance and invoice_date between v_batch.min_date and v_batch.max_date;
    elsif v_batch.source_key='billed_time' then
      delete from public.kpi_billed_time_facts where source_name=c_billed and coalesce(invoice_date,work_date) between v_batch.min_date and v_batch.max_date;
    elsif v_batch.source_key='workload' then
      delete from public.kpi_vehicle_workload where source_name=c_workload and snapshot_at between v_batch.min_date and v_batch.max_date;
    end if;
    update public.kpi_ops_import_batches set metadata=metadata||jsonb_build_object('cleanup_done',true,'cleanup_at',v_now) where id=p_batch_id;
  end if;

  select count(*) into v_take from (
    select 1 from public.kpi_ops_import_staging where batch_id=p_batch_id order by row_index limit v_limit
  ) q;

  if v_take>0 then
    if v_batch.source_key='finance' then
      insert into public.kpi_invoice_facts(
        invoice_date,invoice_number,registration,work_order,client,revenue_total,labor_revenue,parts_revenue,other_revenue,
        source_name,metadata,imported_at,vin,labor_hours
      )
      select s.data_date,nullif(s.payload->>'invoice_number',''),nullif(s.payload->>'registration',''),nullif(s.payload->>'work_order',''),nullif(s.payload->>'client',''),
        nullif(s.payload->>'revenue_total','')::numeric,nullif(s.payload->>'labor_revenue','')::numeric,nullif(s.payload->>'parts_revenue','')::numeric,nullif(s.payload->>'other_revenue','')::numeric,
        c_finance,coalesce(s.payload->'metadata','{}'::jsonb)||jsonb_build_object('delivery_channel','browser_chunked_v2','source_file_sha256',v_batch.file_sha256,'source_filename',v_batch.filename),v_now,
        nullif(s.payload->>'vin',''),nullif(s.payload->>'labor_hours','')::numeric
      from (select * from public.kpi_ops_import_staging where batch_id=p_batch_id order by row_index limit v_limit) s
      on conflict(source_name,invoice_number) do update set
        invoice_date=excluded.invoice_date,registration=excluded.registration,work_order=excluded.work_order,client=excluded.client,
        revenue_total=excluded.revenue_total,labor_revenue=excluded.labor_revenue,parts_revenue=excluded.parts_revenue,other_revenue=excluded.other_revenue,
        metadata=excluded.metadata,imported_at=excluded.imported_at,vin=excluded.vin,labor_hours=coalesce(excluded.labor_hours,public.kpi_invoice_facts.labor_hours);
    elsif v_batch.source_key='billed_time' then
      insert into public.kpi_billed_time_facts(
        work_date,invoice_date,invoice_number,work_order,mechanic_name,time_code,time_description,labor_hours,source_file_sha256,source_row_number,
        metadata,imported_at,source_name,sector_key,sector_label,workcenter_key,team_code,matricule,intervention
      )
      select nullif(s.payload->>'work_date','')::date,nullif(s.payload->>'invoice_date','')::date,nullif(s.payload->>'invoice_number',''),nullif(s.payload->>'work_order',''),
        nullif(s.payload->>'mechanic_name',''),nullif(s.payload->>'time_code',''),nullif(s.payload->>'time_description',''),(s.payload->>'labor_hours')::numeric,
        v_batch.file_sha256,s.row_index,coalesce(s.payload->'metadata','{}'::jsonb)||jsonb_build_object('delivery_channel','browser_chunked_v2','source_filename',v_batch.filename),v_now,c_billed,
        nullif(s.payload->>'sector_key',''),nullif(s.payload->>'sector_label',''),nullif(s.payload->>'workcenter_key',''),
        case when upper(coalesce(s.payload->>'team_code','')) in ('A','B','C') then upper(s.payload->>'team_code') else null end,
        nullif(s.payload->>'matricule',''),nullif(s.payload->>'intervention','')
      from (select * from public.kpi_ops_import_staging where batch_id=p_batch_id order by row_index limit v_limit) s
      on conflict(source_file_sha256,source_row_number) do update set
        work_date=excluded.work_date,invoice_date=excluded.invoice_date,invoice_number=excluded.invoice_number,work_order=excluded.work_order,
        mechanic_name=excluded.mechanic_name,time_code=excluded.time_code,time_description=excluded.time_description,labor_hours=excluded.labor_hours,
        metadata=excluded.metadata,imported_at=excluded.imported_at,source_name=excluded.source_name,sector_key=excluded.sector_key,sector_label=excluded.sector_label,
        workcenter_key=excluded.workcenter_key,team_code=excluded.team_code,matricule=excluded.matricule,intervention=excluded.intervention;
    else
      insert into public.kpi_vehicle_workload(
        observed_at,snapshot_at,registration,work_order,client,sector_key,sector_label,status,status_since,age_days,remaining_minutes,booked_minutes,estimated_total_minutes,
        source_name,metadata,vin,opened_at,potential_revenue_total,potential_labor_revenue,potential_parts_revenue,potential_other_revenue,primary_activity
      )
      select v_now,s.data_date,nullif(s.payload->>'registration',''),nullif(s.payload->>'work_order',''),nullif(s.payload->>'client',''),s.payload->>'sector_key',s.payload->>'sector_label',
        nullif(s.payload->>'status',''),nullif(s.payload->>'status_since','')::timestamptz,nullif(s.payload->>'age_days','')::numeric,
        nullif(s.payload->>'remaining_minutes','')::numeric,nullif(s.payload->>'booked_minutes','')::numeric,nullif(s.payload->>'estimated_total_minutes','')::numeric,
        c_workload,coalesce(s.payload->'metadata','{}'::jsonb)||jsonb_build_object('delivery_channel','browser_chunked_v2','source_file_sha256',v_batch.file_sha256,'source_filename',v_batch.filename),
        nullif(s.payload->>'vin',''),nullif(s.payload->>'opened_at','')::date,nullif(s.payload->>'potential_revenue_total','')::numeric,
        nullif(s.payload->>'potential_labor_revenue','')::numeric,nullif(s.payload->>'potential_parts_revenue','')::numeric,nullif(s.payload->>'potential_other_revenue','')::numeric,
        nullif(s.payload->>'primary_activity','')
      from (select * from public.kpi_ops_import_staging where batch_id=p_batch_id order by row_index limit v_limit) s
      on conflict(snapshot_at,work_order,sector_key,source_name) do update set
        observed_at=excluded.observed_at,registration=excluded.registration,client=excluded.client,sector_label=excluded.sector_label,status=excluded.status,
        status_since=excluded.status_since,age_days=excluded.age_days,remaining_minutes=excluded.remaining_minutes,booked_minutes=excluded.booked_minutes,
        estimated_total_minutes=excluded.estimated_total_minutes,metadata=excluded.metadata,vin=excluded.vin,opened_at=excluded.opened_at,
        potential_revenue_total=excluded.potential_revenue_total,potential_labor_revenue=excluded.potential_labor_revenue,
        potential_parts_revenue=excluded.potential_parts_revenue,potential_other_revenue=excluded.potential_other_revenue,primary_activity=excluded.primary_activity;
    end if;

    delete from public.kpi_ops_import_staging
    where batch_id=p_batch_id and row_index in (
      select row_index from public.kpi_ops_import_staging where batch_id=p_batch_id order by row_index limit v_limit
    );
    update public.kpi_ops_import_batches set committed_rows=committed_rows+v_take where id=p_batch_id;
  end if;

  select count(*) into v_remaining from public.kpi_ops_import_staging where batch_id=p_batch_id;
  if v_remaining=0 then
    if v_batch.source_key in ('finance','billed_time') then
      with billed as (
        select invoice_number,sum(labor_hours) hours
        from public.kpi_billed_time_facts
        where source_name=c_billed and nullif(btrim(invoice_number),'') is not null
        group by invoice_number
      )
      update public.kpi_invoice_facts f set labor_hours=b.hours
      from billed b where f.source_name=c_finance and f.invoice_number=b.invoice_number;
    end if;

    if v_batch.source_key='workload' then
      delete from public.kpi_workload_sector_summary
      where source_name=c_workload and snapshot_at between v_batch.min_date and v_batch.max_date;

      insert into public.kpi_workload_sector_summary(snapshot_at,source_name,sector_key,sector_label,work_order_count,remaining_hours,potential_revenue,run_pool,max_age_days,updated_at)
      select snapshot_at,c_workload,sector_key,max(sector_label),count(distinct work_order)::integer,
        round(coalesce(sum(remaining_minutes),0)/60.0,2),round(coalesce(sum(potential_revenue_total),0),2),
        count(distinct work_order) filter(where coalesce(remaining_minutes,0)>0)::integer,max(age_days),v_now
      from public.kpi_vehicle_workload
      where source_name=c_workload and snapshot_at between v_batch.min_date and v_batch.max_date
      group by snapshot_at,sector_key;

      insert into public.kpi_workload_sector_summary(snapshot_at,source_name,sector_key,sector_label,work_order_count,remaining_hours,potential_revenue,run_pool,max_age_days,updated_at)
      select snapshot_at,c_workload,'__total__','Total encours',count(distinct work_order)::integer,
        round(coalesce(sum(remaining_minutes),0)/60.0,2),round(coalesce(sum(potential_revenue_total),0),2),
        count(distinct work_order) filter(where coalesce(remaining_minutes,0)>0)::integer,max(age_days),v_now
      from public.kpi_vehicle_workload
      where source_name=c_workload and snapshot_at between v_batch.min_date and v_batch.max_date
      group by snapshot_at;
    end if;

    update public.kpi_ops_import_batches
    set status='imported',committed_rows=total_rows,completed_at=v_now,error_message=null,metadata=metadata||jsonb_build_object('finalized_at',v_now)
    where id=p_batch_id;
    return jsonb_build_object('imported',true,'rows',v_batch.total_rows,'committedRows',v_batch.total_rows,'remainingRows',0,'filename',v_batch.filename,'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date));
  end if;

  return jsonb_build_object('imported',false,'phase','commit','rows',v_batch.total_rows,'processedRows',v_take,'committedRows',v_batch.committed_rows+v_take,'remainingRows',v_remaining,'filename',v_batch.filename,'dateRange',jsonb_build_object('min',v_batch.min_date,'max',v_batch.max_date));
exception when others then
  update public.kpi_ops_import_batches set error_message=sqlerrm where id=p_batch_id and status='processing';
  raise;
end $$;

grant execute on function public.kpi_ops_batch_start_admin(text,text,text,text,bigint,date,date,integer,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_ops_batch_chunk_admin(text,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.kpi_ops_batch_commit_step_admin(text,uuid,integer) to anon,authenticated,service_role;
