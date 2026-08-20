import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../../lib/crvo-auth";

export default async function PilotagePerformanceLayout({children}:{children:React.ReactNode}){
  const current=await currentSession();
  if(!current)redirect("/login");
  const{session}=current;
  const allowed=session.role==="admin"||["reporting","book","settings"].some(key=>hasPageAccess(session,key));
  if(!allowed)redirect("/");
  return children;
}
