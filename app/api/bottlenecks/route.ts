import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type Point = { date: string; value: number; source: string };
type DailyRow = { snapshot_date: string; sector_key: string; sector_label: string; vehicle_count: number | string; source_modified_at?: string | null; frozen_at?: string | null };
type LiveRow = DailyRow & { frozen?: boolean };
type ObjectiveRow = { sector_key:string; sector_label:string; daily_target:number|string|null; max_threshold:number|string|null };
type Sector = {
  key: string;
  label: string;
  color: string;
  points: Point[];
  actual: number;
  max: number | null;
  cadence: number | null;
  workDays: number | null;
  evolution: number;
  aboveMax: number | null;
  configured: boolean;
};

const configs = [
  { key:"expertise", label:"Expertise", color:"#eb5b56" },
  { key:"chiffrage", label:"Chiffrage", color:"#ee7a70" },
  { key:"controle_technique", label:"Contrôle technique", color:"#b12d36" },
  { key:"dsp", label:"DSP", color:"#009edb" },
  { key:"jantes", label:"Jantes", color:"#47b9b4" },
  { key:"mecanique", label:"Mécanique", color:"#278b65" },
  { key:"carrosserie", label:"Carrosserie", color:"#004f9f" },
  { key:"parc_travaux", label:"Parc travaux", color:"#344b62" },
  { key:"preparation", label:"Préparation", color:"#8d5ec7" },
] as const;

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}
function parisIsoDate(){return new Intl.DateTimeFormat("sv-SE", { timeZone:"Europe/Paris", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());}
function minusDays(iso:string, days:number){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
function monthStart(iso:string){return `${iso.slice(0,7)}-01`;}
function n(value:unknown){const x=Number(value);return Number.isFinite(x)?x:null;}
async function rest<T>(url:string,key:string,path:string):Promise<T>{const response=await fetch(`${url}/rest/v1/${path}`,{headers:supabaseRestHeaders(key,{Accept:"application/json"}),cache:"no-store"});if(!response.ok)throw new Error(`Supabase ${response.status}`);return response.json() as Promise<T>;}

export async function GET(){
  const session=await currentSession();
  if(!session)return NextResponse.json({connected:false,error:"Session CRVO requise."},{status:401,headers:{"Cache-Control":"no-store"}});
  const db=env();
  if(!db)return NextResponse.json({connected:false,error:"Base CRVO non configurée."},{status:503,headers:{"Cache-Control":"no-store"}});
  const today=parisIsoDate();
  const cutoff=minusDays(today,29);
  const month=monthStart(today);
  try{
    const [frozenRows,liveRows,objectiveRows]=await Promise.all([
      rest<DailyRow[]>(db.supabaseUrl,db.secretKey,`kpi_bottleneck_daily_public?select=snapshot_date,sector_key,sector_label,vehicle_count,source_modified_at,frozen_at&snapshot_date=gte.${cutoff}&order=snapshot_date.asc`),
      rest<LiveRow[]>(db.supabaseUrl,db.secretKey,"kpi_bottleneck_live_public?select=snapshot_date,sector_key,sector_label,vehicle_count,source_modified_at,frozen"),
      rest<ObjectiveRow[]>(db.supabaseUrl,db.secretKey,`kpi_monthly_objectives?select=sector_key,sector_label,daily_target,max_threshold&month=eq.${month}`),
    ]);
    if(!liveRows.length&&!frozenRows.length)return NextResponse.json({connected:false,error:"Aucune photo réelle EtatduParc disponible."},{status:503,headers:{"Cache-Control":"no-store"}});
    const liveByKey=new Map(liveRows.map(row=>[row.sector_key,row]));
    const objectives=new Map(objectiveRows.map(row=>[row.sector_key,row]));
    const sectors:Sector[]=configs.map(config=>{
      const byDate=new Map<string,Point>();
      for(const row of frozenRows.filter(row=>row.sector_key===config.key)) byDate.set(row.snapshot_date,{date:row.snapshot_date,value:Number(row.vehicle_count)||0,source:"EtatduParc · photo figée"});
      const live=liveByKey.get(config.key);
      if(live) byDate.set(live.snapshot_date,{date:live.snapshot_date,value:Number(live.vehicle_count)||0,source:"EtatduParc · live"});
      const points=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
      const latest=points.at(-1);const previous=points.length>1?points.at(-2):null;
      const actual=live?Number(live.vehicle_count)||0:latest?.value??0;
      const objective=objectives.get(config.key);
      const max=n(objective?.max_threshold);const cadence=n(objective?.daily_target);
      const evolution=previous&&previous.value!==0?Math.round((actual-previous.value)/previous.value*100):0;
      return {...config,points,actual,max,cadence,workDays:cadence&&cadence>0?actual/cadence:null,evolution,aboveMax:max!=null?Math.max(actual-max,0):null,configured:max!=null&&cadence!=null};
    });
    const liveModified=liveRows.map(r=>r.source_modified_at).filter(Boolean).sort().at(-1)??null;
    return NextResponse.json({
      connected:true,latestDate:liveRows[0]?.snapshot_date??frozenRows.at(-1)?.snapshot_date??today,operationalLatestDate:liveRows[0]?.snapshot_date??today,stale:liveRows.length===0,
      source:"EtatduParc FTP",sourceMode:"ftp",sourceModifiedAt:liveModified,windowStart:cutoff,windowEnd:today,
      freezeRule:"Chaque journée est figée depuis les photos EtatduParc réellement reçues. Le jour J reste dynamique.",
      critical:sectors.filter(sector=>sector.max!=null&&sector.actual>sector.max).length,sectors,
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error(JSON.stringify({event:"bottlenecks_real_source_failed",message:error instanceof Error?error.message:"unknown"}));
    return NextResponse.json({connected:false,error:"Encours réels indisponibles."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
