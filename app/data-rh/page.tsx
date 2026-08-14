import styles from "./data-rh.module.css";
import EmailGatewaySetup from "./email-gateway-setup";

export default function DataRhPage(){
  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href="/" className={styles.back}>← PARAMÈTRE</a><span>FLUX MÉTIERS</span><h1>Imports par e-mail</h1><p>Les trois flux auparavant alimentés par les extractions SQL passent par des fichiers reçus par e-mail. Le FTP usine reste totalement indépendant et ne transite pas par ce canal.</p></div>
      <div className={styles.status}><i/><span>PASSERELLE CRVO</span><strong>PRÊTE CÔTÉ APPLICATION</strong></div>
    </header>
    <section className={styles.grid}>
      <article><span>RH</span><h2>Data RH</h2><p>Présence, collaborateurs, codes temps et durées. Le fichier reçu remplace les données RH des dates qu’il contient et conserve une trace de l’import.</p></article>
      <article><span>CA</span><h2>Chiffre d’affaires</h2><p>Factures, dossiers, clients et composantes de chiffre d’affaires. Les factures sont rapprochées de l’historique existant sans casser les tableaux financiers.</p></article>
      <article><span>H</span><h2>Pointage facturé</h2><p>Temps pointé dans les dossiers facturés, rattaché au numéro de facture ou à l’OR. Les heures alimentent ensuite les indicateurs MO et heures par VOP.</p></article>
    </section>
    <section className={styles.panel}><div><span>RÉCEPTION</span><h2>Une adresse mail, trois fichiers</h2></div><div className={styles.pending}><i/><strong>Adresse Make à générer</strong><p>La réception sécurisée CRVO, l’archivage du fichier original, le contrôle des doublons et l’intégration des trois formats sont prêts. Il reste à créer l’adresse Mailhook dans Make puis à lui transmettre les pièces jointes vers la passerelle CRVO.</p></div></section>
    <EmailGatewaySetup />
  </main>;
}
