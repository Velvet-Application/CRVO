import Link from "next/link";
import styles from "./transphere-home.module.css";

export const dynamic = "force-dynamic";

function DashboardIcon() {
  return <svg className={styles.cardIcon} viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="40" r="38" stroke="rgba(255,255,255,.18)"/><path d="M39 13a27 27 0 0 0-22 42l22-15V13Z" fill="#d7f3ff"/><path d="M45 13v27h27A27 27 0 0 0 45 13Z" fill="#fff"/><path d="M43 46 21 61a27 27 0 0 0 47-15H43Z" fill="#69cfff"/><rect x="51" y="46" width="7" height="18" rx="2" fill="#0c72dc"/><rect x="60" y="39" width="7" height="25" rx="2" fill="#25aaff"/></svg>;
}
function MatrixIcon() {
  return <svg className={styles.cardIcon} viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M20 18v34h38" stroke="#0b78de" strokeWidth="4" strokeLinecap="round"/><circle cx="20" cy="17" r="8" fill="#2f9cf3"/><circle cx="38" cy="52" r="6" fill="#0b78de"/><circle cx="60" cy="32" r="7" fill="#8595a9"/><path d="M38 52V36h22" stroke="#55b7ff" strokeWidth="3"/><ellipse cx="62" cy="58" rx="9" ry="4" fill="#0b78de"/><path d="M53 58v9c0 2 4 4 9 4s9-2 9-4v-9" stroke="#0b78de" strokeWidth="3"/></svg>;
}
function SettingsIcon() {
  return <svg className={styles.cardIcon} viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M18 21h43M18 38h43M18 55h43" stroke="#fff" strokeWidth="4" strokeLinecap="round"/><circle cx="31" cy="21" r="6" fill="#6ed5ff"/><circle cx="51" cy="38" r="6" fill="#6ed5ff"/><circle cx="38" cy="55" r="6" fill="#6ed5ff"/><path d="M20 61v9h18v-9" stroke="#fff" strokeWidth="3"/><path d="M29 66V50m0 0-6 6m6-6 6 6" stroke="#2db5ff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function FeatureIcon({type}:{type:"truck"|"pin"|"shield"|"bars"}) {
  if(type==="truck") return <svg className={styles.featureIcon} viewBox="0 0 48 48" fill="none"><path d="M5 13h24v20H5zM29 21h8l6 7v5H29V21Z" stroke="currentColor" strokeWidth="2.7"/><circle cx="13" cy="35" r="4" stroke="currentColor" strokeWidth="2.7"/><circle cx="35" cy="35" r="4" stroke="currentColor" strokeWidth="2.7"/></svg>;
  if(type==="pin") return <svg className={styles.featureIcon} viewBox="0 0 48 48" fill="none"><path d="M24 44S10 31 10 19a14 14 0 1 1 28 0c0 12-14 25-14 25Z" stroke="currentColor" strokeWidth="2.7"/><circle cx="24" cy="19" r="5" stroke="currentColor" strokeWidth="2.7"/></svg>;
  if(type==="shield") return <svg className={styles.featureIcon} viewBox="0 0 48 48" fill="none"><path d="m24 4 16 6v11c0 11-7 18-16 23C15 39 8 32 8 21V10l16-6Z" stroke="currentColor" strokeWidth="2.7"/><path d="m17 23 5 5 10-11" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round"/></svg>;
  return <svg className={styles.featureIcon} viewBox="0 0 48 48" fill="none"><rect x="7" y="28" width="7" height="13" rx="2" fill="currentColor"/><rect x="20" y="19" width="7" height="22" rx="2" fill="currentColor"/><rect x="33" y="9" width="7" height="32" rx="2" fill="currentColor"/></svg>;
}

export default function TranspherePage() {
  return <main className={`${styles.page} transphere-home-shell`}>
    <header className={styles.header}>
      <img className={styles.logo} src="/transphere-logo-v6.png" alt="Transphère" />
      <div className={styles.tagline}><span className={styles.shield}><FeatureIcon type="shield" /></span><span>Spécialiste du transport automobile<br/>entre <strong>CRVO</strong> et <strong>Points de vente</strong></span></div>
    </header>

    <section className={styles.hero}>
      <div className={styles.truckWrap}><img className={styles.truck} src="/transphere-truck.jpg" alt="Camion porte-voitures Transphère" /></div>
      <div className={styles.truckShade}/>
      <svg className={styles.route} viewBox="0 0 500 160" fill="none" aria-hidden="true"><path d="M20 118C88 50 132 142 212 78s132-15 264-48" stroke="#7ac9ff" strokeWidth="2.5" strokeDasharray="3 7"/><circle cx="20" cy="118" r="8" fill="#a7d9ff"/><circle cx="212" cy="78" r="8" fill="#a7d9ff"/><circle cx="476" cy="30" r="8" fill="#a7d9ff"/></svg>
      <div className={styles.heroContent}><h1>Pilotage Transphère</h1><div className={styles.accentLine}/><p>Pilotage et optimisation du transport automobile<br/>entre <strong>CRVO</strong> et <strong>points de vente.</strong></p></div>
    </section>

    <section className={styles.cardsBand}>
      <div className={styles.cards}>
        <Link href="/transphere/dashboard" className={`${styles.card} ${styles.cardDark}`}><div className={styles.iconBubble}><DashboardIcon/></div><div className={styles.cardText}><h2>Dashboard</h2><div className={styles.miniLine}/><p>Consultez en temps réel vos volumes, indicateurs de performance et l’activité globale du transport.</p></div><div className={styles.roadGlow}/><span className={styles.arrow}>→</span></Link>
        <Link href="/transphere/matrice" className={`${styles.card} ${styles.cardLight}`}><div className={styles.iconBubble}><MatrixIcon/></div><div className={styles.cardText}><h2>Matrice décisionnelle<br/>transport</h2><div className={styles.miniLine}/><p>Comparez les coûts par véhicule, analysez les scénarios et obtenez la recommandation du meilleur transporteur.</p></div><div className={styles.wave}/><span className={styles.arrow}>→</span></Link>
        <Link href="/transphere/parametre" className={`${styles.card} ${styles.cardDark}`}><div className={styles.iconBubble}><SettingsIcon/></div><div className={styles.cardText}><h2>Paramètre</h2><div className={styles.miniLine}/><p>Gérez les paramètres opérationnels, l’import du Book et la génération du reporting.</p></div><div className={styles.wave}/><span className={styles.arrow}>→</span></Link>
      </div>

      <div className={styles.features}>
        <div className={styles.feature}><FeatureIcon type="truck"/><div><b>Transport spécialisé</b><span>Véhicules neufs et d’occasion</span></div></div>
        <div className={styles.feature}><FeatureIcon type="pin"/><div><b>Réseau national</b><span>CRVO → Points de vente</span></div></div>
        <div className={styles.feature}><FeatureIcon type="shield"/><div><b>Performance & fiabilité</b><span>Suivi, qualité, sécurité</span></div></div>
        <div className={styles.feature}><FeatureIcon type="bars"/><div><b>Pilotage intelligent</b><span>Données, analyse, décision</span></div></div>
      </div>
      <div className={styles.footerMark}><span className={styles.slashes}>///</span></div>
    </section>
  </main>;
}