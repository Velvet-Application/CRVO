import type { ReactNode } from "react";
import { currentSession } from "../lib/crvo-auth";
import styles from "./bonus-layout.module.css";

export const dynamic = "force-dynamic";

export default async function MonthlyBonusLayout({children}:{children:ReactNode}){
  const current=await currentSession();
  const canConfigure=Boolean(current&&(current.session.role==="admin"||current.session.access_profile==="hr"));
  return <>{children}{canConfigure&&<a className={styles.rulesShortcut} href="/animation-mensuelle/proratisation" title="Paramétrer les règles RH de proratisation des primes"><span>RH</span>RÈGLES DE PRORATISATION</a>}</>;
}
