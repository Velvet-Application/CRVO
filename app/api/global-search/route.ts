import { NextResponse } from "next/server";
import { currentSession } from "../../lib/crvo-auth";
import { supabaseRestHeaders } from "../../supabase-rest";

export const dynamic = "force-dynamic";

type VehicleRow={client?:string|null;registration?:string|null;work_order?:string|null;vin?:string|null;model?:string|null;mileage?:number|null;status?:string|null;status_age_days?:number|null;factory_age_days?:number|null;alert?:string|null;urgency?:string|null;source_modified_at?:string|null};
type ClaimRow={id?:string|null;claim_number?:string|null;client_name?:string|null;partner_label?:string|null;registration?:string|null;work_order?:string|null;vin?:string|null;model?:string|null;category?:string|null;subcategory?:string|null;priority?:string|null;status?:string|null;decision?:string|null;committee_response?:string|null;estimate_amount?:number|null;accepted_amount?:number|null;responsible_employee_name?:string|null;declared_at?:string|null;updated_at?:string|null};
type PersonRow={employee_key?:string|null;matricule?:string|null;full_name?:string|null;team_code?:string|null;service?:string|null;job_title?:string|null;employment_status?:string|null;primary_sector_label?:string|null;active?:boolean|null};
type ClientRow={client?:string|null;vehicle_count?:number|null;expertise_count?:number|null;chiffrage_count?:number|null;controle_technique_count?:number|null;mecanique_count?:number|null;carrosserie_count?:number|null;preparation_count?:number|null;qualite_count?:number|null;sortie_usine_count?:number|null;source_modified_at?:string|null};
type SearchKind="vehicle"|"claim"|"client"|"person";
type RpcRow={kind:SearchKind;source_id:string;payload:Record<string,unknown>;score:number};
type SearchResult={id:string;kind:SearchKind;eyebrow:string;title:string;subtitle:string;href:string;sourceLabel:string;badges:string[];summary:Array<{label:string;value:string}>};

function env(){const supabaseUrl=process.env.SUPABASE_URL;const secretKey=process.env.SUPABASE_SECRET_KEY;return supabaseUrl&&secretKey?{supabaseUrl,secretKey}:null;}
function clean(value:unknown){return String(value??"").trim();}
function shown(value:unknown,fallback="—"){const text=clean(value);return text||fallback;}
function numberLabel(value:unknown){const n=Number(value);return Number.isFinite(n)?n.toLocaleString("fr-FR"):"—";}
function moneyLabel(value:unknown){const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n):"—";}
function dateLabel(value:unknown){const text=clean(value);if(!text)return"—";const d=new Date(text);return Number.isNaN(d.getTime())?text:new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(d);}
function safeQuery(value:string){return value.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,80);}
function encoded(value:string){return encodeURIComponent(value);}
function summary(...rows:Array<[string,unknown]>){return rows.filter(([,value])=>clean(value)).map(([label,value])=>({label,value:shown(value)}));}

function vehicleResult(row:VehicleRow,index:number):SearchResult{
  const registration=shown(row.registration,"Véhicule");const client=shown(row.client,"Client non renseigné");
  return{id:`vehicle-${clean(row.vin)||clean(row.work_order)||clean(row.registration)||index}`,kind:"vehicle",eyebrow:"VÉHICULE / OR",title:registration,subtitle:[clean(row.model),clean(row.status)].filter(Boolean).join(" · ")||client,href:`/clients?client=${encoded(clean(row.client))}&vehicle=${encoded(clean(row.registration)||clean(row.vin)||clean(row.work_order))}`,sourceLabel:"Parc & dossier client",badges:[clean(row.urgency),clean(row.alert)].filter(Boolean),summary:summary(["Client",row.client],["VIN",row.vin],["N° OR",row.work_order],["Modèle",row.model],["Kilométrage",row.mileage!=null?`${numberLabel(row.mileage)} km`:null],["Statut",row.status],["Âge statut",row.status_age_days!=null?`${numberLabel(row.status_age_days)} j`:null],["Âge usine",row.factory_age_days!=null?`${numberLabel(row.factory_age_days)} j`:null])};
}
function claimResult(row:ClaimRow,index:number):SearchResult{
  const claim=shown(row.claim_number,"Réclamation");const sourceId=clean(row.id)||String(index);
  return{id:`claim-${sourceId}`,kind:"claim",eyebrow:"RÉCLAMATION QUALITÉ",title:claim,subtitle:[clean(row.registration),clean(row.client_name),clean(row.status)].filter(Boolean).join(" · "),href:`/metiers/relation-client?claim=${encoded(clean(row.claim_number)||sourceId)}`,sourceLabel:"Réclamations qualité",badges:[clean(row.priority),clean(row.decision)].filter(Boolean),summary:summary(["Client",row.client_name],["Immatriculation",row.registration],["VIN",row.vin],["N° OR",row.work_order],["Catégorie",[clean(row.category),clean(row.subcategory)].filter(Boolean).join(" / ")],["Statut",row.status],["Décision",row.decision],["Responsable",row.responsible_employee_name],["Devis",row.estimate_amount!=null?moneyLabel(row.estimate_amount):null],["Montant accepté",row.accepted_amount!=null?moneyLabel(row.accepted_amount):null],["Déclarée le",row.declared_at?dateLabel(row.declared_at):null])};
}
function personResult(row:PersonRow,index:number):SearchResult{
  const name=shown(row.full_name,"Collaborateur");const key=clean(row.employee_key)||clean(row.matricule)||clean(row.full_name)||String(index);
  return{id:`person-${key}`,kind:"person",eyebrow:"COLLABORATEUR",title:name,subtitle:[clean(row.job_title),clean(row.service),clean(row.team_code)].filter(Boolean).join(" · ")||"Ressources humaines",href:`/temps-travail?employee=${encoded(key)}`,sourceLabel:"Référentiel collaborateurs & RH",badges:[row.active===false?"Inactif":"Actif",clean(row.employment_status)].filter(Boolean),summary:summary(["Matricule",row.matricule],["Service",row.service],["Équipe",row.team_code],["Poste",row.job_title],["Secteur",row.primary_sector_label],["Clé collaborateur",row.employee_key],["Statut",row.active===false?"Inactif":"Actif"])};
}
function clientResult(row:ClientRow,index:number):SearchResult{
  const client=shown(row.client,"Client");
  return{id:`client-${index}-${client}`,kind:"client",eyebrow:"CLIENT",title:client,subtitle:`${numberLabel(row.vehicle_count)} véhicule${Number(row.vehicle_count)===1?"":"s"} en portefeuille`,href:`/clients?client=${encoded(client)}`,sourceLabel:"Dashboard client",badges:[],summary:summary(["Véhicules",row.vehicle_count],["Expertise",row.expertise_count],["Chiffrage",row.chiffrage_count],["CT",row.controle_technique_count],["Mécanique",row.mecanique_count],["Carrosserie",row.carrosserie_count],["Préparation",row.preparation_count],["Qualité",row.qualite_count])};
}

async function searchRpc(supabaseUrl:string,secretKey:string,query:string){
  const response=await fetch(`${supabaseUrl}/rest/v1/rpc/kpi_global_search`,{
    method:"POST",
    headers:supabaseRestHeaders(secretKey,{Accept:"application/json","Content-Type":"application/json"}),
    body:JSON.stringify({p_query:query,p_limit:28}),
    cache:"no-store",
  });
  if(!response.ok){const body=await response.text().catch(()=>"");throw new Error(`Supabase ${response.status}${body?` · ${body.slice(0,220)}`:""}`);}
  return response.json() as Promise<RpcRow[]>;
}

export async function GET(request:Request){
  const session=await currentSession();
  if(!session)return NextResponse.json({error:"Session CRVO requise."},{status:401,headers:{"Cache-Control":"no-store"}});
  const config=env();if(!config)return NextResponse.json({error:"Base CRVO non configurée."},{status:503,headers:{"Cache-Control":"no-store"}});
  const url=new URL(request.url);const raw=clean(url.searchParams.get("q"));const q=safeQuery(raw);
  if(q.length<2)return NextResponse.json({query:raw,results:[],total:0},{headers:{"Cache-Control":"private, no-store"}});
  try{
    const rows=await searchRpc(config.supabaseUrl,config.secretKey,q);
    const results:SearchResult[]=rows.map((row,index)=>{
      if(row.kind==="vehicle")return vehicleResult(row.payload as VehicleRow,index);
      if(row.kind==="claim")return claimResult(row.payload as ClaimRow,index);
      if(row.kind==="person")return personResult(row.payload as PersonRow,index);
      return clientResult(row.payload as ClientRow,index);
    });
    return NextResponse.json({query:raw,results,total:results.length},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){console.error(JSON.stringify({event:"global_search_failed",query:raw,message:error instanceof Error?error.message:"unknown"}));return NextResponse.json({error:"Recherche globale momentanément indisponible."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
