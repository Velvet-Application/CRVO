import { NextResponse } from "next/server";
import { authRpc, currentSession } from "../../lib/crvo-auth";

export const dynamic="force-dynamic";

function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function list(value:unknown){return Array.isArray(value)?value.map(item=>String(item)).filter(Boolean):[];}
function nullable(value:unknown){const text=String(value??"").trim();return text||null;}
function trainingAllowed(profile:string,role:string){return role==="admin"||["service_manager","hr","trainer"].includes(profile);}
function financeAllowed(profile:string,role:string){return role==="admin"||profile==="hr";}
function message(error:unknown,fallback:string){
  const raw=error instanceof Error?error.message.replace(/^Auth RPC [^:]+ failed with \d+:?\s*/,""):fallback;
  const known:Record<string,string>={
    training_forbidden:"Accès Formation & compétences non autorisé.",training_finance_forbidden:"Accès financier réservé aux RH et administrateurs.",training_decision_forbidden:"Validation réservée aux RH et administrateurs.",employee_not_found:"Collaborateur carrosserie introuvable.",track_not_found:"Référentiel métier introuvable.",invalid_status:"Statut invalide.",invalid_priority:"Priorité invalide.",plan_not_found:"Plan de formation introuvable.",session_not_found:"Session de formation introuvable.",request_not_found:"Demande de formation introuvable.",title_required:"Le titre de la formation est obligatoire.",invalid_period:"La période de formation est invalide.",participant_required:"Sélectionne au moins un collaborateur.",participant_not_found:"Un participant n'est plus présent dans le périmètre carrosserie.",invalid_kind:"Type d'évaluation invalide.",invalid_scores:"Les notes de compétences sont invalides.",at_least_one_score_required:"Renseigne au moins une compétence avant d'enregistrer l'évaluation.",invalid_category:"Type d'observation invalide.",content_required:"L'observation ne peut pas être vide.",invalid_decision:"Décision invalide.",decision_comment_required:"Un commentaire est obligatoire pour refuser ou annuler.",invalid_attendance:"Statut d'émargement invalide.",attendance_not_found:"Émargement introuvable pour ce participant."
  };
  for(const[key,value]of Object.entries(known))if(raw.includes(key))return value;
  try{const parsed=JSON.parse(raw)as{message?:string};return parsed.message||fallback;}catch{return raw||fallback;}
}

async function access(){const current=await currentSession();if(!current||!trainingAllowed(current.session.access_profile,current.session.role))return null;return current;}

export async function GET(request:Request){
  const current=await access();if(!current)return json({error:"Accès réservé aux RH, chefs de service, administrateurs et formateurs."},403);
  const url=new URL(request.url);const employeeKey=url.searchParams.get("employeeKey");const mode=url.searchParams.get("mode");
  try{
    if(mode==="finance"){
      if(!financeAllowed(current.session.access_profile,current.session.role))return json({error:"Accès financier réservé aux RH et administrateurs."},403);
      return json(await authRpc<Record<string,unknown>>("kpi_training_finance_dashboard",{p_session_hash:current.tokenHash}));
    }
    if(employeeKey)return json(await authRpc<Record<string,unknown>>("kpi_training_employee_detail",{p_session_hash:current.tokenHash,p_employee_key:employeeKey}));
    return json(await authRpc<Record<string,unknown>>("kpi_training_dashboard",{p_session_hash:current.tokenHash}));
  }catch(error){console.error("training_get_failed",error);return json({error:message(error,"Module formation temporairement indisponible.")},500);}
}

export async function POST(request:Request){
  const current=await access();if(!current)return json({error:"Accès réservé aux RH, chefs de service, administrateurs et formateurs."},403);
  const body=await request.json().catch(()=>({}))as Record<string,unknown>;const action=String(body.action??"");
  try{
    if(action==="save-plan"){
      return json(await authRpc<Record<string,unknown>>("kpi_training_plan_upsert",{p_session_hash:current.tokenHash,p_plan_id:nullable(body.id),p_employee_key:String(body.employeeKey??""),p_track_key:String(body.trackKey??""),p_status:String(body.status??"to_plan"),p_priority:String(body.priority??"normal"),p_target_date:nullable(body.targetDate),p_objective:nullable(body.objective),p_trainer_id:nullable(body.trainerId)}));
    }
    if(action==="save-session"){
      return json(await authRpc<Record<string,unknown>>("kpi_training_session_save_v2",{p_session_hash:current.tokenHash,p_training_session_id:nullable(body.id),p_title:String(body.title??""),p_track_key:String(body.trackKey??""),p_trainer_id:nullable(body.trainerId),p_start_at:String(body.startAt??""),p_end_at:String(body.endAt??""),p_status:String(body.status??"planned"),p_location:nullable(body.location),p_objective:nullable(body.objective),p_focus_skill_keys:list(body.focusSkillKeys),p_participant_keys:list(body.participantKeys),p_notes:nullable(body.notes)}));
    }
    if(action==="decide-session"){
      if(!financeAllowed(current.session.access_profile,current.session.role))return json({error:"Validation réservée aux RH et administrateurs."},403);
      return json(await authRpc<Record<string,unknown>>("kpi_training_session_decide",{p_session_hash:current.tokenHash,p_session_id:String(body.sessionId??""),p_decision:String(body.decision??""),p_comment:nullable(body.comment)}));
    }
    if(action==="decide-request"){
      if(!financeAllowed(current.session.access_profile,current.session.role))return json({error:"Validation réservée aux RH et administrateurs."},403);
      return json(await authRpc<Record<string,unknown>>("kpi_training_request_decide",{p_session_hash:current.tokenHash,p_request_id:String(body.requestId??""),p_decision:String(body.decision??""),p_comment:nullable(body.comment),p_session_id:nullable(body.sessionId)}));
    }
    if(action==="save-evaluation"){
      const scores=Array.isArray(body.scores)?body.scores:[];
      return json(await authRpc<Record<string,unknown>>("kpi_training_evaluation_save",{p_session_hash:current.tokenHash,p_employee_key:String(body.employeeKey??""),p_track_key:String(body.trackKey??""),p_evaluation_date:String(body.evaluationDate??""),p_kind:String(body.kind??"checkpoint"),p_training_session_id:nullable(body.sessionId),p_summary:nullable(body.summary),p_scores:scores}));
    }
    if(action==="attendance-sign"){
      return json(await authRpc<Record<string,unknown>>("kpi_training_attendance_sign",{p_session_hash:current.tokenHash,p_session_id:String(body.sessionId??""),p_employee_key:String(body.employeeKey??""),p_attendance_status:String(body.attendanceStatus??"present"),p_signature_name:String(body.signatureName??""),p_signature_mark:nullable(body.signatureMark),p_signer:String(body.signer??"learner")}));
    }
    if(action==="finance-save"){
      if(!financeAllowed(current.session.access_profile,current.session.role))return json({error:"Accès financier réservé aux RH et administrateurs."},403);
      return json(await authRpc<Record<string,unknown>>("kpi_training_finance_save",{p_session_hash:current.tokenHash,p_settings:body.settings??null,p_profile:body.profile??null,p_session_finance:body.sessionFinance??null}));
    }
    if(action==="add-observation"){
      return json(await authRpc<Record<string,unknown>>("kpi_training_observation_add",{p_session_hash:current.tokenHash,p_employee_key:String(body.employeeKey??""),p_category:String(body.category??"observation"),p_content:String(body.content??""),p_track_key:nullable(body.trackKey),p_training_session_id:nullable(body.sessionId)}));
    }
    return json({error:"Action inconnue."},400);
  }catch(error){console.error("training_post_failed",error);return json({error:message(error,"Enregistrement impossible.")},400);}
}
