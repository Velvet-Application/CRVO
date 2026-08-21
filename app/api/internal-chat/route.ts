import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";

function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}})}
function safeFileName(value:unknown){return String(value??"piece-jointe").replace(/[\r\n"\\]/g,"_").slice(0,180)||"piece-jointe"}
function base64Bytes(value:string){const clean=value.includes(",")?value.slice(value.indexOf(",")+1):value;const binary=atob(clean);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);return bytes}
function errorStatus(error:unknown){const text=error instanceof Error?error.message:String(error??"");if(/42501|non autoris|session requise/i.test(text))return 403;if(/22023|vide|invalide|format|maximum|limit/i.test(text))return 400;if(/P0002|introuvable/i.test(text))return 404;return 500}
function errorMessage(error:unknown){const text=error instanceof Error?error.message:String(error??"");const match=text.match(/message:\s*([^\n]+)/i);return match?.[1]?.trim()||text.split("\n")[0]||"Action impossible."}

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  const url=new URL(request.url);
  const thread=url.searchParams.get("thread");
  const avatarUserId=url.searchParams.get("avatarUserId");
  const attachmentId=url.searchParams.get("attachmentId");
  try{
    if(avatarUserId){
      const file=await authRpc<{found?:boolean;mimeType?:string;fileData?:string}>("kpi_internal_chat_avatar_get",{p_session_hash:current.tokenHash,p_user_id:avatarUserId});
      if(!file.found||!file.fileData)return new Response(null,{status:404,headers:{"Cache-Control":"private, no-store"}});
      return new Response(base64Bytes(file.fileData),{status:200,headers:{"Content-Type":file.mimeType||"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if(attachmentId){
      const file=await authRpc<{fileName?:string;mimeType?:string;fileData?:string}>("kpi_internal_chat_attachment_get",{p_session_hash:current.tokenHash,p_attachment_id:attachmentId});
      if(!file.fileData)return json({error:"Pièce jointe indisponible."},404);
      return new Response(base64Bytes(file.fileData),{status:200,headers:{"Content-Type":file.mimeType||"application/octet-stream","Content-Disposition":`inline; filename="${safeFileName(file.fileName)}"`,`Cache-Control`:"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_snapshot",{p_session_hash:current.tokenHash,p_thread_id:thread||null});
    return json(payload);
  }catch(error){
    console.error("internal_chat_get_failed",error);
    const status=errorStatus(error);
    return json({error:status===403?"Accès non autorisé.":status===404?"Élément introuvable.":"Messagerie temporairement indisponible."},status);
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
      const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_send_v2",{
        p_session_hash:current.tokenHash,
        p_thread_id:thread,
        p_body:body.message==null?null:String(body.message),
        p_linked_claim_id:body.linkedClaimId?String(body.linkedClaimId):null,
        p_attachments:Array.isArray(body.attachments)?body.attachments:[],
      });
      return json(payload);
    }
    if(action==="avatar"){
      const avatar=(body.avatar&&typeof body.avatar==="object"?body.avatar:{}) as Record<string,unknown>;
      const payload=await authRpc<Record<string,unknown>>("kpi_internal_chat_avatar_update",{
        p_session_hash:current.tokenHash,
        p_mime_type:String(avatar.mimeType??""),
        p_size_bytes:Number(avatar.sizeBytes??0),
        p_file_data:String(avatar.fileData??""),
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
    const status=errorStatus(error);
    return json({error:status===403?"Action non autorisée.":errorMessage(error)},status);
  }
}
