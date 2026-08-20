import { redirect } from "next/navigation";
import { currentSession } from "../lib/crvo-auth";

export default async function FormationLayout({children}:{children:React.ReactNode}){
  const current=await currentSession();
  if(!current)redirect("/login");
  const{session}=current;
  const allowed=session.role==="admin"||["service_manager","hr","trainer"].includes(session.access_profile);
  if(!allowed)redirect("/");
  return children;
}
