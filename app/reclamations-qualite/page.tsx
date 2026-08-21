import { redirect } from "next/navigation";
import { currentSession, hasPageAccess } from "../lib/crvo-auth";
import QualityClaimsV2 from "./quality-claims-v2";

export default async function QualityClaimsPage() {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (!hasPageAccess(current.session, "quality_claims")) redirect("/");
  return <QualityClaimsV2 sessionName={current.session.display_name} canConfigure={current.session.role === "admin" || current.session.access_profile === "service_manager"} />;
}
