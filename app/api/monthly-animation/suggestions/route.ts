import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/crvo-auth";
import { bonusRpc } from "../../../lib/bonus-rpc";

export const dynamic="force-dynamic";

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return NextResponse.json({error:"Session CRVO requise."},{status:401});
  if(current.session.role!=="admin")return NextResponse.json({error:"Accès administrateur requis."},{status:403});
  const workflowId=new URL(request.url).searchParams.get("workflowId");
  if(!workflowId)return NextResponse.json({error:"Workflow requis."},{status:400});
  try{
    const result=await bonusRpc("kpi_bonus_result_suggestions",{p_session_hash:current.tokenHash,p_workflow_id:workflowId});
    return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const message=error instanceof Error?error.message:"Suggestions indisponibles.";
    return NextResponse.json({error:message},{status:/requis|autorisé/i.test(message)?403:400,headers:{"Cache-Control":"no-store"}});
  }
}
