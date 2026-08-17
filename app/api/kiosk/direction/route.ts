import { NextResponse } from "next/server";
import { loadKioskDashboard } from "../kiosk-data";
import { currentSession } from "../../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../../supabase-rest";

export const dynamic = "force-dynamic";

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}
async function rpc(name:string,body:Record<string,unknown>){
  const config=env();if(!config)throw new Error("Base CRVO non configurée.");
  const response=await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`,{method:"POST",headers:supabaseRestHeaders(config.secretKey,{"Content-Type":"application/json",Accept:"application/json"}),body:JSON.stringify(body),cache:"no-store"});
  if(!response.ok){const detail=await response.text().catch(()=>"");throw new Error(`${name} ${response.status}${detail?`: ${detail.slice(0,300)}`:""}`);}
  return response.json() as Promise<Record<string,unknown>>;
}
async function loadDirectionFinance(history:boolean){return rpc("kpi_kiosk_direction_finance",{p_history:history});}
async function loadDirectionObjectives(month:string|null){const value=month&&/^20\d{2}-\d{2}$/.test(month)?`${month}-01`:null;return rpc("kpi_kiosk_objectives",{p_month:value});}

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return NextResponse.json({connected:false,error:"Session CRVO requise."},{status:401,headers:{"Cache-Control":"no-store"}});
  if(current.session.role!=="admin")return NextResponse.json({connected:false,error:"Accès administrateur requis."},{status:403,headers:{"Cache-Control":"no-store"}});
  const url=new URL(request.url);const resource=url.searchParams.get("resource")??"dashboard";
  try{
    if(resource==="finance")return NextResponse.json(await loadDirectionFinance(url.searchParams.get("history")==="1"),{headers:{"Cache-Control":"private, no-store"}});
    if(resource==="objectives")return NextResponse.json(await loadDirectionObjectives(url.searchParams.get("month")),{headers:{"Cache-Control":"private, no-store"}});
    const requestedDate=url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0]??null;
    return NextResponse.json(await loadKioskDashboard(url.searchParams.get("history")==="1",requestedDate),{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return NextResponse.json({connected:false,error:error instanceof Error?error.message:"Écran direction indisponible."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
