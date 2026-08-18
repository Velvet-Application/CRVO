import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SUPABASE_URL="https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY="sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

type Warning={code?:string;severity?:string;message?:string};
type IndustrialHealth={ok:boolean;app:string;trustLevel:"green"|"amber"|"red";checkedAt:string;dataReady:boolean;bottlenecksReady:boolean;clientDashboardReady:boolean;warnings:Warning[];production?:Record<string,unknown>;ftp?:Record<string,unknown>};
type FinanceHealth={ready:boolean};

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function rpc<T>(name:string):Promise<T>{let lastError:unknown;for(let attempt=1;attempt<=3;attempt+=1){try{const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json",Accept:"application/json"},body:"{}",cache:"no-store"});if(response.ok)return await response.json() as T;lastError=new Error(`${name} ${response.status}`);if(![429,500,502,503,504].includes(response.status))throw lastError;}catch(error){lastError=error;}if(attempt<3)await wait(250*attempt);}throw lastError instanceof Error?lastError:new Error(`${name} unavailable`);}

export async function GET(){
  try{
    // Contrat industriel v3 : surveillance à 30 min, criticité FTP seulement au-delà d'une heure.
    const [trust,financeHealth]=await Promise.all([rpc<IndustrialHealth>("kpi_industrial_health_v3_public"),rpc<FinanceHealth>("kpi_industrial_finance_health_public")]);
    const objectiveReady=Number(trust.production?.dailyExitTarget??0)>0;
    const platformOk=Boolean(trust.dataReady&&trust.bottlenecksReady&&trust.clientDashboardReady&&financeHealth.ready&&objectiveReady);
    const warnings=(trust.warnings??[]).slice(0,8).map(item=>({code:item.code??"source_watch",severity:item.severity??"warning",message:item.message??"Une source nécessite un contrôle."}));
    return NextResponse.json({
      ok:platformOk,
      dataTrustOk:trust.ok,
      trustLevel:trust.trustLevel,
      checkedAt:trust.checkedAt,
      dataReady:trust.dataReady,
      bottlenecksReady:trust.bottlenecksReady,
      clientDashboardReady:trust.clientDashboardReady,
      financeReady:financeHealth.ready,
      objectiveReady,
      warnings,
      ftp:{syncAgeMinutes:trust.ftp?.syncAgeMinutes??null},
      production:{sourceAgeMinutes:trust.production?.sourceAgeMinutes??null},
    },{status:platformOk?200:503,headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error(JSON.stringify({event:"industrial_health_failed",message:error instanceof Error?error.message:"unknown"}));
    return NextResponse.json({ok:false,dataTrustOk:false,trustLevel:"red",dataReady:false,bottlenecksReady:false,clientDashboardReady:false,financeReady:false,objectiveReady:false,warnings:[{code:"health_check_failed",severity:"critical",message:"Contrôle de confiance des données indisponible après plusieurs tentatives."}],error:"health_check_failed"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
