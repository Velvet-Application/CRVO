import styles from "./data-rh.module.css";
import DirectFileImport from "./direct-file-import";

export default function DataRhPage(){
  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href="/" className={styles.back}>← PARAMÈTRE</a><span>FLUX MÉTIERS</span><h1>Imports directs</h1><p>Dépose directement les trois extractions métier depuis ton poste. Elles sont contrôlées, archivées, analysées puis intégrées dans KPI CRVO. Le FTP usine reste totalement indépendant.</p></div>
      <div className={styles.status}><i/><span>IMPORT CRVO</span><strong>GLISSER-DÉPOSER</strong></div>
    </header>
    <section className={styles.grid}>
      <article><span>RH</span><h2>Data RH</h2><p>Présence, collaborateurs, codes temps et durées. Les dates du fichier alimentent directement les indicateurs RH.</p></article>
      <article><span>H</span><h2>Pointage facturé</h2><p>Temps pointé dans les dossiers facturés, rattaché au numéro de facture ou à l’OR pour calculer les heures par VOP.</p></article>
      <article><span>CA</span><h2>Chiffre d’affaires</h2><p>Factures, dossiers, clients et composantes du chiffre d’affaires. Les données alimentent le suivi financier et les projections.</p></article>
    </section>
    <DirectFileImport />
    <section className={styles.panel}><div><span>PROCESSUS</span><h2>Contrôle automatique</h2></div><div className={styles.ready}><i/><strong>Fichier → contrôle → archive → analyse → intégration</strong><p>Les doublons sont bloqués par empreinte SHA-256. Un fichier non conforme est refusé avec le motif affiché immédiatement, sans altérer les données déjà intégrées.</p></div></section>
  </main>;
}
