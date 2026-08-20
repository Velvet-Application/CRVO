import { notFound } from "next/navigation";
import { authRpc, currentSession } from "../../lib/crvo-auth";

type AccessPayload={allowed?:boolean};

export default async function PresenceLayout({children}:{children:React.ReactNode}){
  const current=await currentSession();
  if(!current)notFound();
  try{
    const access=await authRpc<AccessPayload>("kpi_site_presence_capacity_access",{p_session_hash:current.tokenHash});
    if(!access.allowed)notFound();
  }catch{
    notFound();
  }
  return children;
}
