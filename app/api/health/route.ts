import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL="https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY="sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

async function check(path:string){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:SUPABASE_KEY,Accept:"application/json"},cache:"no-store"});
  if(!response.ok)throw new Error(`data ${response.status}`);
  return response.json();
}

export async function GET(){
  try{
    const [dashboard,bottlenecks,clients]=await Promise.all([
      check("kpi_ftp_live_dashboard?select=snapshot_at&limit=1"),
      check("kpi_bottleneck_live_public?select=sector_key&limit=20"),
      check("kpi_client_summary_public?select=client&limit=1"),
    ]);
    return NextResponse.json({
      ok:true,
      app:"KPI CRVO",
      dataReady:Array.isArray(dashboard)&&dashboard.length>0,
      bottlenecksReady:Array.isArray(bottlenecks)&&bottlenecks.length>=5,
      clientDashboardReady:Array.isArray(clients)&&clients.length>0,
      checkedAt:new Date().toISOString(),
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({ok:false,error:"health_check_failed"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
