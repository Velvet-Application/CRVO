import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic="force-dynamic";

function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}

export async function GET(){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  try{
    const payload=await authRpc<Record<string,unknown>>("kpi_toolbox_live_widgets",{p_session_hash:current.tokenHash});
    return json(payload);
  }catch(error){
    console.error("toolbox_widgets_get_failed",error);
    return json({error:"Les indicateurs Live CRVO sont temporairement indisponibles."},503);
  }
}

export async function POST(request:Request){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  const body=await request.json().catch(()=>({})) as {widgets?:unknown};
  if(!Array.isArray(body.widgets))return json({error:"Sélection de widgets invalide."},400);
  const widgets=body.widgets.map(value=>String(value)).filter(Boolean);
  try{
    const payload=await authRpc<Record<string,unknown>>("kpi_toolbox_widget_preferences_save",{p_session_hash:current.tokenHash,p_widget_keys:widgets});
    return json(payload);
  }catch(error){
    console.error("toolbox_widgets_save_failed",error);
    const raw=error instanceof Error?error.message:"Enregistrement impossible.";
    const message=raw.includes("entre 1 et 6")?"Sélectionne entre 1 et 6 widgets.":raw.includes("non autorisé")?"Un indicateur sélectionné n’est pas autorisé pour ce profil.":"Impossible d’enregistrer cette configuration.";
    return json({error:message},400);
  }
}
