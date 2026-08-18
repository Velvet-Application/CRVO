import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentSession } from "../lib/crvo-auth";
import ProductionStageFilter from "./production-stage-filter";
import ProductionAdvancedTools from "./production-advanced-tools";
import DevelopmentModuleNav from "./development-nav";

export default async function DevelopmentLayout({ children }: { children: ReactNode }) {
  const current = await currentSession();
  if (!current) redirect("/login?next=/developpement/production");
  if (current.session.role !== "admin") redirect("/");
  return <><DevelopmentModuleNav />{children}<ProductionStageFilter /><ProductionAdvancedTools /></>;
}
