import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../lib/crvo-auth";
import QualityClaimsWorkspace from "./quality-claims-workspace";

export default async function QualityClaimsPage() {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (!hasPageAccess(current.session, "quality_claims")) redirect("/");
  return <QualityClaimsWorkspace sessionName={current.session.display_name} canConfigure={current.session.role === "admin" || current.session.access_profile === "service_manager"} />;
}
