import { NextResponse } from "next/server";
import { supabaseRestHeaders } from "../../../supabase-rest";
import { loadKioskDashboard, loadKioskSystemStatus } from "../kiosk-data";

export const dynamic = "force-dynamic";

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}
async function rpc(name:string,body:Record<string,unknown>){const config=env();if(!config)throw new Error("Base CRVO non configurée.");const response=await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`,{method:"POST",headers:supabaseRestHeaders(config.secretKey,{"Content-Type":"application/json",Accept:"application/json"}),body:JSON.stringify(body),cache:"no-store"});if(!response.ok){const detail=await response.text().catch(()=>"");throw new Error(`${name} ${response.status}${detail?`: ${detail.slice(0,300)}`:""}`);}return response.json() as Promise<Record<string,unknown>>;}
async function loadVerifiedMetrics(){const config=env();if(!config)return[];const response=await fetch(`${config.supabaseUrl}/rest/v1/kpi_daily_verified_metrics?select=metric_date,metric_key,metric_value,source_label,verified_at&order=metric_date.asc&limit=1000`,{headers:supabaseRestHeaders(config.secretKey,{Accept:"application/json"}),cache:"no-store"});if(!response.ok)throw new Error(`Lecture des métriques vérifiées impossible (${response.status}).`);return response.json();}
async function loadKioskObjectivesRpc(month:string|null){const value=month&&/^20\d{2}-\d{2}$/.test(month)?`${month}-01`:null;return rpc("kpi_kiosk_objectives",{p_month:value});}

export async function GET(request:Request){
  const url=new URL(request.url);const resource=url.searchParams.get("resource")??"dashboard";
  try{
    if(resource==="objectives")return NextResponse.json(await loadKioskObjectivesRpc(url.searchParams.get("month")),{headers:{"Cache-Control":"public, no-store"}});
    if(resource==="system-status")return NextResponse.json(await loadKioskSystemStatus(),{headers:{"Cache-Control":"public, no-store"}});
    if(resource==="verified-metrics")return NextResponse.json({rows:await loadVerifiedMetrics()},{headers:{"Cache-Control":"public, no-store"}});
    const requestedDate=url.searchParams.get("date")?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0]??null;
    return NextResponse.json(await loadKioskDashboard(url.searchParams.get("history")==="1",requestedDate),{headers:{"Cache-Control":"public, no-store"}});
  }catch(error){return NextResponse.json({connected:false,error:error instanceof Error?error.message:"Écran atelier indisponible."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
