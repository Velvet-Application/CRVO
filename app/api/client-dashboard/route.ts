import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY = "sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";
const BMW_CLIENT = "BMW FRANCE Prestations";
const summarySelect = "client,vehicle_count,expertise_count,chiffrage_count,controle_technique_count,dsp_count,jantes_count,mecanique_count,carrosserie_count,preparation_count,qualite_count,sortie_usine_count,age_0_15,age_16_20,age_21_30,age_31_plus,source_modified_at,snapshot_at";
const vehicleSelect = "client,registration,work_order,vin,model,mileage,status,status_age_days,factory_age_days,alert,urgency,source_modified_at,snapshot_at,pending_expertise,pending_chiffrage,pending_controle_technique,pending_dsp,pending_jantes,pending_mecanique,pending_carrosserie,pending_preparation,pending_qualite,pending_sortie_usine";

type Row = Record<string, string | number | boolean | null>;
type History = { event_date:string; event_time:string|null; status:string|null; client?:string|null; work_order:string|null; registration:string|null; flow:string|null };

async function rest<T>(path:string):Promise<T>{
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:SUPABASE_KEY,Accept:"application/json"},cache:"no-store"});
  if(!response.ok) throw new Error(`data ${response.status}`);
  return response.json() as Promise<T>;
}
async function rpc<T>(name:string,body:Record<string,unknown>={}):Promise<T>{
  const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body),cache:"no-store"});
  if(!response.ok) throw new Error(`rpc ${response.status}`);
  return response.json() as Promise<T>;
}
function n(v:unknown){const x=Number(v);return Number.isFinite(x)?x:0;}
function bmwMetrics(vehicles:Row[],history:History[]){
  const ages=vehicles.map(v=>n(v.factory_age_days??v.status_age_days)).sort((a,b)=>a-b);
  const avg=ages.length?ages.reduce((a,b)=>a+b,0)/ages.length:0;
  const med=ages.length?(ages.length%2?ages[(ages.length-1)/2]:(ages[ages.length/2-1]+ages[ages.length/2])/2):0;
  const positions=new Map<string,number>();
  vehicles.forEach(v=>{const p=String(v.status??"Position non renseignée");positions.set(p,(positions.get(p)??0)+1);});
  const byReg=new Map<string,History[]>();
  history.forEach(e=>{const k=String(e.registration??"").toUpperCase();if(!k)return;const a=byReg.get(k)??[];a.push(e);byReg.set(k,a);});
  return {vehicleCount:vehicles.length,urgentCount:vehicles.filter(v=>/^oui$/i.test(String(v.urgency??""))).length,averageAgeDays:Number(avg.toFixed(1)),medianAgeDays:Number(med.toFixed(1)),oldestAgeDays:ages.at(-1)??0,historyEventCount:history.length,positions:[...positions].map(([position,count])=>({position,count})).sort((a,b)=>b.count-a.count||a.position.localeCompare(b.position,"fr")),movements:vehicles.map(v=>{const events=byReg.get(String(v.registration??"").toUpperCase())??[];const last=events[0]??null;return {registration:v.registration,workOrder:v.work_order,lastEventDate:last?.event_date??null,lastEventTime:last?.event_time??null,lastStatus:last?.status??null,eventCount:events.length};})};
}

export async function GET(request:Request){
  const url=new URL(request.url); const registration=String(url.searchParams.get("registration")??"").trim(); const client=String(url.searchParams.get("client")??"").trim(); const bmw=url.searchParams.get("bmw")==="1";
  try{
    if(registration){
      const rows=await rpc<Row[]>("kpi_find_vehicle_public",{p_registration:registration}); const vehicle=rows[0]??null;
      if(!vehicle)return NextResponse.json({error:"Immatriculation introuvable dans le parc en cours."},{status:404});
      const history=await rpc<History[]>("kpi_get_vehicle_history_public",{p_registration:String(vehicle.registration??registration),p_work_order:vehicle.work_order?String(vehicle.work_order):null});
      return NextResponse.json({connected:true,vehicle,history},{headers:{"Cache-Control":"private, max-age=45, stale-while-revalidate=60"}});
    }
    if(bmw){
      const encoded=encodeURIComponent(BMW_CLIENT);
      const [summaryRows,vehicles,history]=await Promise.all([rest<Row[]>(`kpi_client_summary_public?select=${summarySelect}&client=eq.${encoded}&limit=1`),rest<Row[]>(`kpi_client_vehicle_public?select=${vehicleSelect}&client=eq.${encoded}&order=factory_age_days.desc.nullslast,status_age_days.desc.nullslast&limit=5000`),rpc<History[]>("kpi_bmw_france_history_public")]);
      const summary=summaryRows[0]??null;if(!summary)return NextResponse.json({error:"Périmètre BMW France indisponible."},{status:404});
      return NextResponse.json({connected:true,client:BMW_CLIENT,summary,vehicles,history,metrics:bmwMetrics(vehicles,history),timeReady:false,timeMessage:"Les heures et la main-d’œuvre restantes seront ajoutées dès que la source temps/MO sera disponible."},{headers:{"Cache-Control":"private, max-age=60, stale-while-revalidate=120"}});
    }
    const summaries=await rest<Row[]>(`kpi_client_summary_public?select=${summarySelect}&order=client.asc`);
    if(!client)return NextResponse.json({connected:true,clients:summaries,totalClients:summaries.length,totalVehicles:summaries.reduce((s,r)=>s+n(r.vehicle_count),0),updatedAt:summaries.map(r=>r.source_modified_at).filter(Boolean).sort().at(-1)??null},{headers:{"Cache-Control":"public, max-age=60, stale-while-revalidate=120"}});
    const encoded=encodeURIComponent(client);const [summaryRows,vehicles]=await Promise.all([rest<Row[]>(`kpi_client_summary_public?select=${summarySelect}&client=eq.${encoded}&limit=1`),rest<Row[]>(`kpi_client_vehicle_public?select=${vehicleSelect}&client=eq.${encoded}&order=factory_age_days.desc.nullslast,status_age_days.desc.nullslast&limit=5000`)]);const summary=summaryRows[0]??null;if(!summary)return NextResponse.json({error:"Client introuvable."},{status:404});
    return NextResponse.json({connected:true,client,summary,vehicles,timeReady:false,timeMessage:"Les heures et la main-d’œuvre restantes seront ajoutées dès que la source temps/MO sera disponible."},{headers:{"Cache-Control":"private, max-age=60, stale-while-revalidate=120"}});
  }catch(error){console.error(JSON.stringify({event:"client_dashboard_v2_failed",message:error instanceof Error?error.message:"unknown"}));return NextResponse.json({error:"Dashboard client indisponible."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
