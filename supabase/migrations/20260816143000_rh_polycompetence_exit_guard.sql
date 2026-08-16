create or replace function public.kpi_staff_competency_exit_guard()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if old.active and not new.active then
    update public.kpi_staff_competencies
    set status='inactive',valid_until=coalesce(new.exit_date,current_date),updated_at=now(),metadata=metadata||jsonb_build_object('autoDisabledOnExit',true,'exitDate',coalesce(new.exit_date,current_date))
    where employee_key=new.employee_key and status<>'inactive';
    insert into public.kpi_staff_competency_events(employee_key,skill_key,event_type,actor_id,payload)
    select new.employee_key,c.skill_key,'disabled_on_exit',null,jsonb_build_object('exitDate',coalesce(new.exit_date,current_date),'historyPreserved',true)
    from public.kpi_staff_competencies c where c.employee_key=new.employee_key and c.valid_until=coalesce(new.exit_date,current_date);
  end if;
  return new;
end $$;

drop trigger if exists trg_kpi_staff_competency_exit_guard on public.kpi_staff_registry;
create trigger trg_kpi_staff_competency_exit_guard
after update of active on public.kpi_staff_registry
for each row when (old.active is distinct from new.active)
execute function public.kpi_staff_competency_exit_guard();

create or replace function public.kpi_rh_set_competency(p_session_hash text,p_employee_key text,p_skill_key text,p_status text default 'active',p_validated_at date default null,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  a record;
  v_actor uuid;
  r public.kpi_staff_registry%rowtype;
  s public.kpi_skill_catalog%rowtype;
  v_status text:=lower(coalesce(nullif(btrim(p_status),''),'active'));
begin
  select * into a from public.kpi_data_rh_access(p_session_hash) limit 1;
  if a is null then raise exception 'Droit Data RH requis.' using errcode='42501'; end if;
  select id into v_actor from public.crvo_auth_users where username=a.username limit 1;
  select * into r from public.kpi_staff_registry where employee_key=p_employee_key;
  if r.employee_key is null then raise exception 'Collaborateur introuvable.'; end if;
  select * into s from public.kpi_skill_catalog where skill_key=p_skill_key and active;
  if s.skill_key is null then raise exception 'Compétence inconnue.'; end if;
  if v_status not in ('active','training','inactive') then raise exception 'Statut de compétence invalide.'; end if;
  if not r.active and v_status in ('active','training') then raise exception 'Impossible d’activer une polycompétence pour un collaborateur sorti.'; end if;
  if v_status='active' and r.primary_job_key=s.skill_key then raise exception 'Le métier principal ne doit pas être enregistré comme polycompétence.'; end if;

  insert into public.kpi_staff_competencies(employee_key,skill_key,status,validated_at,valid_from,source,note,created_by,updated_by,metadata)
  values(r.employee_key,s.skill_key,v_status,case when v_status='active' then coalesce(p_validated_at,current_date) else p_validated_at end,case when v_status='active' then current_date else null end,'manual_rh',nullif(btrim(p_note),''),v_actor,v_actor,jsonb_build_object('updatedBy',a.display_name))
  on conflict(employee_key,skill_key) do update set status=excluded.status,validated_at=coalesce(excluded.validated_at,kpi_staff_competencies.validated_at),valid_from=case when excluded.status='active' then coalesce(kpi_staff_competencies.valid_from,current_date) else kpi_staff_competencies.valid_from end,valid_until=case when excluded.status='inactive' then current_date else null end,note=excluded.note,updated_by=excluded.updated_by,updated_at=now(),metadata=kpi_staff_competencies.metadata||excluded.metadata;

  insert into public.kpi_staff_competency_events(employee_key,skill_key,event_type,actor_id,payload)
  values(r.employee_key,s.skill_key,case when v_status='inactive' then 'disabled' when v_status='training' then 'training' else 'enabled' end,v_actor,jsonb_build_object('status',v_status,'validatedAt',p_validated_at,'note',nullif(btrim(p_note),''),'actor',a.display_name));

  return jsonb_build_object('ok',true,'employeeKey',r.employee_key,'skillKey',s.skill_key,'status',v_status);
end $$;
