import {NextResponse} from "next/server";
import {authRpc,currentSession} from "../../../lib/crvo-auth";

export const dynamic="force-dynamic";
function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function nullable(value:unknown){const text=String(value??"").trim();return text||null;}
function msg(error:unknown){const raw=error instanceof Error?error.message:"Demande impossible.";if(raw.includes("training_request_forbidden"))return"Accès réservé aux superviseurs de production et fonctions autorisées.";if(raw.includes("employee_not_in_scope"))return"Ce collaborateur n'est pas dans ton périmètre carrosserie.";if(raw.includes("difficulties_required"))return"Décris les difficultés observées avant d'envoyer la demande.";return raw.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/,"");}

export async function GET(){const current=await currentSession();if(!current)return json({error:"Session requise."},401);try{return json(await authRpc<Record<string,unknown>>("kpi_training_request_context",{p_session_hash:current.tokenHash}));}catch(error){return json({error:msg(error)},403);}}
export async function POST(request:Request){const current=await currentSession();if(!current)return json({error:"Session requise."},401);const body=await request.json().catch(()=>({}))as Record<string,unknown>;try{return json(await authRpc<Record<string,unknown>>("kpi_training_request_submit",{p_session_hash:current.tokenHash,p_employee_key:String(body.employeeKey??""),p_track_key:nullable(body.trackKey),p_difficulties:String(body.difficulties??""),p_acquired_skills:nullable(body.acquiredSkills),p_requested_skills:nullable(body.requestedSkills),p_operational_context:nullable(body.operationalContext),p_urgency:String(body.urgency??"normal")}));}catch(error){return json({error:msg(error)},400);}}
