import {redirect} from "next/navigation";
import {currentSession} from "../lib/crvo-auth";

export default async function FormationLayout({children}:{children:React.ReactNode}){
  const current=await currentSession();
  if(!current)redirect("/login");
  return children;
}
