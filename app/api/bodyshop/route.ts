import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

const ROTATION_ANCHOR_MONDAY = "2026-08-10";

type TeamCode = "A"|"B"|"C";
type DailyRow = {
  production_date:string;
  source_modified_at:string|null;
  box_heavy:number|string|null;
  fixline_1:number|string|null;
  fixline_2:number|string|null;
  fixline_3:number|string|null;
  total_bodyshop:number|string|null;
};
type TeamHourRow = { work_date:string; team_code:TeamCode; sold_hours:number|string; bought_hours:number|string; dossiers:number|string; efficiency:number|string|null };
type ClientTimeRow = { work_date:string; team_code:TeamCode; client:string; dossier:string|null; labor_hours:number|string|null };
type StaffMapRow = { id:string; mechanic_name:string; name_key:string; team_code:TeamCode; workcenter:string; matricule:string|null; service:string|null; mapping_source:"manual"|"rh_import"; active:boolean };
type NameRow = { mechanic_name:string|null };
type WorkloadRow = { snapshot_at:string; source_name:string; work_order_count:number|string; remaining_hours:number|string; potential_revenue:number|string; run_pool:number|string; max_age_days:number|string|null; updated_at:string };

function env(){
  const supabaseUrl=process.env.SUPABASE_URL;
  const secretKey=process.env.SUPABASE_SECRET_KEY;
  return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;
}
function num(value:unknown){const n=Number(value);return Number.isFinite(n)?n:0;}
async function rest<T>(supabaseUrl:string,secretKey:string,path:string,init:RequestInit={}){
  const response=await fetch(`${supabaseUrl}/rest/v1/${path}`,{
    ...init,
    headers:supabaseRestHeaders(secretKey,{Accept:"application/json",...(init.headers as Record<string,string>||{})}),
    cache:"no-store",
  });
  if(!response.ok)throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  if(response.status===204)return undefined as T;
  return response.json() as Promise<T>;
}
function isoParis(){return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function daysAgo(iso:string,days:number){const date=new Date(`${iso}T12:00:00Z`);date.setUTCDate(date.getUTCDate()-days);return date.toISOString().slice(0,10);}
function addDays(iso:string,days:number){const date=new Date(`${iso}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayOf(iso:string){
  const date=new Date(`${iso}T12:00:00Z`);
  const day=date.getUTCDay();
  date.setUTCDate(date.getUTCDate()-((day+6)%7));
  return date.toISOString().slice(0,10);
}
function shortDate(iso:string){
  return new Intl.DateTimeFormat("fr-FR",{day:"2-digit",month:"2-digit",timeZone:"UTC"}).format(new Date(`${iso}T12:00:00Z`));
}
function rotationFor(iso:string){
  const weekStart=mondayOf(iso);
  const anchorMs=new Date(`${ROTATION_ANCHOR_MONDAY}T12:00:00Z`).getTime();
  const weekMs=new Date(`${weekStart}T12:00:00Z`).getTime();
  const weeks=Math.round((weekMs-anchorMs)/(7*24*60*60*1000));
  const aMorning=((weeks%2)+2)%2===0;
  const morningTeam:TeamCode=aMorning?"A":"B";
  const afternoonTeam:TeamCode=aMorning?"B":"A";
  return {
    weekStart,
    weekEnd:addDays(weekStart,5),
    morningTeam,
    afternoonTeam,
    nightTeam:"C" as TeamCode,
    nextMorningTeam:afternoonTeam,
    nextAfternoonTeam:morningTeam,
  };
}

export async function GET(){
  const session=await currentSession();
  if(!session)return NextResponse.json({error:"Connexion CRVO requise."},{status:401});
  const config=env();
  if(!config)return NextResponse.json({error:"Base CRVO non configurée."},{status:503});
  const today=isoParis();
  const from=daysAgo(today,62);
  const rotation=rotationFor(today);
  try{
    const [dailyRaw,teamRaw,clientRaw,mappedRaw,presenceNames,billedNames,workloadRaw]=await Promise.all([
      rest<DailyRow[]>(config.supabaseUrl,config.secretKey,"kpi_bodyshop_daily?select=production_date,source_modified_at,box_heavy,fixline_1,fixline_2,fixline_3,total_bodyshop&order=production_date.asc&limit=45"),
      rest<TeamHourRow[]>(config.supabaseUrl,config.secretKey,`kpi_bodyshop_team_hours?select=work_date,team_code,sold_hours,bought_hours,dossiers,efficiency&work_date=gte.${from}&order=work_date.asc&limit=1000`),
      rest<ClientTimeRow[]>(config.supabaseUrl,config.secretKey,`kpi_bodyshop_client_time?select=work_date,team_code,client,dossier,labor_hours&work_date=gte.${from}&order=work_date.desc&limit=10000`),
      rest<StaffMapRow[]>(config.supabaseUrl,config.secretKey,"kpi_bodyshop_staff_effective?select=id,mechanic_name,name_key,team_code,workcenter,matricule,service,mapping_source,active&order=team_code.asc,mechanic_name.asc&limit=500"),
      rest<NameRow[]>(config.supabaseUrl,config.secretKey,`kpi_sql_presence_facts?select=mechanic_name&work_date=gte.${from}&mechanic_name=not.is.null&order=work_date.desc&limit=5000`),
      rest<NameRow[]>(config.supabaseUrl,config.secretKey,`kpi_billed_time_facts?select=mechanic_name&mechanic_name=not.is.null&order=imported_at.desc&limit=5000`),
      rest<WorkloadRow[]>(config.supabaseUrl,config.secretKey,"kpi_bodyshop_workload?select=snapshot_at,source_name,work_order_count,remaining_hours,potential_revenue,run_pool,max_age_days,updated_at&limit=1"),
    ]);

    const daily=dailyRaw.map(row=>({
      date:row.production_date,
      sourceModifiedAt:row.source_modified_at,
      boxHeavy:num(row.box_heavy),
      fixline1:num(row.fixline_1),
      fixline2:num(row.fixline_2),
      fixline3:num(row.fixline_3),
      total:num(row.total_bodyshop),
    }));
    const teamDaily=teamRaw.map(row=>({
      date:row.work_date,
      team:row.team_code,
      soldHours:num(row.sold_hours),
      boughtHours:num(row.bought_hours),
      dossiers:num(row.dossiers),
      efficiency:row.efficiency==null?null:num(row.efficiency),
    }));

    const clientMap=new Map<string,{client:string;hours:number;dossiers:Set<string>;teams:Set<string>} >();
    for(const row of clientRaw){
      const key=row.client||"Client non renseigné";
      const item=clientMap.get(key)??{client:key,hours:0,dossiers:new Set<string>(),teams:new Set<string>()};
      item.hours+=num(row.labor_hours);
      if(row.dossier)item.dossiers.add(row.dossier);
      item.teams.add(row.team_code);
      clientMap.set(key,item);
    }
    const clientTimes=[...clientMap.values()].map(item=>({
      client:item.client,
      hours:item.hours,
      dossiers:item.dossiers.size,
      avgHoursPerDossier:item.dossiers.size?item.hours/item.dossiers.size:0,
      teams:[...item.teams].sort(),
    })).sort((a,b)=>b.hours-a.hours).slice(0,20);

    const mappedKeys=new Set(mappedRaw.filter(item=>item.active).map(item=>item.name_key));
    const allNames=new Map<string,string>();
    for(const row of [...presenceNames,...billedNames]){
      const value=(row.mechanic_name??"").trim();
      if(!value)continue;
      const key=value.toLocaleLowerCase("fr-FR");
      if(!allNames.has(key))allNames.set(key,value);
    }
    const unmappedStaff=[...allNames.entries()].filter(([key])=>!mappedKeys.has(key)).map(([,name])=>name).sort((a,b)=>a.localeCompare(b,"fr"));
    const workloadRow=workloadRaw[0]??null;
    const workload=workloadRow?{
      snapshotAt:workloadRow.snapshot_at,
      sourceName:workloadRow.source_name,
      workOrders:num(workloadRow.work_order_count),
      remainingHours:num(workloadRow.remaining_hours),
      potentialRevenue:num(workloadRow.potential_revenue),
      runPool:num(workloadRow.run_pool),
      maxAgeDays:workloadRow.max_age_days==null?null:num(workloadRow.max_age_days),
      updatedAt:workloadRow.updated_at,
    }:null;

    return NextResponse.json({
      generatedAt:new Date().toISOString(),
      operationalModel:{
        week:`${shortDate(rotation.weekStart)} → ${shortDate(rotation.weekEnd)} · A/B alternent chaque semaine`,
        rotationAnchor:{weekStart:ROTATION_ANCHOR_MONDAY,morningTeam:"A",afternoonTeam:"B",nightTeam:"C"},
        currentWeek:{
          weekStart:rotation.weekStart,
          weekEnd:rotation.weekEnd,
          morningTeam:rotation.morningTeam,
          afternoonTeam:rotation.afternoonTeam,
          nightTeam:rotation.nightTeam,
        },
        nextWeek:{
          weekStart:addDays(rotation.weekStart,7),
          weekEnd:addDays(rotation.weekEnd,7),
          morningTeam:rotation.nextMorningTeam,
          afternoonTeam:rotation.nextAfternoonTeam,
          nightTeam:"C",
        },
        shifts:[
          {code:rotation.morningTeam,label:`Équipe ${rotation.morningTeam} · Matin`,start:"05:00",end:"13:00",rotation:`Semaine suivante : équipe ${rotation.nextMorningTeam}`},
          {code:rotation.afternoonTeam,label:`Équipe ${rotation.afternoonTeam} · Après-midi`,start:"13:00",end:"21:00",rotation:`Semaine suivante : équipe ${rotation.nextAfternoonTeam}`},
          {code:"C",label:"Équipe C · Nuit",start:"21:00",end:"05:00",rotation:"Fixe de nuit"},
        ],
        bodyshop:{fixlinesPerTeam:3,boxesPerTeam:5,heavyPanel:true},
        saturdayRule:"La production du samedi matin est rattachée au vendredi.",
      },
      production:{daily,latest:daily.at(-1)??null},
      teamDaily,
      clientTimes,
      workload,
      staffMapping:mappedRaw,
      unmappedStaff,
      readiness:{
        teamMapping:mappedRaw.filter(item=>item.active).length,
        autoTeamMapping:mappedRaw.filter(item=>item.active&&item.mapping_source==="rh_import").length,
        teamHours:teamDaily.length,
        clientRows:clientRaw.length,
      },
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Cockpit carrosserie indisponible."},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}

export async function POST(request:Request){
  const session=await currentSession();
  if(!session||session.session.role!=="admin")return NextResponse.json({error:"Accès administrateur CRVO requis."},{status:401});
  const config=env();
  if(!config)return NextResponse.json({error:"Base CRVO non configurée."},{status:503});
  const body=await request.json().catch(()=>null) as {mechanicName?:string;teamCode?:string;workcenter?:string}|null;
  const mechanicName=body?.mechanicName?.trim()??"";
  const teamCode=body?.teamCode??"";
  const workcenter=body?.workcenter??"mixed";
  if(!mechanicName||!["A","B","C"].includes(teamCode)||!["fixline_1","fixline_2","fixline_3","box","heavy","mixed"].includes(workcenter))return NextResponse.json({error:"Paramétrage équipe invalide."},{status:400});
  try{
    const rows=await rest<Record<string,unknown>[]>(config.supabaseUrl,config.secretKey,"kpi_bodyshop_staff_map?on_conflict=mechanic_key",{
      method:"POST",
      headers:{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=representation"},
      body:JSON.stringify({mechanic_name:mechanicName,team_code:teamCode,workcenter,active:true}),
    });
    return NextResponse.json({saved:true,mapping:rows?.[0]??null},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Enregistrement impossible."},{status:502});}
}
