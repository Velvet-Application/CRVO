import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { bonusRpc } from "../../lib/bonus-rpc";

export const dynamic="force-dynamic";

function responseError(error:unknown){const message=error instanceof Error?error.message:"Opération Payplan impossible.";return NextResponse.json({error:message},{status:/seul|requis|autorisé/i.test(message)?403:400,headers:{"Cache-Control":"no-store"}});}

export async function GET(request:Request){
  const current=await currentSession();if(!current)return NextResponse.json({error:"Session CRVO requise."},{status:401});
  if(current.session.role!=="admin")return NextResponse.json({error:"Accès administrateur requis."},{status:403});
  try{
    const workflowId=new URL(request.url).searchParams.get("workflowId");
    const result=workflowId
      ?await bonusRpc("kpi_bonus_get_workflow_payplan",{p_session_hash:current.tokenHash,p_workflow_id:workflowId})
      :await bonusRpc("kpi_bonus_get_payplan",{p_session_hash:current.tokenHash});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){return responseError(error);}
}

export async function PATCH(request:Request){
  const current=await currentSession();if(!current)return NextResponse.json({error:"Session CRVO requise."},{status:401});
  if(current.session.role!=="admin")return NextResponse.json({error:"Accès administrateur requis."},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  try{
    if(body.action==="common_coefficients"){
      const coefficients=Array.isArray(body.coefficients)?body.coefficients.map(Number):[];
      const result=await bonusRpc("kpi_bonus_update_common_coefficients",{p_session_hash:current.tokenHash,p_coefficients:coefficients});
      return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
    }
    if(body.action==="rule"){
      const result=await bonusRpc("kpi_bonus_update_payplan_rule",{
        p_session_hash:current.tokenHash,p_rule_id:String(body.ruleId??""),
        p_thresholds:Array.isArray(body.thresholds)?body.thresholds:[],p_coefficients:Array.isArray(body.coefficients)?body.coefficients:[],
        p_base_amount_eur:body.baseAmountEur===""||body.baseAmountEur==null?null:Number(body.baseAmountEur),
        p_settings:typeof body.settings==="object"&&body.settings?body.settings:{},
      });return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
    }
    if(body.action==="settings"){
      const result=await bonusRpc("kpi_bonus_update_payplan_settings",{p_session_hash:current.tokenHash,p_settings:typeof body.settings==="object"&&body.settings?body.settings:{}});
      return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
    }
    return NextResponse.json({error:"Action inconnue."},{status:400});
  }catch(error){return responseError(error);}
}
