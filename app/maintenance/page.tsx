import { redirect } from "next/navigation";
import { currentSession } from "../lib/crvo-auth";
import MaintenanceClient from "./maintenance-client";

export default async function MaintenancePage() {
  const current = await currentSession();
  if (!current) redirect("/login");
  if (current.session.role !== "admin") redirect("/");
  return <MaintenanceClient />;
}
