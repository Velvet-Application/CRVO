import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic="force-dynamic";

const WIDGET_KEYS=new Set(["factory_exits","entries","absence_rate","unplanned_absence_etp","factory_stock","entry_exit_gap","ftp_freshness","approved_leave"]);

function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}

export async function GET(request:Request){
  const current=await currentSession();
  if(!current)return json({error:"Session requise."},401);
  try{
    const url=new URL(request.url);
    const detail=String(url.searchParams.get("detail")??"").trim();
    if(detail){
      if(!WIDGET_KEYS.has(detail))return json({error:"Indicateur invalide."},400);
      const payload=await authRpc<Record<string,unknown>>("kpi_toolbox_widget_detail",{p_session_hash:current.tokenHash,p_widget_key:detail});
      return json(payload);
    }
    const payload=await authRpc<Record<string,unknown>>("kpi_toolbox_live_widgets",{p_session_hash:current.tokenHash});
    return json(payload);
  }catch(error){
    console.error("toolbox_widgets_get_failed",error);
    const message=error instanceof Error&&/non autoris/i.test(error.message)?"Cet indicateur n’est pas autorisé pour ce profil.":"Les indicateurs Live CRVO sont temporairement indisponibles.";
    return json({error:message},message.includes("autorisé")?403:503);
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
