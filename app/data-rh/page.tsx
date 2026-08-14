import styles from "./data-rh.module.css";

export default function DataRhPage(){
  return <main className={styles.page}>
    <header className={styles.hero}>
      <div><a href="/" className={styles.back}>← PARAMÈTRE</a><span>DATA RH</span><h1>Source RH</h1><p>Le branchement SQL direct est retiré du parcours actif. La cible est un import quotidien de fichiers contrôlés et historisés.</p></div>
      <div className={styles.status}><i/><span>MODE CIBLE</span><strong>IMPORT FICHIER</strong></div>
    </header>
    <section className={styles.grid}>
      <article><span>01</span><h2>Réception</h2><p>Un export RH est reçu chaque matin par une adresse dédiée CRVO.</p></article>
      <article><span>02</span><h2>Contrôle</h2><p>Le fichier est identifié, daté, contrôlé et les doublons sont bloqués.</p></article>
      <article><span>03</span><h2>Intégration</h2><p>Les données reconnues alimentent le cockpit et restent rattachées au fichier source.</p></article>
    </section>
    <section className={styles.panel}><div><span>CONNEXION</span><h2>Import par e-mail</h2></div><div className={styles.pending}><i/><strong>Adresse de réception à activer</strong><p>L’architecture applicative est prête à accueillir ce canal. L’adresse finale dépend du domaine Cloudflare retenu pour la réception.</p></div></section>
  </main>;
}
