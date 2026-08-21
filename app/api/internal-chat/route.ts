import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}})}

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  const url=new URL(request.url);
  const thread=url.searchParams.get("thread");
  try{
    const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_snapshot",{
      p_session_hash:current.tokenHash,
      p_thread_id:thread||null,
    });
    return json(payload);
  }catch(error){
    console.error("internal_chat_get_failed",error);
    return json({error:"Messagerie temporairement indisponible."},503);
  }
}

export async function POST(request:Request){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const action=String(body.action??"");
  try{
    if(action==="startDirect"){
      const peer=String(body.peerUserId??"");
      if(!peer)return json({error:"Utilisateur requis."},400);
      const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_start_direct",{p_session_hash:current.tokenHash,p_peer_user_id:peer});
      return json(payload);
    }
    if(action==="send"){
      const thread=String(body.threadId??"");
      if(!thread)return json({error:"Conversation requise."},400);
      const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_send",{
        p_session_hash:current.tokenHash,
        p_thread_id:thread,
        p_body:body.message==null?null:String(body.message),
        p_linked_claim_id:body.linkedClaimId?String(body.linkedClaimId):null,
      });
      return json(payload);
    }
    if(action==="read"){
      const thread=String(body.threadId??"");
      if(!thread)return json({error:"Conversation requise."},400);
      const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_mark_read",{p_session_hash:current.tokenHash,p_thread_id:thread});
      return json(payload);
    }
    return json({error:"Action invalide."},400);
  }catch(error){
    console.error("internal_chat_post_failed",error);
    const message=error instanceof Error?error.message:"Action impossible.";
    return json({error:/42501/.test(message)?"Action non autorisée.":"Action impossible."},400);
  }
}
