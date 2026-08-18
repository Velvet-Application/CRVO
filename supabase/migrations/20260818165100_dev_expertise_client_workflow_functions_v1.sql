create or replace function public.kpi_dev_expertise_get(p_token_hash text, p_vehicle_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth record;
  v_case public.kpi_dev_expertise_cases%rowtype;
  v_revision integer;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  select * into v_case from public.kpi_dev_expertise_cases where vehicle_key=p_vehicle_key limit 1;
  if v_case.id is null then
    return jsonb_build_object('connected',true,'case',null,'draftSnapshot',null,'snapshot',null,'items','[]'::jsonb,'messages','[]'::jsonb,'events','[]'::jsonb);
  end if;
  v_revision:=v_case.current_revision;
  return jsonb_build_object(
    'connected',true,
    'case',jsonb_build_object('id',v_case.id,'vehicleKey',v_case.vehicle_key,'registration',v_case.registration,'workOrder',v_case.work_order,'vin',v_case.vin,'client',v_case.client_name,'model',v_case.model,'mileage',v_case.mileage,'status',v_case.status,'shareToken',v_case.share_token,'currentRevision',v_case.current_revision,'totalHt',v_case.total_ht,'totalTtc',v_case.total_ttc,'validatedAt',v_case.validated_at,'submittedAt',v_case.submitted_at,'firstOpenedAt',v_case.first_opened_at,'clientDecidedAt',v_case.client_decided_at,'createdAt',v_case.created_at,'updatedAt',v_case.updated_at),
    'draftSnapshot',v_case.draft_snapshot,
    'snapshot',(select r.snapshot from public.kpi_dev_expertise_revisions r where r.case_id=v_case.id and r.revision_no=v_revision limit 1),
    'items',coalesce((select jsonb_agg(jsonb_build_object('key',i.item_key,'category',i.category,'label',i.label,'defect',i.defect,'justification',i.justification,'method',i.method,'photoData',i.photo_data,'amountHt',i.amount_ht,'amountTtc',i.amount_ttc,'clientSelectable',i.client_selectable,'clientChoice',i.client_choice,'decidedAt',i.decided_at) order by i.id) from public.kpi_dev_expertise_items i where i.case_id=v_case.id and i.revision_no=v_revision),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'authorRole',m.author_role,'authorName',m.author_name,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from public.kpi_dev_expertise_messages m where m.case_id=v_case.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'actorRole',e.actor_role,'actorName',e.actor_name,'details',e.details,'createdAt',e.created_at) order by e.created_at,e.id) from public.kpi_dev_expertise_events e where e.case_id=v_case.id),'[]'::jsonb)
  );
end
$$;

create or replace function public.kpi_dev_expertise_save(p_token_hash text, p_vehicle jsonb, p_snapshot jsonb, p_items jsonb, p_action text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth record;
  v_case public.kpi_dev_expertise_cases%rowtype;
  v_vehicle_key text;
  v_actor text;
  v_revision integer;
  v_total_ht numeric:=coalesce(nullif(p_snapshot->'totals'->>'ht','')::numeric,0);
  v_total_ttc numeric:=coalesce(nullif(p_snapshot->'totals'->>'ttc','')::numeric,0);
  v_action text:=lower(coalesce(p_action,'draft'));
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  v_actor:=coalesce(v_auth.display_name,v_auth.username,'Expert CRVO');
  v_vehicle_key:=nullif(btrim(p_vehicle->>'vehicleKey'),'');
  if v_vehicle_key is null then raise exception 'Identifiant véhicule requis.' using errcode='22023'; end if;
  if v_action not in ('draft','validate','submit') then raise exception 'Action expertise invalide.' using errcode='22023'; end if;
  insert into public.kpi_dev_expertise_cases(vehicle_key,registration,work_order,vin,client_name,model,mileage,created_by,updated_by,draft_snapshot,total_ht,total_ttc)
  values(v_vehicle_key,nullif(p_vehicle->>'registration',''),nullif(p_vehicle->>'workOrder',''),nullif(p_vehicle->>'vin',''),nullif(p_vehicle->>'client',''),nullif(p_vehicle->>'model',''),nullif(p_vehicle->>'mileage','')::numeric,v_actor,v_actor,coalesce(p_snapshot,'{}'::jsonb),v_total_ht,v_total_ttc)
  on conflict(vehicle_key) do update set registration=excluded.registration,work_order=excluded.work_order,vin=excluded.vin,client_name=excluded.client_name,model=excluded.model,mileage=excluded.mileage,updated_by=v_actor,updated_at=now(),draft_snapshot=coalesce(p_snapshot,'{}'::jsonb),total_ht=v_total_ht,total_ttc=v_total_ttc
  returning * into v_case;
  if v_action='draft' then return public.kpi_dev_expertise_get(p_token_hash,v_vehicle_key); end if;
  v_revision:=v_case.current_revision+1;
  insert into public.kpi_dev_expertise_revisions(case_id,revision_no,action,snapshot,total_ht,total_ttc,created_by)
  values(v_case.id,v_revision,case when v_action='submit' then 'submitted' else 'validated' end,coalesce(p_snapshot,'{}'::jsonb),v_total_ht,v_total_ttc,v_actor);
  insert into public.kpi_dev_expertise_items(case_id,revision_no,item_key,category,label,defect,justification,method,photo_data,amount_ht,amount_ttc,client_selectable,client_choice)
  select v_case.id,v_revision,coalesce(nullif(x->>'key',''),gen_random_uuid()::text),coalesce(nullif(x->>'category',''),'Autre'),coalesce(nullif(x->>'label',''),'Intervention'),nullif(x->>'defect',''),nullif(x->>'justification',''),nullif(x->>'method',''),nullif(x->>'photoData',''),coalesce(nullif(x->>'amountHt','')::numeric,0),coalesce(nullif(x->>'amountTtc','')::numeric,0),coalesce((x->>'clientSelectable')::boolean,false),null
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x;
  if v_action='validate' then
    update public.kpi_dev_expertise_cases set status='validated',current_revision=v_revision,validated_at=now(),updated_at=now(),updated_by=v_actor,total_ht=v_total_ht,total_ttc=v_total_ttc where id=v_case.id;
    insert into public.kpi_dev_expertise_events(case_id,event_type,actor_role,actor_name,details) values(v_case.id,'expert_validated','expert',v_actor,jsonb_build_object('revision',v_revision,'totalHt',v_total_ht,'totalTtc',v_total_ttc));
  else
    update public.kpi_dev_expertise_cases set status='submitted',current_revision=v_revision,validated_at=coalesce(validated_at,now()),submitted_at=now(),first_opened_at=null,client_decided_at=null,updated_at=now(),updated_by=v_actor,total_ht=v_total_ht,total_ttc=v_total_ttc where id=v_case.id;
    insert into public.kpi_dev_expertise_events(case_id,event_type,actor_role,actor_name,details) values(v_case.id,'client_submitted','expert',v_actor,jsonb_build_object('revision',v_revision,'totalHt',v_total_ht,'totalTtc',v_total_ttc));
  end if;
  return public.kpi_dev_expertise_get(p_token_hash,v_vehicle_key);
end
$$;

create or replace function public.kpi_dev_expertise_expert_message(p_token_hash text, p_vehicle_key text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_auth record;v_case_id uuid;v_actor text;
begin
  select * into v_auth from public.crvo_auth_context_v2(p_token_hash) where ok limit 1;
  if v_auth is null then raise exception 'Session CRVO requise.' using errcode='42501'; end if;
  if v_auth.role <> 'admin' then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
  if length(btrim(coalesce(p_body,'')))<1 then raise exception 'Message vide.' using errcode='22023'; end if;
  select id into v_case_id from public.kpi_dev_expertise_cases where vehicle_key=p_vehicle_key limit 1;
  if v_case_id is null then raise exception 'Dossier expertise introuvable.' using errcode='P0002'; end if;
  v_actor:=coalesce(v_auth.display_name,v_auth.username,'Expert CRVO');
  insert into public.kpi_dev_expertise_messages(case_id,author_role,author_name,body) values(v_case_id,'expert',v_actor,left(btrim(p_body),4000));
  insert into public.kpi_dev_expertise_events(case_id,event_type,actor_role,actor_name,details) values(v_case_id,'message_expert','expert',v_actor,'{}'::jsonb);
  return public.kpi_dev_expertise_get(p_token_hash,p_vehicle_key);
end
$$;

create or replace function public.kpi_dev_expertise_client_get(p_share_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_case public.kpi_dev_expertise_cases%rowtype;
  v_revision integer;
  v_now timestamptz:=now();
begin
  select * into v_case from public.kpi_dev_expertise_cases where share_token::text=p_share_token and submitted_at is not null limit 1;
  if v_case.id is null then return jsonb_build_object('connected',false,'error','Dossier client introuvable ou non soumis.'); end if;
  v_revision:=v_case.current_revision;
  if v_case.first_opened_at is null then
    update public.kpi_dev_expertise_cases set first_opened_at=v_now,status=case when status='submitted' then 'viewed' else status end,updated_at=v_now where id=v_case.id returning * into v_case;
    insert into public.kpi_dev_expertise_events(case_id,event_type,actor_role,actor_name,details) values(v_case.id,'client_opened','client','Client',jsonb_build_object('revision',v_revision,'receptionProven',true));
  end if;
  return jsonb_build_object(
    'connected',true,
    'case',jsonb_build_object('registration',v_case.registration,'workOrder',v_case.work_order,'vin',v_case.vin,'client',v_case.client_name,'model',v_case.model,'mileage',v_case.mileage,'status',v_case.status,'revision',v_revision,'totalHt',v_case.total_ht,'totalTtc',v_case.total_ttc,'submittedAt',v_case.submitted_at,'firstOpenedAt',v_case.first_opened_at,'clientDecidedAt',v_case.client_decided_at),
    'snapshot',(select r.snapshot from public.kpi_dev_expertise_revisions r where r.case_id=v_case.id and r.revision_no=v_revision limit 1),
    'items',coalesce((select jsonb_agg(jsonb_build_object('key',i.item_key,'category',i.category,'label',i.label,'defect',i.defect,'justification',i.justification,'method',i.method,'photoData',i.photo_data,'amountHt',i.amount_ht,'amountTtc',i.amount_ttc,'clientSelectable',i.client_selectable,'clientChoice',i.client_choice) order by i.id) from public.kpi_dev_expertise_items i where i.case_id=v_case.id and i.revision_no=v_revision),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'authorRole',m.author_role,'authorName',case when m.author_role='expert' then coalesce(m.author_name,'Expert CRVO') else 'Vous' end,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from public.kpi_dev_expertise_messages m where m.case_id=v_case.id),'[]'::jsonb)
  );
end
$$;

create or replace function public.kpi_dev_expertise_client_decide(p_share_token text, p_action text, p_choices jsonb, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_case public.kpi_dev_expertise_cases%rowtype;
  v_revision integer;
  v_action text:=lower(coalesce(p_action,''));
  v_status text;
  v_rejected integer:=0;
  v_approved_ht numeric:=0;
  v_approved_ttc numeric:=0;
begin
  select * into v_case from public.kpi_dev_expertise_cases where share_token::text=p_share_token and submitted_at is not null limit 1;
  if v_case.id is null then raise exception 'Dossier client introuvable.' using errcode='P0002'; end if;
  if v_case.client_decided_at is not null then raise exception 'Une décision a déjà été enregistrée pour cette révision.' using errcode='23505'; end if;
  if v_action not in ('accept','refuse') then raise exception 'Décision client invalide.' using errcode='22023'; end if;
  v_revision:=v_case.current_revision;
  if v_action='refuse' then
    update public.kpi_dev_expertise_items set client_choice=false,decided_at=now() where case_id=v_case.id and revision_no=v_revision and client_selectable;
    update public.kpi_dev_expertise_items set client_choice=true,decided_at=now() where case_id=v_case.id and revision_no=v_revision and not client_selectable;
    v_status:='refused';
  else
    update public.kpi_dev_expertise_items i set client_choice=coalesce((select (x->>'accepted')::boolean from jsonb_array_elements(coalesce(p_choices,'[]'::jsonb)) x where x->>'key'=i.item_key limit 1),true),decided_at=now() where i.case_id=v_case.id and i.revision_no=v_revision and i.client_selectable;
    update public.kpi_dev_expertise_items set client_choice=true,decided_at=now() where case_id=v_case.id and revision_no=v_revision and not client_selectable;
    select count(*) into v_rejected from public.kpi_dev_expertise_items where case_id=v_case.id and revision_no=v_revision and client_selectable and client_choice=false;
    v_status:=case when v_rejected>0 then 'partially_accepted' else 'accepted' end;
  end if;
  if v_status<>'refused' then select coalesce(sum(amount_ht),0),coalesce(sum(amount_ttc),0) into v_approved_ht,v_approved_ttc from public.kpi_dev_expertise_items where case_id=v_case.id and revision_no=v_revision and coalesce(client_choice,not client_selectable)=true; end if;
  update public.kpi_dev_expertise_cases set status=v_status,client_decided_at=now(),updated_at=now() where id=v_case.id;
  if nullif(btrim(coalesce(p_comment,'')),'') is not null then insert into public.kpi_dev_expertise_messages(case_id,author_role,author_name,body) values(v_case.id,'client','Client',left(btrim(p_comment),4000)); end if;
  insert into public.kpi_dev_expertise_events(case_id,event_type,actor_role,actor_name,details) values(v_case.id,case when v_status='refused' then 'client_refused' when v_status='partially_accepted' then 'client_partially_accepted' else 'client_accepted' end,'client','Client',jsonb_build_object('revision',v_revision,'approvedHt',v_approved_ht,'approvedTtc',v_approved_ttc,'rejectedOptionalItems',v_rejected));
  return public.kpi_dev_expertise_client_get(p_share_token);
end
$$;

create or replace function public.kpi_dev_expertise_client_message(p_share_token text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_case_id uuid;
begin
  if length(btrim(coalesce(p_body,'')))<1 then raise exception 'Message vide.' using errcode='22023'; end if;
  select id into v_case_id from public.kpi_dev_expertise_cases where share_token::text=p_share_token and submitted_at is not null limit 1;
  if v_case_id is null then raise exception 'Dossier client introuvable.' using errcode='P0002'; end if;
  insert into public.kpi_dev_expertise_messages(case_id,author_role,author_name,body) values(v_case_id,'client','Client',left(btrim(p_body),4000));
  insert into public.kpi_dev_expertise_events(case_id,event_type,actor_role,actor_name,details) values(v_case_id,'message_client','client','Client','{}'::jsonb);
  return public.kpi_dev_expertise_client_get(p_share_token);
end
$$;

revoke all on function public.kpi_dev_expertise_get(text,text) from public;
revoke all on function public.kpi_dev_expertise_save(text,jsonb,jsonb,jsonb,text) from public;
revoke all on function public.kpi_dev_expertise_expert_message(text,text,text) from public;
revoke all on function public.kpi_dev_expertise_client_get(text) from public;
revoke all on function public.kpi_dev_expertise_client_decide(text,text,jsonb,text) from public;
revoke all on function public.kpi_dev_expertise_client_message(text,text) from public;
grant execute on function public.kpi_dev_expertise_get(text,text),public.kpi_dev_expertise_save(text,jsonb,jsonb,jsonb,text),public.kpi_dev_expertise_expert_message(text,text,text) to anon,authenticated,service_role;
grant execute on function public.kpi_dev_expertise_client_get(text),public.kpi_dev_expertise_client_decide(text,text,jsonb,text),public.kpi_dev_expertise_client_message(text,text) to anon,authenticated,service_role;
