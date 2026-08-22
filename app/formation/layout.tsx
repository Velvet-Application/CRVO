import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "../lib/crvo-auth";
import styles from "./formation-shell.module.css";

export default async function FormationLayout({children}:{children:React.ReactNode}){
  const current=await currentSession();
  if(!current)redirect("/login");
  const{session}=current;
  const allowed=session.role==="admin"||["service_manager","hr","trainer"].includes(session.access_profile);
  if(!allowed)redirect("/");
  return <div className={styles.shell}>
    <nav className={styles.nav} aria-label="Navigation Formation">
      <span className={styles.brand}>PÔLE FORMATION</span>
      <Link className={styles.link} href="/formation">Formation & compétences</Link>
      <Link className={`${styles.link} ${styles.afest}`} href="/formation/afest">AFEST · OPCO</Link>
    </nav>
    {children}
  </div>;
}
