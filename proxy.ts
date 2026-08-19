import { NextRequest, NextResponse } from "next/server";

const COOKIE="crvo_session";
const DIRECTION_KIOSK_COOKIE="crvo_direction_kiosk";
const DIRECTION_KIOSK_TOKEN_HASH="cfec2c633ed2bfc5ac54785f9681b21bb6170667e5bf979bd28421673ecb7582";
const SUPABASE_URL="https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY="sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

type Session={ok:boolean;role:"admin"|"user";must_change_password:boolean;access_profile:"admin"|"service_manager"|"team_manager"|"custom";page_permissions:string[];productivity_scopes:string[];team_scopes:string[];can_manage_bonus_workflow:boolean;};
async function sha256Hex(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");}
async function validate(token:string){const tokenHash=await sha256Hex(token);const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/crvo_auth_context_v2`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({p_token_hash:tokenHash}),cache:"no-store"});if(!response.ok)throw new Error(`auth ${response.status}`);const rows=await response.json() as Session[];return rows[0]??null;}
async function validDirectionKioskToken(value?:string|null){if(!value)return false;return (await sha256Hex(value))===DIRECTION_KIOSK_TOKEN_HASH;}
function isStatic(pathname:string){return pathname.startsWith("/_next/")||pathname.startsWith("/assets/")||pathname==="/favicon.svg"||pathname==="/manifest.webmanifest"||/\.(?:css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|map|webmanifest)$/i.test(pathname);}
function apiUnauthorized(status=401,message="Authentification requise."){return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});}
function has(session:Session,key:string){return session.role==="admin"||session.page_permissions?.includes("*")||session.page_permissions?.includes(key);}
function firstAllowed(session:Session){if(has(session,"reporting")||has(session,"book"))return "/";if(has(session,"settings"))return "/?nav=objectives";if(has(session,"data_rh"))return "/animation-centre/rh";if(has(session,"productivity"))return "/performance/productivite";if(has(session,"monthly_animation"))return "/animation-mensuelle";if(has(session,"cockpit"))return "/cockpit-v2";if(has(session,"bodyshop"))return "/cockpit-v2/carrosserie";if(has(session,"client_dashboard"))return "/dashboard-client";if(has(session,"intelligence"))return "/intelligence";return "/account";}
function requiredPermission(path:string):string|null{if(path==="/performance/productivite"||path.startsWith("/api/productivity")||path.startsWith("/api/staff/suggestions"))return "productivity";if(path.startsWith("/animation-mensuelle")||path.startsWith("/api/monthly-animation"))return "monthly_animation";if(path.startsWith("/animation-centre/rh")||path.startsWith("/data-rh")||path.startsWith("/api/data-import")||path.startsWith("/api/staff/directory")||path.startsWith("/api/staff/competencies")||path.startsWith("/api/staff/operational"))return "data_rh";if(path.startsWith("/cockpit-v2/carrosserie")||path.startsWith("/api/bodyshop"))return "bodyshop";if(path.startsWith("/cockpit-v2")||path.startsWith("/api/cockpit-v2")||path.startsWith("/pilotage")||path.startsWith("/api/pilotage")||path.startsWith("/api/operational-live"))return "cockpit";if(path.startsWith("/dashboard-client")||path.startsWith("/clients")||path.startsWith("/api/client-dashboard")||path.startsWith("/api/clients"))return "client_dashboard";if(path.startsWith("/intelligence")||path.startsWith("/api/intelligence"))return "intelligence";if(path.startsWith("/book")||path.startsWith("/api/import-book"))return "book";return null;}
function adminOnlyPath(path:string){return path.startsWith("/animation-mensuelle/payplan")||path.startsWith("/animation-mensuelle/acces")||path.startsWith("/api/payplan")||path.startsWith("/capacitaire")||path.startsWith("/api/capacity-simulator")||path.startsWith("/api/capacity-simple")||path.startsWith("/developpement")||path.startsWith("/api/development")||path==="/expertise-mobile"||path==="/atelier"||path==="/direction"||path.startsWith("/api/kiosk/atelier")||path.startsWith("/api/kiosk/direction");}

export async function proxy(request:NextRequest){
  const path=request.nextUrl.pathname;
  if(path==="/developpement/expertise-mobile"){
    const url=request.nextUrl.clone();
    url.pathname="/expertise-mobile";
    return NextResponse.redirect(url,307);
  }
  const publicClientPortal=path.startsWith("/expertise/client/")||path.startsWith("/api/expertise/client/");
  if(isStatic(path)||path==="/api/health"||publicClientPortal)return NextResponse.next();

  if(path==="/direction"){
    const kioskQuery=request.nextUrl.searchParams.get("k");
    if(await validDirectionKioskToken(kioskQuery)){
      const url=request.nextUrl.clone();
      url.searchParams.delete("k");
      const response=NextResponse.redirect(url,307);
      response.cookies.set(DIRECTION_KIOSK_COOKIE,kioskQuery!,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:60*60*24*365});
      return response;
    }
    if(await validDirectionKioskToken(request.cookies.get(DIRECTION_KIOSK_COOKIE)?.value))return NextResponse.next();
  }
  if(path.startsWith("/api/kiosk/direction")&&await validDirectionKioskToken(request.cookies.get(DIRECTION_KIOSK_COOKIE)?.value))return NextResponse.next();

  const token=request.cookies.get(COOKIE)?.value;const publicLogin=path==="/login"||path==="/api/auth/login";
  if(!token){if(publicLogin)return NextResponse.next();if(path.startsWith("/api/"))return apiUnauthorized();const url=new URL("/login",request.url);if(path!=="/")url.searchParams.set("next",`${path}${request.nextUrl.search}`.slice(0,1000));return NextResponse.redirect(url);}
  try{
    const session=await validate(token);if(!session?.ok){const response=path.startsWith("/api/")?apiUnauthorized():NextResponse.redirect(new URL("/login",request.url));response.cookies.delete(COOKIE);return response;}
    if(publicLogin)return NextResponse.redirect(new URL(session.must_change_password?"/account?change=1":firstAllowed(session),request.url));
    if(session.must_change_password){const allowed=path==="/account"||path==="/api/auth/me"||path==="/api/auth/change-password"||path==="/api/auth/logout";if(!allowed){if(path.startsWith("/api/"))return apiUnauthorized(403,"Changement de mot de passe requis.");return NextResponse.redirect(new URL("/account?change=1",request.url));}}
    const authUtility=path==="/account"||path.startsWith("/api/auth/");if(authUtility)return NextResponse.next();
    if(adminOnlyPath(path)&&session.role!=="admin"){if(path.startsWith("/api/"))return apiUnauthorized(403,"Accès administrateur requis.");return NextResponse.redirect(new URL(firstAllowed(session),request.url));}
    if(path==="/"&&!has(session,"reporting")&&!has(session,"book")&&!has(session,"settings"))return NextResponse.redirect(new URL(firstAllowed(session),request.url));
    const permission=requiredPermission(path);if(permission&&!has(session,permission)){if(path.startsWith("/api/"))return apiUnauthorized(403,"Cette donnée n'est pas autorisée pour ce compte.");return NextResponse.redirect(new URL(firstAllowed(session),request.url));}
    return NextResponse.next();
  }catch(error){console.error("crvo_auth_proxy_failed",error);if(path.startsWith("/api/"))return apiUnauthorized(503,"Service d'authentification temporairement indisponible.");return new NextResponse("Service d'authentification temporairement indisponible.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});}
}
export const config={matcher:["/:path*"]};
