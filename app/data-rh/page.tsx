import styles from "./data-rh.module.css";
import DirectFileImport from "./direct-file-import-v3";

export default function DataRhPage(){
  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href="/" className={styles.back}>← PARAMÈTRE</a><span>FLUX MÉTIERS</span><h1>Imports directs</h1><p>Dépose directement les quatre extractions métier depuis ton poste. Elles sont lues nativement en CSV/XLSX/XLS, contrôlées localement, intégrées par blocs puis consolidées dans KPI CRVO. Le FTP usine reste totalement indépendant.</p></div>
      <div className={styles.status}><i/><span>IMPORT CRVO</span><strong>4 FLUX DIRECTS</strong></div>
    </header>
    <section className={styles.grid}>
      <article><span>1</span><h2>Data RH</h2><p>Temps de présence des collaborateurs. Il alimente les heures achetées et la productivité.</p></article>
      <article><span>2</span><h2>Temps pointé facturé</h2><p>Temps facturé par intervention et par collaborateur. Il alimente les heures vendues, les équipes et la productivité.</p></article>
      <article><span>3</span><h2>Factures & CA</h2><p>Chiffre d’affaires réellement facturé sur le mois, par facture, dossier et client.</p></article>
      <article><span>4</span><h2>OR en cours</h2><p>Temps et chiffre d’affaires potentiel des dossiers en production, ventilés par secteur.</p></article>
    </section>
    <DirectFileImport />
    <section className={styles.panel}><div><span>PROCESSUS</span><h2>Contrôle automatique</h2></div><div className={styles.ready}><i/><strong>Fichier → lecture native → contrôle → blocs → consolidation</strong><p>Les colonnes réelles des exports CRVO sont reconnues avant envoi, y compris les dates Excel numériques. Les gros fichiers ne sont jamais traités en une seule opération serveur.</p></div></section>
  </main>;
}
