import { redirect } from "next/navigation";
import { currentSession } from "../lib/crvo-auth";
import InternalChat from "./internal-chat";

export const dynamic="force-dynamic";

export default async function MessageriePage(){
  const current=await currentSession();
  if(!current)redirect("/login");
  return <InternalChat sessionName={current.session.display_name}/>;
}
