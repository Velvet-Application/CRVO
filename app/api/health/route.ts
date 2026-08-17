import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL="https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY="sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

type IndustrialHealth={
  ok:boolean;app:string;trustLevel:"green"|"amber"|"red";checkedAt:string;
  dataReady:boolean;bottlenecksReady:boolean;clientDashboardReady:boolean;warnings:unknown[];
  production?:Record<string,unknown>;ftp?:Record<string,unknown>;finance?:Record<string,unknown>;
  productivity?:Record<string,unknown>;rh?:Record<string,unknown>;parkQuality?:Record<string,unknown>;bodyshop?:Record<string,unknown>;
};

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function readIndustrialHealth(){
  let lastError:unknown;
  for(let attempt=1;attempt<=3;attempt+=1){
    try{
      const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/kpi_industrial_health_public`,{
        method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json",Accept:"application/json"},body:"{}",cache:"no-store",
      });
      if(response.ok)return await response.json() as IndustrialHealth;
      lastError=new Error(`industrial_health ${response.status}`);
      if(![429,500,502,503,504].includes(response.status))throw lastError;
    }catch(error){lastError=error;}
    if(attempt<3)await wait(250*attempt);
  }
  throw lastError instanceof Error?lastError:new Error("industrial_health unavailable");
}

export async function GET(){
  try{
    const trust=await readIndustrialHealth();
    const platformOk=Boolean(trust.dataReady&&trust.bottlenecksReady&&trust.clientDashboardReady);
    return NextResponse.json({...trust,ok:platformOk,dataTrustOk:trust.ok},{status:platformOk?200:503,headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error(JSON.stringify({event:"industrial_health_failed",message:error instanceof Error?error.message:"unknown"}));
    return NextResponse.json({ok:false,dataTrustOk:false,trustLevel:"red",dataReady:false,bottlenecksReady:false,clientDashboardReady:false,warnings:[{code:"health_check_failed",severity:"critical",message:"Contrôle de confiance des données indisponible après plusieurs tentatives."}],error:"health_check_failed"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
