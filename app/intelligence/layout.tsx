import type { Metadata } from "next";
import type { ReactNode } from "react";
import CockpitName from "./cockpit-name";
import ManagerialFocus from "./managerial-focus";

export const metadata: Metadata = { title: "CRVO COCKPIT V2" };

export default function IntelligenceLayout({ children }: { children: ReactNode }) {
  return <div><CockpitName /><ManagerialFocus />{children}</div>;
}
