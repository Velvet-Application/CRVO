import { NextRequest, NextResponse } from "next/server";
import { authRpc, currentSession, sha256Hex } from "../../lib/crvo-auth";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const QUALITY_HISTORY_START="2026-01-01";
function noStore(status=200){return{status,headers:{"Cache-Control":"no-store, no-cache, must-revalidate, max-age=0"}}}
function errorText(error:unknown,fallback:string){const text=error instanceof Error?error.message:String(error??"");const m=text.match(/message\\?"?:\\?"([^"}]{3,240})/i);return m?.[1]||fallback}
function statusFor(error:unknown){const text=error instanceof Error?error.message:String(error??"");if(text.includes("42501")||/non autorisé|réservé|requise/i.test(text))return 403;if(text.includes("22023")||/invalide|requis|manquant|existe déjà/i.test(text))return 400;if(text.includes("P0002")||/introuvable/i.test(text))return 404;return 503}
function randomHex(bytes:number){const data=new Uint8Array(bytes);crypto.getRandomValues(data);return Array.from(data,b=>b.toString(16).padStart(2,"0")).join("")}
function password(){const upper="ABCDEFGHJKLMNPQRSTUVWXYZ",lower="abcdefghijkmnopqrstuvwxyz",digits="23456789",special="!@#$%_-";const all=upper+lower+digits+special;const pick=(s:string)=>s[crypto.getRandomValues(new Uint8Array(1))[0]%s.length];let out=pick(upper)+pick(lower)+pick(digits)+pick(special);for(let i=0;i<12;i++)out+=pick(all);return out.split("").sort(()=>crypto.getRandomValues(new Uint8Array(1))[0]/255-.5).join("")}
function slug(value:unknown){return String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,".").replace(/^\.|\.$/g,"").slice(0,32)}
function clampPeriod(url:URL){const today=new Date().toISOString().slice(0,10);const rawFrom=url.searchParams.get("dateFrom");const rawTo=url.searchParams.get("dateTo");const from=!rawFrom||rawFrom<QUALITY_HISTORY_START?QUALITY_HISTORY_START:rawFrom;const to=!rawTo||rawTo>today?today:rawTo;return{from,to}}

export async function GET(request:NextRequest){
  const current=await currentSession();
  if(!current)return NextResponse.json({error:"Session CRVO requise."},noStore(401));
  const url=new URL(request.url);
  const period=clampPeriod(url);
  if(period.to<period.from)return NextResponse.json({error:"Période invalide."},noStore(400));
  try{
    const payload=await authRpc<Record<string,unknown>>("kpi_quality_dashboard_v2_private",{
      p_token_hash:current.tokenHash,
      p_claim_id:url.searchParams.get("claimId")||null,
      p_search:url.searchParams.get("search")||null,
      p_date_from:period.from,
      p_date_to:period.to,
    });
    const originalPeriod=(payload.period&&typeof payload.period==="object"?payload.period:{}) as Record<string,unknown>;
    payload.period={...originalPeriod,from:period.from,to:period.to,firstClaimDate:QUALITY_HISTORY_START};
    const detail=payload.detail as {claim?:{declared_at?:unknown}}|null|undefined;
    if(detail?.claim?.declared_at&&String(detail.claim.declared_at).slice(0,10)<QUALITY_HISTORY_START)payload.detail=null;
    return NextResponse.json(payload,noStore());
  }catch(error){console.error("quality_claims_v2_get_failed",error);return NextResponse.json({error:errorText(error,"Réclamations Qualité indisponibles.")},noStore(statusFor(error)))}
}

export async function POST(request:NextRequest){
  const current=await currentSession();
  if(!current)return NextResponse.json({error:"Session CRVO requise."},noStore(401));
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const action=String(body.action??"");
  try{
    if(action==="updateNetworkAccess"){
      const payload=await authRpc<Record<string,unknown>>("kpi_quality_network_account_upsert_private",{
        p_token_hash:current.tokenHash,
        p_access_id:body.accessId||null,
        p_payload:body.payload??{},
      });
      return NextResponse.json(payload,noStore());
    }
    if(action==="toggleNetworkAccess"){
      const payload=await authRpc<Record<string,unknown>>("kpi_quality_network_access_toggle_private",{
        p_token_hash:current.tokenHash,p_access_id:body.accessId,p_enabled:Boolean(body.enabled),
      });
      return NextResponse.json(payload,noStore());
    }
    if(action==="regenerateNetworkAccess"){
      const accessId=String(body.accessId??"");
      if(!accessId)return NextResponse.json({error:"Compte réseau manquant."},noStore(400));
      const rawToken=randomHex(12);
      const tokenHash=await sha256Hex(rawToken);
      const base=slug(body.partnerLabel||body.client||"reseau")||"reseau";
      const requested=slug(body.username);
      const username=(requested?`${requested}.${randomHex(2)}`:`crvo.${base}.${randomHex(2)}`).slice(0,79);
      const temporaryPassword=password();
      const payload=await authRpc<Record<string,unknown>>("kpi_quality_network_regenerate_private",{
        p_token_hash:current.tokenHash,p_access_id:accessId,p_access_token_hash:tokenHash,p_username:username,p_temporary_password:temporaryPassword,
      });
      const origin=new URL(request.url).origin;
      const portalUrl=`${origin}/q/${rawToken}`;
      return NextResponse.json({...payload,username,temporaryPassword,portalUrl},noStore());
    }
    return NextResponse.json({error:"Action inconnue."},noStore(400));
  }catch(error){console.error("quality_claims_v2_post_failed",error);return NextResponse.json({error:errorText(error,"Action impossible.")},noStore(statusFor(error)))}
}
