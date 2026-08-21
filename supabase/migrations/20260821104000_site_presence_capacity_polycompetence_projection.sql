create or replace function public.kpi_site_presence_capacity_v10(p_session_hash text, p_date date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payload jsonb;
  v_mode text;
  v_present numeric := 0;
  v_pending numeric := 0;
  v_ref_etp numeric;
  v_ref_exits numeric;
  v_capacity numeric;
  v_capacity_pending numeric;
  v_actual numeric;
  v_direct_lowest text;
begin
  v_payload := public.kpi_site_presence_capacity_v9(p_session_hash,p_date);
  v_mode := coalesce(v_payload->>'mode','today');
  v_present := coalesce(nullif(v_payload->'summary'->>'present','')::numeric,0);
  v_pending := coalesce(nullif(v_payload->'summary'->>'pendingLeave','')::numeric,0);
  v_ref_etp := nullif(v_payload->'reference'->>'siteReferenceAvailableEtp','')::numeric;
  v_ref_exits := nullif(v_payload->'reference'->>'siteReferenceExitsPerDay','')::numeric;
  v_direct_lowest := nullif(v_payload->'summary'->>'bottleneckSector','');

  if coalesce(v_ref_etp,0)>0 and coalesce(v_ref_exits,0)>0 then
    v_capacity := round(v_ref_exits*v_present/v_ref_etp);
    v_capacity_pending := round(v_ref_exits*greatest(v_present-v_pending,0)/v_ref_etp);

    v_payload := jsonb_set(v_payload,'{summary,siteTheoreticalVehicles}',to_jsonb(v_capacity),true);
    v_payload := jsonb_set(v_payload,'{summary,siteTheoreticalVehiclesIfPendingApproved}',to_jsonb(v_capacity_pending),true);
    v_payload := jsonb_set(v_payload,'{summary,bottleneckSector}','null'::jsonb,true);
    v_payload := jsonb_set(v_payload,'{summary,bottleneckSectorIfPendingApproved}','null'::jsonb,true);

    v_actual := nullif(v_payload->'summary'->>'actualFactoryExits','')::numeric;
    v_payload := jsonb_set(
      v_payload,
      '{summary,capacityVsActualPct}',
      case when v_mode='past' and coalesce(v_capacity,0)>0 and v_actual is not null
        then to_jsonb(round(100*v_actual/v_capacity,1))
        else 'null'::jsonb end,
      true
    );

    v_payload := jsonb_set(v_payload,'{reference,siteCapacityModel}',to_jsonb('historical_site_throughput_scaled_by_available_etp'::text),true);
    v_payload := jsonb_set(v_payload,'{reference,polycompetenceApplied}',to_jsonb(true),true);
    v_payload := jsonb_set(v_payload,'{reference,directCadenceLowestSector}',case when v_direct_lowest is null then 'null'::jsonb else to_jsonb(v_direct_lowest) end,true);
    v_payload := jsonb_set(v_payload,'{reference,siteCapacityMethod}',to_jsonb('Projection site = moyenne des Sorties Usine clôturées des jours ouvrés de référence × productifs disponibles / ETP disponibles moyens de la même fenêtre. Cette projection mesure la capacité réellement démontrée du site et intègre de fait la polycompétence et les renforts entre activités. Les cadences métier restent affichées par activité pour piloter les tensions locales.'::text),true);
  end if;

  return v_payload;
end
$function$;
