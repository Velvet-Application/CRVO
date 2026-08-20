import { redirect } from "next/navigation";
import { authRpc, currentSession } from "../../lib/crvo-auth";
import TeamMembersEnhancer from "./team-members-enhancer";

type AccessPayload={allowed?:boolean};

function authorized(children:React.ReactNode){
  return <><TeamMembersEnhancer/>{children}</>;
}

export default async function PresenceLayout({children}:{children:React.ReactNode}){
  const current=await currentSession();
  if(!current)redirect("/login");

  const {session}=current;
  if(session.role==="admin"||session.access_profile==="service_manager")return authorized(children);

  try{
    const access=await authRpc<AccessPayload>("kpi_site_presence_capacity_access",{p_session_hash:current.tokenHash});
    if(access.allowed)return authorized(children);
  }catch(error){
    console.error("site_presence_layout_access_failed",error);
  }

  redirect(session.access_profile==="team_manager"?"/equipe":"/");
}
