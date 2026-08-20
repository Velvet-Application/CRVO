"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./temps-travail-layout.module.css";

export default function WorktimeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const leaveActive = pathname.startsWith("/temps-travail/conges");
  return (
    <div className={styles.shell}>
      <div className={styles.subnavWrap} aria-label="Navigation Temps de travail">
        <nav className={styles.subnav}>
          <Link className={styles.link} data-active={!leaveActive} href="/temps-travail">1 · Suivi du temps de présence</Link>
          <Link className={styles.link} data-active={leaveActive} href="/temps-travail/conges">2 · Souhaits de CP</Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
