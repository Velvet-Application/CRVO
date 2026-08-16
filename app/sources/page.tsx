import { redirect } from "next/navigation";
import { currentSession } from "../lib/crvo-auth";
import SourcesClient from "./sources-client";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const current = await currentSession();
  if (!current) redirect("/login");
  const user = current.session;
  const allowed = user.role === "admin" || user.page_permissions.includes("*") || user.page_permissions.includes("settings");
  if (!allowed) redirect("/");
  return <SourcesClient />;
}
