import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

const BMW_CLIENT = "BMW FRANCE Prestations";

type Row = Record<string, string | number | boolean | null>;
type History = {
  event_date:string;
  event_time:string|null;
  status:string|null;
  client?:string|null;
  work_order:string|null;
  registration:string|null;
  flow:string|null;
};
type DashboardRpc = {
  found?: boolean;
  clients?: Row[];
  client?: string;
  summary?: Row | null;
  vehicles?: Row[];
  history?: History[];
  vehicle?: Row | null;
};

function n(v:unknown){const x=Number(v);return Number.isFinite(x)?x:0;}
function bmwMetrics(vehicles:Row[],history:History[]){
  const ages=vehicles.map(v=>n(v.factory_age_days??v.status_age_days)).sort((a,b)=>a-b);
  const avg=ages.length?ages.reduce((a,b)=>a+b,0)/ages.length:0;
  const med=ages.length?(ages.length%2?ages[(ages.length-1)/2]:(ages[ages.length/2-1]+ages[ages.length/2])/2):0;
  const positions=new Map<string,number>();
  vehicles.forEach(v=>{const p=String(v.status??"Position non renseignée");positions.set(p,(positions.get(p)??0)+1);});
  const byReg=new Map<string,History[]>();
  history.forEach(e=>{const k=String(e.registration??"").toUpperCase();if(!k)return;const a=byReg.get(k)??[];a.push(e);byReg.set(k,a);});
  return {
    vehicleCount:vehicles.length,
    urgentCount:vehicles.filter(v=>/^oui$/i.test(String(v.urgency??""))).length,
    averageAgeDays:Number(avg.toFixed(1)),
    medianAgeDays:Number(med.toFixed(1)),
    oldestAgeDays:ages.at(-1)??0,
    historyEventCount:history.length,
    positions:[...positions].map(([position,count])=>({position,count})).sort((a,b)=>b.count-a.count||a.position.localeCompare(b.position,"fr")),
    movements:vehicles.map(v=>{const events=byReg.get(String(v.registration??"").toUpperCase())??[];const last=events[0]??null;return {registration:v.registration,workOrder:v.work_order,lastEventDate:last?.event_date??null,lastEventTime:last?.event_time??null,lastStatus:last?.status??null,eventCount:events.length};}),
  };
}

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return NextResponse.json({error:"Session CRVO requise."},{status:401});

  const url=new URL(request.url);
  const registration=String(url.searchParams.get("registration")??"").trim();
  const client=String(url.searchParams.get("client")??"").trim();
  const bmw=url.searchParams.get("bmw")==="1";

  try{
    const payload=await authRpc<DashboardRpc>("kpi_client_dashboard_private",{
      p_token_hash:current.tokenHash,
      p_client:client||null,
      p_bmw:bmw,
      p_registration:registration||null,
    });

    if(registration){
      if(payload.found===false||!payload.vehicle)return NextResponse.json({error:"Immatriculation introuvable dans le parc en cours."},{status:404});
      return NextResponse.json({connected:true,vehicle:payload.vehicle,history:payload.history??[]},{headers:{"Cache-Control":"no-store"}});
    }

    if(bmw){
      if(payload.found===false||!payload.summary)return NextResponse.json({error:"Périmètre BMW France indisponible."},{status:404});
      const vehicles=payload.vehicles??[];
      const history=payload.history??[];
      return NextResponse.json({
        connected:true,
        client:payload.client||BMW_CLIENT,
        summary:payload.summary,
        vehicles,
        history,
        metrics:bmwMetrics(vehicles,history),
        timeReady:false,
        timeMessage:"Les heures et la main-d’œuvre restantes seront ajoutées dès que la source temps/MO sera disponible.",
      },{headers:{"Cache-Control":"no-store"}});
    }

    if(!client){
      const summaries=payload.clients??[];
      return NextResponse.json({
        connected:true,
        clients:summaries,
        totalClients:summaries.length,
        totalVehicles:summaries.reduce((s,r)=>s+n(r.vehicle_count),0),
        updatedAt:summaries.map(r=>r.source_modified_at).filter(Boolean).sort().at(-1)??null,
      },{headers:{"Cache-Control":"no-store"}});
    }

    if(payload.found===false||!payload.summary)return NextResponse.json({error:"Client introuvable."},{status:404});
    return NextResponse.json({
      connected:true,
      client:payload.client||client,
      summary:payload.summary,
      vehicles:payload.vehicles??[],
      timeReady:false,
      timeMessage:"Les heures et la main-d’œuvre restantes seront ajoutées dès que la source temps/MO sera disponible.",
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error(JSON.stringify({event:"client_dashboard_private_failed",message:error instanceof Error?error.message:"unknown"}));
    return NextResponse.json({error:"Dashboard client indisponible."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
