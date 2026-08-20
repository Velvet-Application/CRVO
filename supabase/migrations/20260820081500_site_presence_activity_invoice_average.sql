create or replace function public.kpi_site_presence_capacity_v4(p_session_hash text, p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_payload jsonb;
  v_teams jsonb:='[]'::jsonb;
  v_sectors jsonb:='[]'::jsonb;
begin
  v_payload:=public.kpi_site_presence_capacity_v3(p_session_hash,p_date);

  select coalesce(jsonb_agg(
    case
      when nullif(x.item->>'avgBilledHoursPerTouchedVehicle10d','')::numeric > 0 then
        x.item || jsonb_build_object(
          'capacityReferenceHours10d', round((x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric,3),
          'capacityReference','avg_billed_touched_vehicle_10d',
          'theoreticalVehicles', round(coalesce((x.item->>'hours')::numeric,0)/(x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric,1),
          'theoreticalVehiclesIfPendingApproved', round(coalesce((x.item->>'hoursIfPendingApproved')::numeric,0)/(x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric,1)
        )
      else x.item || jsonb_build_object('capacityReferenceHours10d',null,'capacityReference','missing_billed_reference')
    end
    order by x.ord
  ),'[]'::jsonb)
  into v_teams
  from jsonb_array_elements(coalesce(v_payload->'teams','[]'::jsonb)) with ordinality x(item,ord);

  select coalesce(jsonb_agg(
    case
      when nullif(x.item->>'avgBilledHoursPerTouchedVehicle10d','')::numeric > 0 then
        x.item || jsonb_build_object(
          'capacityReferenceHours10d', round((x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric,3),
          'capacityReference','avg_billed_touched_vehicle_10d',
          'theoreticalVehicles', round(coalesce((x.item->>'hours')::numeric,0)/(x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric,1),
          'theoreticalVehiclesIfPendingApproved', round(coalesce((x.item->>'hoursIfPendingApproved')::numeric,0)/(x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric,1),
          'utilizationPct', case
            when coalesce((x.item->>'hours')::numeric,0)>0 and nullif(x.item->>'actualVehicles','')::numeric is not null then
              round(100*nullif(x.item->>'actualVehicles','')::numeric /
                (coalesce((x.item->>'hours')::numeric,0)/(x.item->>'avgBilledHoursPerTouchedVehicle10d')::numeric),1)
            else null
          end
        )
      else x.item || jsonb_build_object('capacityReferenceHours10d',null,'capacityReference','missing_billed_reference','utilizationPct',null)
    end
    order by x.ord
  ),'[]'::jsonb)
  into v_sectors
  from jsonb_array_elements(coalesce(v_payload->'sectors','[]'::jsonb)) with ordinality x(item,ord);

  v_payload:=jsonb_set(v_payload,'{teams}',v_teams,true);
  v_payload:=jsonb_set(v_payload,'{sectors}',v_sectors,true);
  v_payload:=jsonb_set(v_payload,'{reference,activityCapacityMethod}',to_jsonb('Heures disponibles / temps moyen facturé par VO traité dans l’activité sur les 10 jours glissants précédents'::text),true);
  v_payload:=jsonb_set(v_payload,'{reference,siteCapacityMethod}',to_jsonb('Heures productives disponibles du site / somme des heures facturées par VO site sur les 10 jours glissants précédents'::text),true);
  return v_payload;
end
$$;

grant execute on function public.kpi_site_presence_capacity_v4(text,date) to anon,authenticated,service_role;
