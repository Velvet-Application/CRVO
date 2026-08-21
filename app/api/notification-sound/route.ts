import {NextResponse} from "next/server";
import {authRpc,currentSession} from "../../lib/crvo-auth";

export const dynamic="force-dynamic";

type Preferences={sound:"crystal"|"pulse"|"soft_ping"|"silent";volume:number;ok?:boolean};
function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store"}})}

export async function GET(){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  try{
    const preferences=await authRpc<Preferences>("kpi_notification_sound_preferences_get",{p_session_hash:current.tokenHash});
    return json({preferences});
  }catch(error){
    console.error("notification_sound_preferences_get_failed",error);
    return json({preferences:{sound:"crystal",volume:.25}},200);
  }
}

export async function PUT(request:Request){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const sound=String(body.sound??"");
  const volume=Number(body.volume??.25);
  if(!["crystal","pulse","soft_ping","silent"].includes(sound)||!Number.isFinite(volume)||volume<0||volume>1)return json({error:"Réglage invalide."},400);
  try{
    const preferences=await authRpc<Preferences>("kpi_notification_sound_preferences_update",{p_session_hash:current.tokenHash,p_sound:sound,p_volume:volume});
    return json({preferences});
  }catch(error){
    console.error("notification_sound_preferences_update_failed",error);
    return json({error:"Enregistrement impossible."},400);
  }
}
