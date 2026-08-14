import { NextRequest, NextResponse } from "next/server";

const COOKIE="crvo_session";
const SUPABASE_URL="https://tvmkhvfmdstkunwwuzuz.supabase.co";
const SUPABASE_KEY="sb_publishable_bGCdOoq05alXNTOtouIQcQ_HX9jpKnv";

async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}

async function validate(token:string){
  const tokenHash=await sha256Hex(token);
  const response=await fetch(`${SUPABASE_URL}/rest/v1/rpc/crvo_auth_validate`,{
    method:"POST",
    headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({p_token_hash:tokenHash}),
    cache:"no-store",
  });
  if(!response.ok)throw new Error(`auth ${response.status}`);
  const rows=await response.json() as Array<{ok:boolean;role:string;must_change_password:boolean}>;
  return rows[0]??null;
}

function isStatic(pathname:string){
  return pathname.startsWith("/_next/")||pathname.startsWith("/assets/")||pathname==="/favicon.svg"||/\.(?:css|js|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|map)$/i.test(pathname);
}

function apiUnauthorized(status=401,message="Authentification requise."){
  return NextResponse.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
}

export async function proxy(request:NextRequest){
  const path=request.nextUrl.pathname;
  if(isStatic(path))return NextResponse.next();
  if(path==="/api/health")return NextResponse.next();

  const token=request.cookies.get(COOKIE)?.value;
  const publicLogin=path==="/login"||path==="/api/auth/login";
  if(!token){
    if(publicLogin)return NextResponse.next();
    if(path.startsWith("/api/"))return apiUnauthorized();
    const url=new URL("/login",request.url);
    if(path!=="/")url.searchParams.set("next",`${path}${request.nextUrl.search}`.slice(0,1000));
    return NextResponse.redirect(url);
  }

  try{
    const session=await validate(token);
    if(!session?.ok){
      const response=path.startsWith("/api/")?apiUnauthorized():NextResponse.redirect(new URL("/login",request.url));
      response.cookies.delete(COOKIE);
      return response;
    }

    if(publicLogin){
      return NextResponse.redirect(new URL(session.must_change_password?"/account?change=1":"/",request.url));
    }

    if(session.must_change_password){
      const allowed=path==="/account"||path==="/api/auth/me"||path==="/api/auth/change-password"||path==="/api/auth/logout";
      if(!allowed){
        if(path.startsWith("/api/"))return apiUnauthorized(403,"Changement de mot de passe requis.");
        return NextResponse.redirect(new URL("/account?change=1",request.url));
      }
    }

    return NextResponse.next();
  }catch(error){
    console.error("crvo_auth_proxy_failed",error);
    if(path.startsWith("/api/"))return apiUnauthorized(503,"Service d'authentification temporairement indisponible.");
    return new NextResponse("Service d'authentification temporairement indisponible.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}});
  }
}

export const config={matcher:["/:path*"]};
