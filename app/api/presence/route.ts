import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type SyncRun = {
  completed_at:string|null;
  status:string;
  sync_mode:string;
  rows_saved:number;
  min_work_date:string|null;
  max_work_date:string|null;
  error_message:string|null;
};

type PresenceRow = {
  work_date:string;
  mechanic_name:string|null;
  time_code:string|null;
  time_description:string|null;
  time_value:number|string|null;
  source_rows:number|string|null;
  source_synced_at:string|null;
};

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}

export async function GET(request:Request){
  const config=env();
  if(!config)return NextResponse.json({connected:false,error:"Source SQL Présentéisme non configurée."},{status:503,headers:{"Cache-Control":"no-store"}});
  const url=new URL(request.url);
  const date=(url.searchParams.get("date")??"").match(/^20\d{2}-\d{2}-\d{2}$/)?.[0]??new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const headers=supabaseRestHeaders(config.secretKey,{Accept:"application/json"});
  const [syncResponse,presenceResponse]=await Promise.all([
    fetch(`${config.supabaseUrl}/rest/v1/kpi_sql_presence_sync_runs?select=completed_at,status,sync_mode,rows_saved,min_work_date,max_work_date,error_message&order=started_at.desc&limit=1`,{headers,cache:"no-store"}),
    fetch(`${config.supabaseUrl}/rest/v1/kpi_sql_presence_daily?select=work_date,mechanic_name,time_code,time_description,time_value,source_rows,source_synced_at&work_date=eq.${date}&order=mechanic_name.asc,time_code.asc&limit=5000`,{headers,cache:"no-store"}),
  ]);
  if(!syncResponse.ok||!presenceResponse.ok)return NextResponse.json({connected:false,error:"Lecture SQL Présentéisme indisponible."},{status:502,headers:{"Cache-Control":"no-store"}});
  const sync=(await syncResponse.json() as SyncRun[])[0]??null;
  const rows=await presenceResponse.json() as PresenceRow[];
  const mechanics=new Set(rows.map(row=>row.mechanic_name).filter(Boolean));
  const totalTime=rows.reduce((sum,row)=>sum+(Number(row.time_value)||0),0);
  const byCode=Object.values(rows.reduce<Record<string,{code:string;description:string|null;time:number;rows:number}>>((acc,row)=>{const key=row.time_code??"<vide>";const item=acc[key]??{code:key,description:row.time_description,time:0,rows:0};item.time+=Number(row.time_value)||0;item.rows+=Number(row.source_rows)||0;acc[key]=item;return acc;},{})).sort((a,b)=>b.time-a.time);
  return NextResponse.json({connected:sync?.status==="success",date,lastSync:sync,summary:{mechanics:mechanics.size,rows:rows.length,totalTime},byCode,rows},{headers:{"Cache-Control":"no-store"}});
}
