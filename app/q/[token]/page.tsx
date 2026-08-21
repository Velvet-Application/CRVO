import { redirect } from "next/navigation";

export default async function QualityShortLink({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  const safe=String(token??"").replace(/[^a-f0-9]/gi,"");
  if(safe.length<20||safe.length>64)redirect("/");
  redirect(`/qualite/client/${safe}`);
}
