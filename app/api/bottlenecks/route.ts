import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PUBLIC_SUPABASE_URL = "https://tvmkhvfmdstkunwwuzuz.supabase.co";
const PUBLIC_SUPABASE_KEY = "sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

type Point = { date: string; value: number; source: string };
type DailyRow = { snapshot_date: string; sector_key: string; sector_label: string; vehicle_count: number | string; source_modified_at?: string | null; frozen_at?: string | null };
type LiveRow = DailyRow & { frozen?: boolean };
type Sector = {
  key: string;
  label: string;
  color: string;
  fallbackMax: number;
  fallbackCadence: number;
  points: Point[];
  actual: number;
  max: number;
  cadence: number;
  workDays: number;
  evolution: number;
  aboveMax: number;
};

const dates = ["2026-07-13","2026-07-15","2026-07-16","2026-07-17","2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31","2026-08-03","2026-08-04","2026-08-05","2026-08-06","2026-08-07","2026-08-10","2026-08-11","2026-08-12"];
const embedded: Record<string, number[]> = {
  expertise: [83,86,93,132,140,133,143,131,133,150,181,177,245,260,233,205,203,190,194,179,148,160],
  chiffrage: [16,19,13,16,17,17,18,18,15,13,11,12,9,9,15,24,19,23,32,37,41,45],
  controle_technique: [163,164,133,131,111,112,125,115,120,104,107,106,110,123,125,132,145,132,140,132,117,122],
  dsp: [70,73,76,89,84,95,125,133,149,167,192,207,204,188,170,159,134,141,162,144,121,103],
  jantes: [95,101,110,113,103,103,111,109,112,119,121,125,108,114,111,122,129,141,159,159,152,150],
  mecanique: [236,224,260,260,247,274,285,287,295,299,307,314,307,305,284,262,251,266,262,256,236,227],
  carrosserie: [270,269,281,281,258,256,249,255,249,268,269,272,255,259,251,264,236,259,280,263,191,185],
  parc_travaux: [364,348,372,374,365,392,397,407,416,437,458,464,440,443,418,393,366,389,394,385,332,324],
};
const preparationPoints: Point[] = [
  ["2026-07-13",3],["2026-07-16",1],["2026-07-20",3],["2026-07-21",10],["2026-07-22",8],["2026-07-23",15],["2026-07-24",8],["2026-07-27",2],["2026-07-30",3],["2026-07-31",4],["2026-08-03",2],["2026-08-04",2],["2026-08-05",2],["2026-08-06",3],["2026-08-07",11],["2026-08-10",2],["2026-08-11",10],["2026-08-12",9],
].map(([date,value]) => ({ date:String(date), value:Number(value), source:"Book CRVO · historique avant photos FTP quotidiennes" }));

const configs = [
  { key:"expertise", label:"Expertise", color:"#eb5b56", fallbackMax:160, fallbackCadence:80 },
  { key:"chiffrage", label:"Chiffrage", color:"#ee7a70", fallbackMax:25, fallbackCadence:50 },
  { key:"controle_technique", label:"Contrôle technique", color:"#b12d36", fallbackMax:70, fallbackCadence:50 },
  { key:"dsp", label:"DSP", color:"#009edb", fallbackMax:80, fallbackCadence:30 },
  { key:"jantes", label:"Jantes", color:"#47b9b4", fallbackMax:80, fallbackCadence:35 },
  { key:"mecanique", label:"Mécanique", color:"#278b65", fallbackMax:160, fallbackCadence:80 },
  { key:"carrosserie", label:"Carrosserie", color:"#004f9f", fallbackMax:200, fallbackCadence:50 },
  { key:"parc_travaux", label:"Parc travaux", color:"#344b62", fallbackMax:300, fallbackCadence:80 },
  { key:"preparation", label:"Préparation", color:"#8d5ec7", fallbackMax:150, fallbackCadence:80 },
] as const;

function embeddedPoints(key:string):Point[]{
  if(key==="preparation") return preparationPoints;
  return (embedded[key] ?? []).map((value,index)=>({date:dates[index],value,source:"Book CRVO · historique avant photos FTP quotidiennes"}));
}
function parisIsoDate(){
  return new Intl.DateTimeFormat("sv-SE", { timeZone:"Europe/Paris", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
}
function minusDays(iso:string, days:number){
  const d=new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-days); return d.toISOString().slice(0,10);
}
async function rest<T>(path:string):Promise<T>{
  const response=await fetch(`${PUBLIC_SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:PUBLIC_SUPABASE_KEY,Accept:"application/json"},cache:"no-store"});
  if(!response.ok) throw new Error(`Supabase public ${response.status}`);
  return response.json() as Promise<T>;
}

export async function GET(){
  const today=parisIsoDate();
  const cutoff=minusDays(today,29);
  try{
    const [frozenRows,liveRows]=await Promise.all([
      rest<DailyRow[]>(`kpi_bottleneck_daily_public?select=snapshot_date,sector_key,sector_label,vehicle_count,source_modified_at,frozen_at&snapshot_date=gte.${cutoff}&order=snapshot_date.asc`),
      rest<LiveRow[]>("kpi_bottleneck_live_public?select=snapshot_date,sector_key,sector_label,vehicle_count,source_modified_at,frozen"),
    ]);
    const liveByKey=new Map(liveRows.map(row=>[row.sector_key,row]));
    const sectors:Sector[]=configs.map(config=>{
      const byDate=new Map<string,Point>();
      for(const point of embeddedPoints(config.key)) if(point.date>=cutoff && point.date<today) byDate.set(point.date,point);
      for(const row of frozenRows.filter(row=>row.sector_key===config.key)) byDate.set(row.snapshot_date,{date:row.snapshot_date,value:Number(row.vehicle_count)||0,source:"EtatduParc · photo figée 20h"});
      const live=liveByKey.get(config.key);
      if(live) byDate.set(live.snapshot_date,{date:live.snapshot_date,value:Number(live.vehicle_count)||0,source:"EtatduParc · live"});
      const points=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
      const latest=points.at(-1);
      const previous=points.length>1?points.at(-2):null;
      const actual=live?Number(live.vehicle_count)||0:latest?.value??0;
      const max=config.fallbackMax;
      const cadence=config.fallbackCadence;
      const evolution=previous?.value ? Math.round((actual-previous.value)/previous.value*100) : 0;
      return {...config,points,actual,max,cadence,workDays:cadence>0?actual/cadence:0,evolution,aboveMax:Math.max(actual-max,0)};
    });
    const liveModified=liveRows.map(r=>r.source_modified_at).filter(Boolean).sort().at(-1) ?? null;
    return NextResponse.json({
      connected:true,
      latestDate:liveRows[0]?.snapshot_date ?? today,
      operationalLatestDate:liveRows[0]?.snapshot_date ?? today,
      stale:false,
      source:"EtatduParc FTP",
      sourceMode:"ftp",
      sourceModifiedAt:liveModified,
      windowStart:cutoff,
      windowEnd:today,
      freezeRule:"Chaque journée est figée à la première photo FTP disponible entre 20h00 et 20h59 Europe/Paris. Le jour J reste dynamique.",
      critical:sectors.filter(sector=>sector.actual>sector.max).length,
      sectors,
    },{headers:{"Cache-Control":"public, max-age=45, stale-while-revalidate=60"}});
  }catch(error){
    console.error(JSON.stringify({event:"bottlenecks_public_live_failed",message:error instanceof Error?error.message:"unknown"}));
    const sectors:Sector[]=configs.map(config=>{
      const points=embeddedPoints(config.key).filter(point=>point.date>=cutoff).slice(-30);
      const actual=points.at(-1)?.value??0;
      return {...config,points,actual,max:config.fallbackMax,cadence:config.fallbackCadence,workDays:config.fallbackCadence?actual/config.fallbackCadence:0,evolution:0,aboveMax:Math.max(actual-config.fallbackMax,0)};
    });
    return NextResponse.json({connected:false,latestDate:"2026-08-12",operationalLatestDate:today,stale:true,source:"Book CRVO · secours",sourceMode:"book",windowStart:cutoff,windowEnd:today,critical:sectors.filter(s=>s.actual>s.max).length,sectors},{headers:{"Cache-Control":"no-store"}});
  }
}
