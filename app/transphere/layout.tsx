import type { ReactNode } from "react";
import TransphereNavigationBridge from "./transphere-navigation-bridge";

export default function TransphereLayout({ children }: { children: ReactNode }) {
  return <><TransphereNavigationBridge />{children}</>;
}
