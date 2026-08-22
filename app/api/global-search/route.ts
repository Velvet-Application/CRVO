import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type VehicleRow={client?:string|null;registration?:string|null;work_order?:string|null;vin?:string|null;model?:string|null;mileage?:number|null;status?:string|null;status_age_days?:number|null;factory_age_days?:number|null;alert?:string|null;urgency?:string|null;source_modified_at?:string|null};
type ClaimRow={id:string;claim_number?:string|null;client_name?:string|null;partner_label?:string|null;registration?:string|null;work_order?:string|null;vin?:string|null;model?:string|null;category?:string|null;subcategory?:string|null;priority?:string|null;status?:string|null;decision?:string|null;committee_response?:string|null;estimate_amount?:number|null;accepted_amount?:number|null;responsible_employee_name?:string|null;declared_at?:string|null;updated_at?:string|null};
type PersonRow={employee_key?:string|null;matricule?:string|null;full_name?:string|null;team_code?:string|null;service?:string|null;job_title?:string|null;employment_status?:string|null;primary_sector_label?:string|null;active?:boolean|null};
type ClientRow={client:string;vehicle_count?:number|null;expertise_count?:number|null;chiffrage_count?:number|null;controle_technique_count?:number|null;mecanique_count?:number|null;carrosserie_count?:number|null;preparation_count?:number|null;qualite_count?:number|null;sortie_usine_count?:number|null;source_modified_at?:string|null};
type SearchKind="vehicle"|"claim"|"client"|"person";
type SearchResult={id:string;kind:SearchKind;eyebrow:string;title:string;subtitle:string;href:string;sourceLabel:string;badges:string[];summary:Array<{label:string;value:string}>};

const vehicleSelect="client,registration,work_order,vin,model,mileage,status,status_age_days,factory_age_days,alert,urgency,source_modified_at";
const claimSelect="id,claim_number,client_name,partner_label,registration,work_order,vin,model,category,subcategory,priority,status,decision,committee_response,estimate_amount,accepted_amount,responsible_employee_name,declared_at,updated_at";
const personSelect="employee_key,matricule,full_name,team_code,service,job_title,employment_status,primary_sector_label,active";
const clientSelect="client,vehicle_count,expertise_count,chiffrage_count,controle_technique_count,mecanique_count,carrosserie_count,preparation_count,qualite_count,sortie_usine_count,source_modified_at";

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}
async function rest<T>(supabaseUrl:string,secretKey:string,path:string):Promise<T>{const response=await fetch(`${supabaseUrl}/rest/v1/${path}`,{headers:supabaseRestHeaders(secretKey,{Accept:"application/json"}),cache:"no-store"});if(!response.ok){const body=await response.text().catch(()=>"");throw new Error(`Supabase ${response.status}${body?` · ${body.slice(0,180)}`:""}`);}return response.json() as Promise<T>;}
function clean(value:unknown){return String(value??"").trim();}
function shown(value:unknown,fallback="—"){const text=clean(value);return text||fallback;}
function numberLabel(value:unknown){const n=Number(value);return Number.isFinite(n)?n.toLocaleString("fr-FR"):"—";}
function moneyLabel(value:unknown){const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n):"—";}
function dateLabel(value:unknown){const text=clean(value);if(!text)return"—";const d=new Date(text);return Number.isNaN(d.getTime())?text:new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d);}
function safeLike(value:string){return value.replace(/[*,()]/g," ").replace(/\s+/g," ").trim().slice(0,80);}
function encoded(value:string){return encodeURIComponent(value);}
function summary(...rows:Array<[string,unknown]>){return rows.filter(([,value])=>clean(value)).map(([label,value])=>({label,value:shown(value)}));}
function settled<T>(result:PromiseSettledResult<T[]>){return result.status==="fulfilled"?result.value:[];}

function vehicleResult(row:VehicleRow,index:number):SearchResult{
  const registration=shown(row.registration,"Véhicule");const client=shown(row.client,"Client non renseigné");
  return{id:`vehicle-${clean(row.vin)||clean(row.work_order)||clean(row.registration)||index}`,kind:"vehicle",eyebrow:"VÉHICULE / OR",title:registration,subtitle:[clean(row.model),clean(row.status)].filter(Boolean).join(" · ")||client,href:`/clients?client=${encoded(clean(row.client))}&vehicle=${encoded(clean(row.registration)||clean(row.vin)||clean(row.work_order))}`,sourceLabel:"Parc & dossier client",badges:[clean(row.urgency),clean(row.alert)].filter(Boolean),summary:summary(["Client",row.client],["VIN",row.vin],["N° OR",row.work_order],["Modèle",row.model],["Kilométrage",row.mileage!=null?`${numberLabel(row.mileage)} km`:null],["Statut",row.status],["Âge statut",row.status_age_days!=null?`${numberLabel(row.status_age_days)} j`:null],["Âge usine",row.factory_age_days!=null?`${numberLabel(row.factory_age_days)} j`:null])};
}
function claimResult(row:ClaimRow,index:number):SearchResult{
  const claim=shown(row.claim_number,"Réclamation");
  return{id:`claim-${row.id||index}`,kind:"claim",eyebrow:"RÉCLAMATION QUALITÉ",title:claim,subtitle:[clean(row.registration),clean(row.client_name),clean(row.status)].filter(Boolean).join(" · "),href:`/metiers/relation-client?claim=${encoded(clean(row.claim_number)||row.id)}`,sourceLabel:"Réclamations qualité",badges:[clean(row.priority),clean(row.decision)].filter(Boolean),summary:summary(["Client",row.client_name],["Immatriculation",row.registration],["VIN",row.vin],["N° OR",row.work_order],["Catégorie",[clean(row.category),clean(row.subcategory)].filter(Boolean).join(" / ")],["Statut",row.status],["Décision",row.decision],["Responsable",row.responsible_employee_name],["Devis",row.estimate_amount!=null?moneyLabel(row.estimate_amount):null],["Montant accepté",row.accepted_amount!=null?moneyLabel(row.accepted_amount):null],["Déclarée le",row.declared_at?dateLabel(row.declared_at):null])};
}
function personResult(row:PersonRow,index:number):SearchResult{
  const name=shown(row.full_name,"Collaborateur");const key=clean(row.employee_key)||clean(row.matricule)||clean(row.full_name);
  return{id:`person-${key||index}`,kind:"person",eyebrow:"COLLABORATEUR",title:name,subtitle:[clean(row.job_title),clean(row.service),clean(row.team_code)].filter(Boolean).join(" · ")||"Ressources humaines",href:`/temps-travail?employee=${encoded(key)}`,sourceLabel:"Référentiel collaborateurs & RH",badges:[row.active===false?"Inactif":"Actif",clean(row.employment_status)].filter(Boolean),summary:summary(["Matricule",row.matricule],["Service",row.service],["Équipe",row.team_code],["Poste",row.job_title],["Secteur",row.primary_sector_label],["Clé collaborateur",row.employee_key],["Statut",row.active===false?"Inactif":"Actif"])};
}
function clientResult(row:ClientRow,index:number):SearchResult{
  return{id:`client-${index}-${row.client}`,kind:"client",eyebrow:"CLIENT",title:row.client,subtitle:`${numberLabel(row.vehicle_count)} véhicule${Number(row.vehicle_count)===1?"":"s"} en portefeuille`,href:`/clients?client=${encoded(row.client)}`,sourceLabel:"Dashboard client",badges:[],summary:summary(["Véhicules",row.vehicle_count],["Expertise",row.expertise_count],["Chiffrage",row.chiffrage_count],["CT",row.controle_technique_count],["Mécanique",row.mecanique_count],["Carrosserie",row.carrosserie_count],["Préparation",row.preparation_count],["Qualité",row.qualite_count])};
}

export async function GET(request:Request){
  const session=await currentSession();
  if(!session)return NextResponse.json({error:"Session CRVO requise."},{status:401,headers:{"Cache-Control":"no-store"}});
  const config=env();if(!config)return NextResponse.json({error:"Base CRVO non configurée."},{status:503,headers:{"Cache-Control":"no-store"}});
  const url=new URL(request.url);const raw=clean(url.searchParams.get("q"));const q=safeLike(raw);
  if(q.length<2)return NextResponse.json({query:raw,results:[],total:0},{headers:{"Cache-Control":"private, no-store"}});
  const like=encoded(`*${q}*`);
  const requests=await Promise.allSettled([
    rest<VehicleRow[]>(config.supabaseUrl,config.secretKey,`kpi_client_vehicle_public?select=${vehicleSelect}&or=(registration.ilike.${like},vin.ilike.${like},work_order.ilike.${like},client.ilike.${like},model.ilike.${like})&order=factory_age_days.desc.nullslast&limit=8`),
    rest<ClaimRow[]>(config.supabaseUrl,config.secretKey,`kpi_quality_claims?select=${claimSelect}&or=(claim_number.ilike.${like},registration.ilike.${like},vin.ilike.${like},work_order.ilike.${like},client_name.ilike.${like},responsible_employee_name.ilike.${like})&order=updated_at.desc.nullslast&limit=8`),
    rest<PersonRow[]>(config.supabaseUrl,config.secretKey,`kpi_staff_effective?select=${personSelect}&or=(full_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},matricule.ilike.${like},employee_key.ilike.${like},service.ilike.${like},team_code.ilike.${like},job_title.ilike.${like},primary_sector_label.ilike.${like})&order=active.desc,full_name.asc&limit=10`),
    rest<ClientRow[]>(config.supabaseUrl,config.secretKey,`kpi_client_summary_public?select=${clientSelect}&client=ilike.${like}&order=vehicle_count.desc&limit=8`),
  ]);
  const vehicles=settled(requests[0] as PromiseSettledResult<VehicleRow[]>);const claims=settled(requests[1] as PromiseSettledResult<ClaimRow[]>);const people=settled(requests[2] as PromiseSettledResult<PersonRow[]>);const clients=settled(requests[3] as PromiseSettledResult<ClientRow[]>);
  const failures=requests.map((result,index)=>result.status==="rejected"?{source:["vehicles","claims","people","clients"][index],message:result.reason instanceof Error?result.reason.message:"unknown"}:null).filter(Boolean);
  if(failures.length)console.error(JSON.stringify({event:"global_search_partial_failure",query:raw,failures}));
  if(failures.length===requests.length)return NextResponse.json({error:"Recherche globale momentanément indisponible."},{status:503,headers:{"Cache-Control":"no-store"}});
  const results:SearchResult[]=[...vehicles.map(vehicleResult),...claims.map(claimResult),...clients.map(clientResult),...people.map(personResult)].slice(0,28);
  return NextResponse.json({query:raw,results,total:results.length,partial:failures.length>0},{headers:{"Cache-Control":"private, no-store"}});
}
